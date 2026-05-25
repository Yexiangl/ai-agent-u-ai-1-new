# OpenClaw WebSocket RPC Probe Notes

本记录来自只读脚本：

```bash
node scripts/openclaw-ws-rpc-probe.mjs
```

脚本不读取 `.env`，不输出 Token，不 hardcode gateway token，不修改 OpenClaw 配置，不自动安装、启动或重启 OpenClaw。

## Summary

- Gateway WebSocket 可连接：`ws://127.0.0.1:18789`。
- Gateway 会先发送 `connect.challenge`。
- 无 Token、无 device identity 的本地 backend-style `connect` 被拒绝。
- 本次未收到 `hello-ok`。
- 因未进入 authenticated / paired session，`health` / `status`、`skills.status`、`models.list` 未能实际调用。

结论：TASK-004 已确认 WS transport 可用；TASK-005 进一步确认 RPC 层不能只靠“端口可达 + challenge 可达”，后续 `OpenClawBackend` 必须实现或接入合规的 Gateway auth / device identity / pairing 流程，不能盲目发送业务 RPC。

## `connect.challenge` 实际结构摘要

实测收到的 frame 类型：

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payloadKeys": ["nonce", "ts"],
  "nonce": "present",
  "ts": 1779687620742
}
```

说明：

- `payload.nonce` 存在。
- `payload.ts` 存在，为毫秒时间戳。
- 后续 device identity 方案需要使用该 nonce 参与签名，不能使用旧的 pre-challenge 签名方式。

## `connect` Frame 实际字段

本次 probe 发送的 connect frame 摘要：

```json
{
  "type": "req",
  "method": "connect",
  "params": {
    "minProtocol": 4,
    "maxProtocol": 4,
    "client": {
      "id": "gateway-client",
      "displayName": "AI Agent Workspace WS RPC Probe",
      "version": "0.0.0-probe",
      "platform": "darwin",
      "mode": "backend"
    },
    "role": "operator",
    "scopes": ["operator.read"],
    "caps": [],
    "commands": [],
    "permissions": {},
    "locale": "en-US",
    "userAgent": "ai-agent-workspace-openclaw-ws-rpc-probe/0.0.0"
  }
}
```

本次刻意未发送：

- `params.auth.token`
- `params.auth.password`
- `params.device`
- Authorization header
- provider key
- gateway token

## `hello-ok` 是否成功

未成功。Gateway 返回：

```json
{
  "code": "NOT_PAIRED",
  "message": "device identity required",
  "details": {
    "code": "DEVICE_IDENTITY_REQUIRED"
  }
}
```

含义：

- 当前 Gateway 要求 device identity 或等价的认证/配对路径。
- 仅使用 loopback WS、`gateway-client`、`backend`、`operator.read` 不足以进入 `hello-ok`。
- 后续不能把 TASK-004 的 `connect.challenge` 成功误判为 RPC 已可用。

## 可用 RPC Methods 摘要

本次未收到 `hello-ok`，因此无法读取 `hello-ok.features.methods`。

根据公开 Gateway protocol 文档，后续 `hello-ok.features.methods` 是真实能力发现来源，不应写死完整 RPC 列表。后续 `OpenClawBackend` 初版至少需要在 `hello-ok` 后检查：

- `health` 或 `status`
- `skills.status`
- `models.list`
- `chat.send`
- `chat.abort`
- `chat.history`
- `sessions.list` / `sessions.create` / `sessions.send` / `sessions.abort`

## `health` / `status` 返回摘要

未调用。原因：`connect` 未收到 `hello-ok`，没有 authenticated / paired session。

后续验证顺序应为：

1. WS TCP connect。
2. 收到 `connect.challenge`。
3. 发送带合规 auth/device identity 的 `connect`。
4. 收到 `hello-ok`。
5. 从 `hello-ok.features.methods` 中确认 `health` 或 `status` 是否存在。
6. 调用可用的健康 RPC 并记录脱敏摘要。

## `skills.status` 是否可用

未调用。原因：`connect` 未收到 `hello-ok`。

后续接入 Skill Center 前必须确认：

- `skills.status` 是否出现在 `hello-ok.features.methods`。
- 调用是否只需要 `operator.read`。
- 返回 payload 中 skill 标识、显示名、enabled 状态、missing requirements、config checks 的实际字段。
- 返回中是否包含需要额外脱敏的 secret/config 信息。

## `models.list` 是否可用

未调用。原因：`connect` 未收到 `hello-ok`。

本点与 TASK-004 的 HTTP 发现互相印证：

- HTTP `/v1/models` 当前返回 Control UI HTML fallback，不能作为主要接入依据。
- WS `models.list` 可能是更合适的模型发现路径，但必须先完成 `hello-ok`。
- 后续需要验证 `models.list({ view: "configured" })` 和必要时 `models.list({ view: "all" })` 的返回 schema。

## 后续 OpenClawBackend 事件订阅建议

`OpenClawBackend` 不应按 Hermes SSE 形状实现。建议流程：

1. 建立 WS 连接并等待 `connect.challenge`。
2. 使用合规 auth/device identity/pairing 发送 `connect`。
3. 收到 `hello-ok` 后读取 `protocol`、`server.version`、`features.methods`、`features.events`、`auth.scopes`、`policy`。
4. 只启用 `features.methods` 中实际存在的方法。
5. 根据 `features.events` 订阅和处理事件，不假设所有 Gateway 都有同一事件集。
6. 对 `tick` / `health` / `presence` 做连接状态维护。
7. 对 `chat`、`agent`、`session.message`、`session.operation`、`session.tool` 做统一事件归一化，映射为当前 UI 需要的 text delta、message snapshot、tool event、done、error。
8. 若检测到事件 `seq` gap，需要刷新 `health`、session history 或 presence，而不是继续盲目信任本地状态。

## 后续 OpenClawBackend 发送消息建议

优先验证并使用 WS RPC：

- `sessions.create` 或现有 session resolve/create 流程。
- `chat.send` 或 `sessions.send`，以 Gateway 实测返回为准。
- 发送后记录 `runId`、`sessionKey`、accepted/started 状态。
- 通过 `chat` / `session.*` events 接收增量和最终状态。
- 停止生成使用 `chat.abort` 或 `sessions.abort`，不要沿用 Hermes cancel 语义。

短期不要仅依赖 HTTP `/v1/chat/completions` 或 `/v1/models`，因为 TASK-004 已实测 `/v1/models` 可能 fallback 到 Control UI HTML。

## 未确认协议点

- 当前产品应如何获取或创建合法 device identity。
- 是否允许 Tauri backend 使用 `gateway-client` / `backend` 模式，还是必须注册为独立 client id。
- 本机 loopback 是否应通过 shared gateway token、password、device token、pairing approval 或 setup-code bootstrap 完成认证。
- `connect.params.device` 的持久化位置、签名 payload、token 存储和轮换策略。
- `hello-ok.auth.deviceToken` 是否会返回，以及应用是否应持久化。
- `hello-ok.features.methods/events` 在 macOS、Windows native、不同 OpenClaw 版本中的差异。
- `health` / `status` / `skills.status` / `models.list` 的实际 payload shape。
- `chat.send` / `sessions.send` 的最小参数、返回 ack、错误码、事件序列和取消语义。
- Windows native 下 device identity、pairing、firewall、Node service runtime 的实际差异。
