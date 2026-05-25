# OpenClaw Gateway Auth Source Notes

TASK-008：确认 Gateway 当前真实 auth token 来源与设备批准流程。

## 结论摘要

**hello-ok 未打通的根本原因已定位：**

1. `openclaw config get gateway.auth.token` 永远返回 `__OPENCLAW_REDACTED__` — CLI 自动脱敏。
2. Gateway auth mode 为 `token`，要求首次设备配对时提供 gateway token。
3. `openclaw` CLI **自身**可以连接 Gateway 并执行 RPC（`rpc.ok=true`），因为它使用了 `~/.openclaw/identity/` 中的已配对设备身份。
4. TASK-007 probe 脚本生成的设备身份（`/tmp/ai-agent-workspace-openclaw-auth-probe-device.json`）**不在 Gateway 的已配对或待批准列表中** — 是一个完全未知的身份。
5. `canRetryWithDeviceToken=true` 是 **boolean capability flag**（表示 Gateway 支持 device token retry），不是 token 值。
6. `recommendedNextStep=retry_with_device_token` 的意思是：请使用一个**已配对的** device token。

## Token 来源对比

| 来源 | 方式 | 结果 |
|---|---|---|
| `openclaw config get gateway.auth.token` | CLI | `__OPENCLAW_REDACTED__`（自动脱敏） |
| `OPENCLAW_GATEWAY_TOKEN` 环境变量 | 用户手动设置 | 存在时 length=21, has_newline=false |
| `~/.openclaw/openclaw.json` | 配置文件 | `gateway.auth.token` 字段含真实 token |
| Control UI (http://127.0.0.1:18789) | Web UI | `allowInsecureAuth=true`，loopback 模式可能直接进入 |
| `~/.openclaw/identity/device-auth.json` | CLI 身份文件 | CLI 自身的 device token（已配对） |

## Gateway auth mode

- 当前模式：`token`
- 支持的模式：`token` / `password` / `none`（可能有 `local-only`）
- 当前未修改，保持 `token`

## Device pairing 状态

### 已配对设备 (2)

| deviceId | clientId | clientMode | scopes |
|---|---|---|---|
| `62f5c064c3a6...` | `openclaw-control-ui` | webchat | admin/read/write/approvals/pairing (全部) |
| `cb19224ce41d...` | `cli` | probe | operator.read |

### 待批准请求 (1)

| requestId | deviceId | clientMode | scopes |
|---|---|---|---|
| `b52c4efc-...` | `cb19224ce41d...` | cli | operator.pairing (权限升级) |

### Probe 设备身份

- deviceId: `618cb522122f...`
- 状态：**NOT paired AND NOT pending** — Gateway 不认识这个身份

## Control UI

- URL: `http://127.0.0.1:18789`
- 配置: `allowInsecureAuth: true`（loopback 模式）
- 用户可能可在 Control UI → 设置 → 基础设施中找到 gateway token
- CLI 备选：用户手动从 `~/.openclaw/openclaw.json` 中复制 `gateway.auth.token`

## Auth 错误码含义映射

| 错误 | 含义 | 下一步 |
|---|---|---|
| `AUTH_TOKEN_MISSING` | connect frame 没有 auth.token | 在 connect.params.auth 中提供 gateway token |
| `AUTH_TOKEN_MISMATCH` | 提供的 token 与 config gateway.auth.token 不匹配 | 确认 token 来源正确，或使用已配对 device token |
| `DEVICE_IDENTITY_REQUIRED` | 没有 device 字段或 device 签名无效 | 添加 Ed25519 device identity + nonce signature |
| `AUTH_DEVICE_TOKEN_MISMATCH` | device token 无效/过期/不属于已配对设备 | 重新配对或轮换 device token |
| `NOT_PAIRED` | device identity 不在配对表中 | 需要 pairing: openclaw devices approve <requestId> |

## canRetryWithDeviceToken 语义

- **不是 token 值** — 是 boolean capability flag
- `true` = Gateway 支持使用已配对设备的 device token 重试
- 用户需要在 connect.params.auth.deviceToken 中提供**已配对设备**的 token
- 这个 token 在设备首次配对批准后由 Gateway 返回并存储在 `~/.openclaw/devices/paired.json`

## 对产品的影响

1. **Onboarding 需要 gateway token**：`gateway.auth.mode=token` 意味着首次设备配对必须提供 gateway token。
2. **用户获取 token 的路径**：
   - Control UI (`http://127.0.0.1:18789`) → 设置 → 基础设施
   - 手动从 `~/.openclaw/openclaw.json` 复制 `gateway.auth.token`
   - CLI 自动脱敏，不能用 `openclaw config get` 获取
3. **"打开 OpenClaw Dashboard"按钮**：应在 Onboarding 中提供，引导用户复制 token。
4. **device token 复用**：设备一旦配对，可用 device token 替代 gateway token 进行后续连接。
5. **安全存储**：gateway token 和 device token 都应由 Tauri App 安全存储，不进日志、不上报。

## OpenClawBackend 策略建议

1. **App 使用持久化设备身份**：在 `~/.openclaw/devices/` 或 App 自有安全目录中生成并保存 Ed25519 keypair。
2. **首次配对**：用户提供 gateway token → App connect 时发送 device identity → Gateway 返回 NOT_PAIRED → 用户在 Control UI 或 CLI 批准 → App 重连收到 hello-ok + device token → 持久化 device token。
3. **后续连接**：使用已保存的 device token，无需用户再次提供 gateway token。
4. **不要**尝试绕过配对流程直接猜 token 或复用 CLI 身份。

## 验证命令

```bash
node scripts/openclaw-auth-source-probe.mjs
npm run build
cargo check
```
