# OpenClaw Token Auth + Hello-Ok Probe Notes

本记录来自 TASK-007。目标是验证 Gateway token auth + device identity + challenge nonce signature 是否能进入 `hello-ok`。本任务不改业务代码，不接入 App UI，不实现 `OpenClawBackend`，不读取 `.env`，不输出 Token，不修改 OpenClaw 配置。

验证命令：

```bash
node scripts/openclaw-auth-probe.mjs
npm run build
cargo check
```

如果要实际验证 `hello-ok`，需要由调用者临时提供环境变量：

```bash
OPENCLAW_GATEWAY_TOKEN=... node scripts/openclaw-auth-probe.mjs
```

脚本只会显示 `token_present=true/false`，不会打印 token，不会写入 token，不会读取 `.env`，也不会通过 CLI 参数接收 token。

## TASK-006 复盘

TASK-006 已确认：

- 无 device identity 时，Gateway 返回 `DEVICE_IDENTITY_REQUIRED`。
- 加入 Ed25519 device identity、challenge nonce signature 后，错误前进为 `AUTH_TOKEN_MISSING`。
- `openclaw config get gateway.auth.mode` 显示当前 Gateway auth mode 是 `token`。
- 未收到 `hello-ok`，因此基础 RPC 未打通。

TASK-007 在此基础上新增 `scripts/openclaw-auth-probe.mjs`，专门验证 token auth + signed device identity。

## `gateway.auth.mode=token` 的含义

当前 Gateway 要求 `connect.params.auth.token`。即使 `connect.params.device` 存在且签名有效，如果没有 shared gateway token 或已批准的 device token，Gateway 也会拒绝握手。

TASK-006 的错误摘要：

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

## Token 认证字段尝试方式

`openclaw-auth-probe.mjs` 使用的 auth 结构：

```json
{
  "auth": {
    "token": "[REDACTED]"
  }
}
```

实际 frame 输出只显示：

```json
{
  "auth": {
    "token": "present-redacted"
  }
}
```

本轮运行环境未提供 `OPENCLAW_GATEWAY_TOKEN`，所以脚本按设计跳过：

```text
token_present=false; 需要临时提供 OPENCLAW_GATEWAY_TOKEN 才能验证 hello-ok
```

这不算 hard failure，因为任务禁止读取 `.env` 或 OpenClaw config token。

用户补充实测：通过 shell 临时设置 `OPENCLAW_GATEWAY_TOKEN` 后，首轮 `connect.params.auth.token` 已发送，输出只显示 `token_present=true`。Gateway 未返回 `hello-ok`，而是返回：

```json
{
  "code": "INVALID_REQUEST",
  "message": "unauthorized: gateway token mismatch (provide gateway auth token)",
  "details": {
    "code": "AUTH_TOKEN_MISMATCH",
    "recommendedNextStep": "retry_with_device_token",
    "canRetryWithDeviceToken": "[REDACTED]"
  }
}
```

这说明当前 Gateway 在 shared token mismatch 时可能提供一次 device-token retry 路径。`canRetryWithDeviceToken` 的具体值视为敏感 token，不得输出，不得写入文件。

## AUTH_TOKEN_MISMATCH -> Device Token Retry

`scripts/openclaw-auth-probe.mjs` 已更新为两段式：

1. 首轮使用 `connect.params.auth.token`，并把同一 token 纳入 v3 device signature payload。
2. 如果返回 `details.recommendedNextStep === "retry_with_device_token"` 且响应中存在可用 device token，脚本关闭首轮 WS。
3. 第二轮重新连接 Gateway，重新等待 `connect.challenge`。
4. 第二轮使用 `connect.params.auth.deviceToken`，并用该 device token 参与新的 v3 signature payload。
5. 输出只显示 `device_token_present=true`，不显示 token 内容，不写入 token。

如果第二轮成功收到 `hello-ok`，脚本会继续执行最小 RPC：`health` 或 `status`、`skills.status`、`models.list({ view: "configured" })`。如果第二轮仍失败，脚本只记录脱敏错误 code/message/details 摘要。

## TASK-007 修正：device token 提取与 retry 逻辑

### 问题

