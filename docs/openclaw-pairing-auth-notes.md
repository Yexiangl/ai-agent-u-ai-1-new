# OpenClaw Pairing / Auth Probe Notes

本记录来自 TASK-006，只做协议和认证流程验证，不接入 App 主链路，不修改 OpenClaw 配置，不读取 `.env`，不输出 Token。

验证命令：

```bash
node scripts/openclaw-pairing-probe.mjs
openclaw devices list --json
openclaw devices approve --latest --json
openclaw config get gateway.auth.mode
```

`openclaw devices approve --latest --json` 本轮只用于 preview 最新 pending request；未执行带具体 requestId 的 approve，因此未批准设备、未改变配对安全状态。

## TASK-005 失败原因复盘

TASK-005 使用无 Token、无 device identity 的 connect frame：

- WS 可连接。
- 可以收到 `connect.challenge`。
- `connect` 未收到 `hello-ok`。
- Gateway 返回 `NOT_PAIRED` / `DEVICE_IDENTITY_REQUIRED`。

结论：裸 WS + `connect.challenge` 成功只能说明 transport 可用，不能说明 RPC session 可用。Gateway 需要 device identity 或等价 auth/pairing 路径。

## Device Identity 字段

本轮 probe 使用 Ed25519 device identity，connect frame 中增加：

```json
{
  "device": {
    "id": "sha256(publicKeyRaw)",
    "publicKey": "ed25519-public-key-raw-base64url",
    "signature": "ed25519-signature-base64url",
    "signedAt": 1779688874534,
    "nonce": "connect.challenge.payload.nonce"
  }
}
```

签名 payload 使用 protocol v4 / v3 device auth 形状：

```text
v3|deviceId|clientId|clientMode|role|scopesCsv|signedAtMs|tokenOrEmpty|nonce|platform|deviceFamily
```

device id 生成方式：

- 生成 Ed25519 keypair。
- 从 public key PEM 导出 raw public key。
- `deviceId = sha256(publicKeyRaw)`，hex 编码。

是否需要持久化：需要。配对记录绑定 device id 和 public key；如果每次启动都生成新 key，就会每次产生新的 pairing/auth 问题。probe 当前把测试 identity 存在 OS 临时目录：

```text
/var/folders/.../ai-agent-workspace-openclaw-pairing-probe-device.json
```

也可通过 `OPENCLAW_PAIRING_PROBE_IDENTITY` 指定路径。真实 Tauri App 应把 device private key 存在 OS keychain 或 app 私有安全存储，不应放在前端、日志、普通配置或项目仓库中。

是否可以由 Tauri App 本地生成：可以。Tauri 后端可用 Rust 或 Node-equivalent crypto 生成 Ed25519 keypair，并在每次 WS connect 时使用 `connect.challenge.payload.nonce` 签名。

## Auth 流程实测

当前 Gateway auth mode：

```text
gateway.auth.mode = token
```

带 device identity、但不提供 token/password 的 probe 结果：

```json
{
  "code": "INVALID_REQUEST",
  "message": "unauthorized: gateway token missing (provide gateway auth token)",
  "details": {
    "code": "AUTH_TOKEN_MISSING",
    "authReason": "token_missing",
    "canRetryWithDeviceToken": false,
    "recommendedNextStep": "update_auth_configuration"
  }
}
```

结论：当前环境下，device identity 解决了 `DEVICE_IDENTITY_REQUIRED`，但 Gateway 仍要求 shared gateway token/password 或已配对 device token。probe 不读取 `.env`，不读取 OpenClaw config token，不输出 Token。如果需要继续验证 `hello-ok`，脚本只支持由调用者临时通过环境变量提供：

```bash
OPENCLAW_GATEWAY_TOKEN=... node scripts/openclaw-pairing-probe.mjs
```

或：

```bash
OPENCLAW_GATEWAY_PASSWORD=... node scripts/openclaw-pairing-probe.mjs
```

脚本会使用这些环境变量，但不会打印值。

## Pairing 流程推断

OpenClaw device pairing 和 node pairing 是两套概念：

- WS `connect` 的 device pairing 使用 `openclaw devices ...` 管理。
- `openclaw nodes ...` 管理 Gateway-owned node pairing；文档明确 WS nodes 使用 device pairing，`node.pair.*` 不 gate 普通 WS handshake。

已确认 CLI：

```bash
openclaw devices list
openclaw devices approve --latest
openclaw devices approve <requestId>
openclaw devices reject <requestId>
openclaw devices remove <deviceId>
openclaw devices rotate --device <deviceId> --role operator
openclaw devices revoke --device <deviceId> --role operator
```

`openclaw devices approve --latest --json` 只 preview 最新 request，不批准。真正批准需要明确 request id：

```bash
openclaw devices approve <requestId> --json
```

本轮没有执行该命令。

## Pairing 实测

`openclaw devices list --json` 当前显示：

- Control UI 已是 paired operator device，拥有 `operator.admin`、`operator.read`、`operator.write`、`operator.approvals`、`operator.pairing`。
- CLI 已有 paired operator device，当前 approved scope 是 `operator.read`。
- CLI 有一个 pending scope upgrade request，请求 `operator.pairing`，`openclaw devices approve --latest --json` 返回 preview 和建议 approve command。

这说明：

