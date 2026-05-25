# OpenClaw Gateway Smoke Test

本文档用于在接入 `OpenClawBackend` 前验证本机 OpenClaw Gateway 的最小可用性。该 smoke test 只做只读检查，不读取 `.env`，不输出 Token，不修改 OpenClaw 配置，不执行 `openclaw doctor --repair`，也不安装 OpenClaw。

## macOS Smoke Test

1. 确认 OpenClaw CLI 可用：

```bash
openclaw --version
```

2. 确认 Gateway service 正在运行：

```bash
openclaw gateway status
```

3. 确认 Dashboard 可打开：

```bash
openclaw dashboard
```

4. 执行项目内只读 smoke test：

```bash
node scripts/openclaw-smoke-test.mjs
```

如果 `gateway status` 提示 nvm Node service warning，可先记录，不要在本任务中自动 repair。后续由人工决定是否运行 `openclaw doctor` 或 `openclaw doctor --repair`。

## Windows 原生 Smoke Test

1. 在 PowerShell 中确认 CLI：

```powershell
openclaw --version
```

2. 检查 Gateway service：

```powershell
openclaw gateway status
```

3. 检查本地端口：

```powershell
Test-NetConnection 127.0.0.1 -Port 18789
```

4. 执行项目内只读 smoke test：

```powershell
node scripts/openclaw-smoke-test.mjs
```

如果 Windows 防火墙、杀毒软件或企业策略拦截本地端口，需要先让 `127.0.0.1:18789` 的本机访问通过。不要为了 smoke test 自动放开公网访问。

## Gateway 18789 检查

OpenClaw Gateway 默认监听 `127.0.0.1:18789`。最小检查项：

- `openclaw gateway status` 显示 runtime running。
- `http://127.0.0.1:18789` 有 HTTP 响应。
- `ws://127.0.0.1:18789` 能建立 WebSocket 连接，理想情况下会先收到 `connect.challenge`。

## `/v1/models` 检查

OpenClaw Gateway 文档声明同一端口提供 OpenAI-compatible endpoints，其中包括：

```text
GET /v1/models
```

检查方式：

```bash
node scripts/openclaw-smoke-test.mjs
```

脚本会输出 HTTP status、content-type，以及模型数量和少量 model id 摘要。脚本不会发送 Authorization header，也不会读取或打印 gateway token。若 Gateway 需要认证，可能返回 `401` 或 `403`，这说明 endpoint 存在但需要后续接入时设计认证方案。

重要判断：Gateway 可达不等于 OpenAI-compatible API 可用，Control UI 可达也不等于 `/v1/models` 可用。实测中 `http://127.0.0.1:18789/` 可以打开 OpenClaw Control UI；如果 `/v1/models` 返回 `text/html`，或响应体包含 `openclaw-app` / `OpenClaw Control UI` 等 Control UI 标记，应判定为“HTTP endpoint 未确认命中 API，可能 fallback 到 Control UI”，不能把 HTTP 200 直接当成模型 API 可用。

`/v1/models` smoke test 需要区分：

- `application/json` 且 JSON 结构包含模型列表：可认为 OpenAI-compatible models endpoint 初步可用。
- `401` / `403`：endpoint 可能存在但需要认证，后续 `OpenClawBackend` 必须确认 token/password/device auth 方案。
- `text/html` 或 Control UI HTML：Gateway 可达，但 `/v1/models` API 未确认，不要依赖该 endpoint。
- 其他状态或非 JSON：记录状态、content-type 和脱敏摘要，作为后续协议验证输入。

## WebSocket 检查

检查目标：

```text
ws://127.0.0.1:18789
```

期望行为：

- WebSocket TCP connect 成功。
- Gateway 发送 `connect.challenge` 事件。
- smoke test 不发送 Token，不发送 `connect.params.auth.token`，不做设备配对。

如果没有收到 `connect.challenge`，但连接建立后很快被关闭，应记录 close code 和 reason，后续接入 `OpenClawBackend` 时再按 Gateway protocol 实现完整 handshake、auth、device identity 和 scopes。

对后续接入优先级的判断：WebSocket RPC 的 `connect.challenge` / `hello-ok` 行为可能比 HTTP `/v1/models` 更关键。不要因为 Control UI 能打开，就假定 OpenAI-compatible HTTP API 已可用。

## 常见问题

### Gateway 没启动

现象：`openclaw gateway status` 非 running，或 `127.0.0.1:18789` 无法连接。

处理：

```bash
openclaw gateway status
openclaw gateway
```

不要在 smoke test 脚本中自动启动 Gateway。启动/修复由人工执行。

### 端口被占用

现象：Gateway 无法 bind `18789`，或 `gateway status` 提示其他进程占用。

处理：确认是否已有另一个 OpenClaw Gateway 或其他服务占用该端口。不要在脚本中 kill 进程。

### nvm Node Service Warning

现象：`openclaw gateway status` 提示当前 service 使用 nvm Node，建议运行 `openclaw doctor` 或 `openclaw doctor --repair`。

处理：本 smoke test 只记录该 warning，不自动 repair。后续由人工决定是否修复 service runtime。

### Token/Auth 失败

现象：`GET /v1/models` 返回 `401` / `403`，或 WebSocket close reason 指向 auth / pairing。

处理：这是后续 `OpenClawBackend` 需要处理的认证问题。smoke test 不读取 `.env`，不读取 OpenClaw config token，不输出 Token，不自动配对设备。

### `/v1/models` 返回 Control UI HTML

现象：`curl -i http://127.0.0.1:18789/v1/models` 返回 `text/html`，或响应体里能看到 Control UI HTML / `openclaw-app`。

处理：这只能说明 Gateway HTTP service 和 Control UI 可达，不能说明 OpenAI-compatible `/v1/models` 已命中。后续 `OpenClawBackend` 不应盲目依赖 `/v1/models`，必须先确认真实 endpoint、路径、header、鉴权方式和返回 JSON schema。

### Windows 防火墙

现象：PowerShell `Test-NetConnection 127.0.0.1 -Port 18789` 失败，或浏览器无法打开 Dashboard。

处理：确认 Gateway 是否运行；确认本机 loopback 访问未被安全软件阻断。普通客户路径不应要求开放公网端口。

## 接入 OpenClawBackend 前必须确认的 API 行为

在实现真实 `OpenClawBackend` 前，需要确认以下行为并写入实现设计：

- Gateway WebSocket protocol version、`connect.challenge`、`connect` request 结构和失败错误码。
- 本地 loopback 是否需要 gateway token、password、device identity、pairing 或 scope approval。
- `chat.send` 的 request 参数、ack 结构、`runId` / `sessionKey` 返回规则。
- `chat` / `agent` / `session.message` / `session.operation` / `session.tool` event 的实际 payload shape。
- `chat.abort` 或 `sessions.abort` 的最小参数和取消成功/失败语义。
- `chat.history` 的分页、截断、附件、tool event 和 partial message 表达。
- `/v1/chat/completions` 与 `/v1/responses` 是否满足基础 chat smoke，但不要只用它们替代完整 WS event model。
- `models.list` 或 `/v1/models` 的认证要求、模型 id 规则和默认 agent 映射。
- `/v1/models` 是否返回真实 JSON API；若返回 Control UI HTML，应优先验证 WS RPC 或正确 API 路径/鉴权方式。
- `skills.status`、`skills.search`、`skills.detail` 的权限要求和第三方 skill 安全边界。
- Windows native Gateway service 在普通客户环境下的启动、端口、防火墙和 Node runtime 稳定性。