用户实测时 Gateway 返回 `AUTH_TOKEN_MISMATCH` + `details.canRetryWithDeviceToken`（含真实 device token），但脚本输出 `device_token_present=false`，未执行第二轮 device token retry。

### 根因分析

`extractRetryDeviceToken()` 只检查有限的已知字段名（`canRetryWithDeviceToken`、`deviceToken`、`retryDeviceToken`、`authDeviceToken`、`token`），若 Gateway 返回的字段名或嵌套结构与预期不完全一致，提取会失败并静默返回 null。

另一个潜在风险：若下游代码意外对 error details 对象做了 sanitize/redact 操作（即使当前代码未发生），也会导致提取失败。

### 修正内容

1. **预提取（pre-extraction）**：在 `connectOnce` 的 `res` frame 处理中，收到原始 `frame.error` 后立即调用 `extractRetryDeviceToken(frame.error.details, "raw-res")`，把 device token 存储到 `err._extractedDeviceToken`。该提取发生在任何 `compactJson`/`redact`/`record` 调用之前，保证拿到的是 Gateway 原始 payload。

2. **传播**：`connectOnce` catch 块优先使用 `err._extractedDeviceToken`，其次才做 fallback 提取。返回对象新增 `retryDeviceToken` 字段。

3. **`probe()` 优先使用预提取值**：`first.retryDeviceToken` 优先于再次调用 `extractRetryDeviceToken`。

4. **提取函数增强**：
   - 已知字段名列表扩展（移除易误匹配的 `details.token`）。
   - 若已知字段全部未命中，扫描 `details` 中所有 string 类型的值，排除明显不是 token 的字段（错误码、错误消息、推荐步骤等），按 value 长度优先，取最长者作为候选 token。
   - 提取失败时输出非敏感 `detailsKeys` 和 `stringValueCount` 用于诊断。

5. **`shouldRetryWithDeviceToken` 增强**：新增 `details.code === "AUTH_TOKEN_MISMATCH"` 作为 retry 触发条件（此前仅依赖 `recommendedNextStep` 和 `canRetryWithDeviceToken` 类型检查）。

6. **OpenClawBackend 正式实现建议**：
   - 在 WS 消息处理中立即从原始 `frame.error.details` 提取 device token。
   - 提取后再做日志脱敏，绝对不能反过来。
   - token/deviceToken 只在内存中使用，不写日志、不写文件、不写文档。

## TASK-007 继续修正：device token mismatch 根因排查

### 实测

用户提供 `OPENCLAW_GATEWAY_TOKEN` 后运行修正版脚本：

- 初次 connect: `AUTH_TOKEN_MISMATCH` + `canRetryWithDeviceToken` 已能正确提取。
- `device_token_present=true`，进入诊断与 retry 阶段。
- **New-socket retry** (`auth.deviceToken`): 收到 `AUTH_DEVICE_TOKEN_MISMATCH`，message 为 `unauthorized: device token mismatch (rotate/reissue device token)`，`recommendedNextStep: update_auth_credentials`。

### 当前疑点

1. **Token 是否被脱敏污染**: 脚本已输出 non-sensitive 诊断（type, length, sha256_prefix, is_redacted_literal, structure），可确认 token 值未在传输中被脱敏/污染。
2. **DeviceToken 是否必须 same-socket retry**: Gateway 可能在收到 `AUTH_TOKEN_MISMATCH` 后仅在当前 WS session 上下文中允许 device token retry。新 WS 会导致 challenge nonce 变化使上一轮返回的 device token 失效。脚本新增 `connectSameSocket()` 在同一 socket 上发送第二个 connect frame（复用 challenge nonce），对比 same-socket vs new-socket。
3. **Auth 字段形状**: 除 `auth.deviceToken` 外，脚本测试了 `auth.token = deviceToken` 和 `auth = { type: "device", token: deviceToken }` 两种变体。
4. **Device token 是否需要先通过 pairing**: probe device identity 是脚本生成的临时 identity，可能不在 Gateway 已批准设备列表中，需要 `openclaw devices approve`。

### 脚本新增能力