- Control UI 本身已经完成过设备配对并获得 admin/pairing scopes。
- CLI 想执行 pairing 管理操作时，可能需要从 `operator.read` 升级到 `operator.pairing`。
- 当前截图中未看到明显 Pairing / Devices / Approvals 入口，但 CLI 能列出和 preview pending device request。

## Control UI 入口观察

用户实测 `http://127.0.0.1:18789/` 可打开 OpenClaw Control UI。左侧模块包括：聊天、概览、实例、会话、使用情况、定时任务、代理、技能、节点、梦境、设置、文档。

设置页中可见 Model & Thinking、Channels、Personal、Telegram / Discord / Slack / WhatsApp / Signal / iMessage 连接入口，以及设置、频道、通信、外观与设置、自动化、基础设施、AI 与代理、调试、日志等 tabs。

当前截图没有看到明显的 pairing / devices / approvals 入口。后续人工应重点检查：

- 节点
- 实例
- 基础设施
- 调试
- 日志
- AI 与代理
- 是否存在隐藏的 Clients / Devices / Pairing / Approvals 页面或 pending request toast

如果 UI 无入口，产品 onboarding 不能依赖用户自己找到该页面，至少要提供明确 CLI fallback：

```bash
openclaw devices list
openclaw devices approve --latest
openclaw devices approve <requestId>
```

## Hello-Ok 是否成功

本轮未成功拿到 `hello-ok`。

阻塞点从 TASK-005 的 `DEVICE_IDENTITY_REQUIRED` 前进到了本轮的 `AUTH_TOKEN_MISSING`。也就是说，device identity frame 字段和签名形状已经通过了基础校验，但当前 Gateway 的 `token` auth mode 要求 connect auth。

## 基础 RPC 是否打通

未打通。因为未收到 `hello-ok`，没有 authenticated / paired WS session，脚本没有调用：

- `health` / `status`
- `skills.status`
- `models.list`

脚本已实现 `hello-ok` 成功后的调用逻辑：

- 如果 `features.methods` 包含 `health`，调用 `health`；否则尝试 `status`。
- 如果包含 `skills.status`，调用 `skills.status`。
- 如果包含 `models.list`，调用 `models.list({ view: "configured" })`。

## OpenClawBackend 连接管理建议

OpenClawBackend 初版不应读取 `.env` 或 OpenClaw config token。建议设计为：

1. Tauri 后端生成并持久化 App 专属 Ed25519 device identity。
2. App 连接 WS，等待 `connect.challenge`。
3. Tauri 后端使用 challenge nonce 签名 device payload。
4. 如果用户已输入 gateway token 或安全存储中已有 token，则放入 `connect.params.auth.token`；不要打印，不要放 CLI 参数，不要进前端日志。
5. 发送 `connect`，请求最小 scope，先用 `operator.read`。
6. 若返回 `AUTH_TOKEN_MISSING`，onboarding 提示用户提供或完成 OpenClaw Gateway 授权。
7. 若返回 `NOT_PAIRED` / `PAIRING_REQUIRED`，onboarding 提示用户在 Control UI 或 CLI 批准设备。
8. 收到 `hello-ok` 后保存 returned device token 到 OS secure storage，用于后续 reconnect。
9. 根据 `hello-ok.features.methods/events` 做能力发现，不写死完整方法列表。
10. 后续发送消息前再请求 `operator.write` 或触发 scope upgrade，不要一开始申请 admin。

## 产品 Onboarding 影响

是否需要“连接 OpenClaw / 批准设备”：需要。当前 Gateway 已要求 token auth；即使 device identity 正确，也不能无感进入 RPC session。

是否需要用户打开 Dashboard：可能需要。Control UI 已是 paired admin device，但当前截图未发现 Pairing/Devices/Approvals 入口；如果后续确认 UI 有入口，应在 onboarding 中提供“打开 OpenClaw Dashboard 并批准本设备”的明确步骤。

是否可以做到无感配对：当前普通 operator client 不应假设可无感配对。公开文档显示 auto-approval 主要限制在特定 node/CIDR 或窄范围本地场景；operator/browser/Control UI 和 scope upgrade 仍偏人工批准或 token auth。

是否适合普通客户：可行，但 onboarding 必须包装复杂度。普通客户不应看到 provider/baseUrl/API URL，但可能需要：

- 输入一次 OpenClaw Gateway token，或
- 点击 Dashboard 中的批准按钮，或
- 按引导复制执行 `openclaw devices approve <requestId>`。

## Skill Center 迁移补充

OpenClaw Control UI 自带“技能”页面。后续 Skill Center 迁移应优先读取 OpenClaw `skills.status`，展示已安装/可用技能状态和 missing requirements。短期不应直接开放 ClawHub 任意第三方 skill 一键安装；安装第三方 skill 仍需安全审查、权限说明和人工确认。

## 未确认问题

- Gateway token 应由用户从哪里安全获得，OpenClaw Control UI 是否提供复制/生成入口。
- Control UI 中是否存在 Devices / Pairing / Approvals 页面；截图未确认。
- 提供 token 后，`gateway-client` / `backend` + signed device identity 是否能直接 `hello-ok`，还是仍会产生 pending device pairing request。
- approved device token 应如何在 Tauri 中安全存储和轮换。
- Windows native 下 identity 持久化、Dashboard approval、CLI approval 是否一致。