- `diagnoseDeviceToken(label, rawToken)` — 输出 type, length, sha256_prefix (8 hex), is_redacted_literal, structure (segments/hasDot/firstChar/lastChar/prefix2)，全部为 non-sensitive 诊断。
- `connectOnce({ keepSocketOnError: true })` — 不关闭 socket，返回 `socket` + `challengeNonce`。
- `connectSameSocket()` — 在已有 socket 上发送 connect frame（复用 challenge nonce）。
- `probe()` 5 步：initial connect → diagnostics → same-socket retry → new-socket retry (control) → auth shape variants。

### 对 OpenClawBackend 的影响

- 正式实现必须在同一 WS 连接内处理 `AUTH_TOKEN_MISMATCH → device token retry`，不能用新 WS 重连。
- 确认 device token 有效期和作用域（per-socket / per-session / per-device-approval）。
- 准备 `openclaw devices approve` 流程作为 fallback。

## TASK-007 第三次修正：根因定位 — 启发式扫描误提取 recommendedNextStep

### 实测诊断

用户运行修正版脚本后，device token 诊断：

```
device-token extracted length = 23
device-token extracted firstChar = r
device-token extracted lastChar = n
device-token extracted prefix2 = re
```

这精确匹配 `retry_with_device_token`（23 字符，r 开头，n 结尾，前缀 re）。

### 根因

`extractRetryDeviceToken()` 的 fallback 启发式扫描遍历 `details` 中所有 string 值。虽然 filter 排除了 key 名匹配已知系统字段的条目，但 `recommendedNextStep` 不在排除列表中。因此 `details.recommendedNextStep = "retry_with_device_token"` 被当作 token 候选提取。

### 修正

1. **完全移除启发式扫描** — `extractRetryDeviceToken` 只从 4 个已知字段名提取。
2. **值校验** — 新增 `INVALID_TOKEN_VALUES` set，拒绝 `"retry_with_device_token"`、`"update_auth_credentials"`、`"true"`、`"false"`、`"[REDACTED]"` 及任何含 `REDACTED` 的字符串。
3. **新增 `diagnoseCanRetryWithDeviceToken(details)`** — 输出 typeof / is_string / is_boolean / length / looks_like_next_step / is_redacted_literal / likely_valid_token。
4. **新增 gateway token 诊断** — 输出 length / trimmed_length / has_newline / sha256_prefix (8 hex)。
5. **retry gate 简化** — 只看 `retryDeviceToken` 是否为 null。

### 当前状态

- Gateway token 初次 connect 仍 `AUTH_TOKEN_MISMATCH`。
- `canRetryWithDeviceToken` 的真实语义待确认（token 字符串 / boolean flag / capability indicator）。
- 在确认真实 token 前不执行 device token retry。
- OpenClawBackend 仍不能开始。

### 下一步

用户运行 `OPENCLAW_GATEWAY_TOKEN=... node scripts/openclaw-auth-probe.mjs` 查看：
1. gateway_token_has_newline / gateway_token_sha256_prefix — 排除 token 污染
2. canRetryWithDeviceToken typeof / is_string / looks_like_next_step / likely_valid_token — 确认 Gateway 真实返回

## Device Identity + Nonce Signature 结构

脚本生成或复用 Ed25519 device identity，并持久化到 OS 临时目录，默认路径：

```text
/var/folders/.../ai-agent-workspace-openclaw-auth-probe-device.json
```

也可以通过 `OPENCLAW_AUTH_PROBE_IDENTITY` 指定 probe identity 路径。

device id：

```text
sha256(ed25519 public key raw bytes)
```

connect frame 的 device 摘要：

```json
{
  "device": {
    "id": "sha256-public-key-hex",
    "publicKey": "present",
    "signature": "present",
    "signedAt": 1779689005046,
    "nonce": "present"
  }
}
```

签名 payload：

```text
v3|deviceId|clientId|clientMode|role|scopesCsv|signedAtMs|token|nonce|platform|deviceFamily
```

注意：token 是签名 payload 的一部分，但脚本不打印 payload，也不持久化 token。

## Hello-Ok 是否成功

本轮尚未由 OpenCode 验证到 `hello-ok`，因为当前执行环境没有临时提供 `OPENCLAW_GATEWAY_TOKEN`。用户补充实测显示：提供 token 后首轮变为 `AUTH_TOKEN_MISMATCH`，且 Gateway 建议 `retry_with_device_token`。

脚本当前行为：

- 无 token：输出 skip，退出成功。
- 有 token：连接 WS，等待 `connect.challenge`，发送带 token 和 signed device identity 的 `connect`。
- 如果 Gateway 返回 `AUTH_TOKEN_MISMATCH` + `retry_with_device_token` + device token，自动发起第二次 WS connect。
- 第二次 connect 使用 `auth.deviceToken`，输出只显示 `device_token_present=true`。
- 成功时记录 `protocol`、`server.version`、`features.methods` 数量、`features.events` 数量、`auth` 摘要、`policy` 摘要。
- 失败时记录错误 `code`、`message` 和 details 摘要，并继续脱敏。

## 基础 RPC 是否成功

本轮未调用基础 RPC，因为没有 token，脚本未进入 handshake 阶段。

脚本已实现 `hello-ok` 成功后的最小 RPC：

- 如果 `features.methods` 包含 `health`，调用 `health`；否则尝试 `status`。
- 如果包含 `skills.status`，调用 `skills.status`。
- 如果包含 `models.list`，调用 `models.list({ view: "configured" })`。

RPC 失败时会记录脱敏错误摘要，用于判断是 auth、pairing、method 不存在、payload 错误还是协议字段错误。

## 对 OpenClawBackend 初版的实现建议

1. Tauri 后端生成 App 专属 Ed25519 device identity，并保存在 OS secure storage 或 app 私有安全目录。
2. 每次连接 Gateway 时先等待 `connect.challenge`。
3. 使用 challenge nonce 生成 v3 device signature。
4. Gateway token 只能来自用户输入或安全存储；不要读取 `.env`，不要进日志，不要走 CLI 参数。
5. `connect.params.auth.token` 与 device signature payload 中的 token 必须一致。
6. 如果首轮返回 `AUTH_TOKEN_MISMATCH` 且建议 `retry_with_device_token`，使用服务端返回的 device token 重新 connect。
7. 第二轮 connect 的 `connect.params.auth.deviceToken` 与 device signature payload 中 token 字段必须一致。
8. 先申请 `operator.read`，拿到 `hello-ok` 后做能力发现。
9. 如果返回 `AUTH_TOKEN_MISSING`，onboarding 提示用户提供 Gateway token。
10. 如果返回 `NOT_PAIRED` / pairing required，onboarding 引导用户批准设备。
11. 收到 `hello-ok.auth.deviceToken` 时，需要评估是否持久化为 device token，并支持 token mismatch / rotation 恢复。
12. 不要在没有 `hello-ok.features.methods/events` 的情况下假设 `health`、`skills.status`、`models.list` 或 chat RPC 一定存在。

## 对产品 Onboarding 的影响

用户是否必须提供 gateway token：当前环境是 `gateway.auth.mode=token`，因此首次验证 `hello-ok` 必须提供 Gateway token，除非已有可用 device token 或其他受信任 auth 模式。

是否可以让用户从 OpenClaw UI 复制 token：未确认。需要后续人工确认 Control UI 的设置 / 基础设施 / 调试 / 日志 / 节点 / 实例页面是否有 token 展示、生成、复制或 pairing approval 入口。若 UI 无入口，需要提供 CLI fallback 或改为更友好的授权流程。

是否需要“连接 OpenClaw”步骤：需要。该步骤至少应包含 Gateway 可达性、token 授权、device identity 创建、hello-ok 检测。

是否需要“批准设备”步骤：可能需要。即使 token 正确，Gateway 仍可能对新 device identity 产生 pending device pairing request；脚本会输出 requestId 摘要但不会自动批准。产品 onboarding 应准备 Dashboard 批准和 CLI `openclaw devices approve <requestId>` 两条路径。

## 残余风险

- OpenCode 当前环境未使用真实 `OPENCLAW_GATEWAY_TOKEN` 运行，因此未确认第二次 device-token retry 是否能成功拿到 `hello-ok`。
- 未确认 token 正确但 device 未批准时的实际错误形状。
- 未确认 `AUTH_TOKEN_MISMATCH` 响应中的 retry device token 是否在所有版本都位于同一字段。
- 未确认 `hello-ok.auth.deviceToken` 是否返回及其持久化策略。
- 未确认基础 RPC payload shape。
- 未确认 Control UI 是否能复制 token 或批准设备。
- 未做 Windows native 实机验证。
