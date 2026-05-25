# OpenClaw Device Pairing Flow

TASK-009：OpenClaw 设备配对流程最小闭环验证。

## 验证结果

**✅ hello-ok 已打通！基础 RPC 全部成功！**

| 项目 | 结果 |
|---|---|
| hello-ok | ✅ PASS |
| Protocol | 4 |
| Server version | 2026.5.22 |
| RPC methods | 173 |
| Events | 27 |
| RPC health | ✅ PASS |
| RPC status | ✅ PASS |
| RPC skills.status | ✅ PASS — 58 skills |
| RPC models.list | ✅ PASS — gpt-5.5 configured |

## 关键突破

之前的 TASK-005~TASK-007 失败原因不是协议、签名或字段形状问题，而是：

1. **Token 来源错误**：`OPENCLAW_GATEWAY_TOKEN` 环境变量中的 token (length=21) 与 `~/.openclaw/openclaw.json` 中 `gateway.auth.token` (length=48) **不是同一个值**。这导致所有尝试都返回 `AUTH_TOKEN_MISMATCH`。

2. **CLI 脱敏**：`openclaw config get gateway.auth.token` 永远返回 `__OPENCLAW_REDACTED__`，不能用。

3. **正确 token 来源**：`~/.openclaw/openclaw.json` → `gateway.auth.token`。在 `gateway.auth.mode=token` 时，connect 必须携带这个 token。

4. **client.id 约束**：connect frame 的 `client.id` 必须是 Gateway 允许的值（`gateway-client` 有效）。

## 设备配对流程

### 正常流程（当前已验证）

```
1. Probe 从 ~/.openclaw/openclaw.json 读取 gateway token
2. Probe 生成/复用 Ed25519 device identity
3. WS connect → connect.challenge → 签名 nonce → send connect frame
4. Gateway 验证 token + device signature
5. hello-ok 返回
6. RPC 可用
```

### 未配对设备流程（probe 代码已支持，待验证）

```
1. 同上 1-3
2. Gateway 返回 NOT_PAIRED + requestId
3. 用户执行: openclaw devices approve <requestId>
4. 或在 Control UI (http://127.0.0.1:18789) 批准
5. Probe 自动重试（轮询最多 2 分钟）
6. hello-ok 返回
7. RPC 可用
```

## Gateway 当前状态摘要

| 项目 | 值 |
|---|---|
| Auth mode | `token` |
| Bind | `loopback` (127.0.0.1:18789) |
| Control UI | `http://127.0.0.1:18789`, `allowInsecureAuth=true` |
| Gateway token 位置 | `~/.openclaw/openclaw.json` → `gateway.auth.token` |
| 已配对设备 | 2 (Control UI + CLI probe) |
| 待批准请求 | 1 (CLI operator.pairing 权限升级) |

## 用户如何获取 Gateway Token

1. **Control UI**：打开 `http://127.0.0.1:18789`，进入设置 / 基础设施页面
2. **配置文件**：`~/.openclaw/openclaw.json` 中的 `gateway.auth.token`
3. **不能用** `openclaw config get gateway.auth.token`（CLI 自动脱敏）

## 用户如何批准设备

### CLI 方式

```bash
# 查看待批准请求
openclaw devices list

# 批准指定请求
openclaw devices approve <requestId>
```

### Control UI 方式

打开 `http://127.0.0.1:18789`，进入 Devices / Pairing 页面批准。

## Product Onboarding 设计建议

### 流程

```
┌──────────────────────────────────────────────────┐
│  1. "连接 OpenClaw"                               │
│     - 检测 Gateway 是否运行在 127.0.0.1:18789     │
│     - 检测 auth mode                              │
│     - 如果 mode=token，要求用户提供 gateway token  │
│     - 提供"打开 OpenClaw Dashboard"按钮            │
│     - 说明 token 在哪里复制                        │
├──────────────────────────────────────────────────┤
│  2. "授权设备"                                    │
│     - App 生成 Ed25519 device identity             │
│     - App 发起 connect (gateway token + identity)  │
│     - 如果 NOT_PAIRED，显示 requestId             │
│     - 引导用户批准设备                             │
│     - App 轮询重试直到 hello-ok                   │
├──────────────────────────────────────────────────┤
│  3. "连接成功"                                    │
│     - hello-ok 收到                               │
│     - 持久化 device token（如有）                  │
│     - 能力发现（features.methods/events）          │
│     - 进入工作台                                  │
└──────────────────────────────────────────────────┘
```

### 安全注意事项

- Gateway token **只能在内存中使用**，不进日志、不上报、不写入明文文件
- App 应使用 OS 安全存储（macOS Keychain / Windows Credential Manager）保存 device identity 和 device token
- Device identity（private key）必须 0600 权限
- 后续连接优先使用 device token（不暴露 gateway token）

## 后续 App 实现建议

### Device Identity 持久化

```
~/.openclaw-agents/
└── ai-agent-workspace/
    ├── device-identity.json   # Ed25519 keypair (0600)
    └── device-token.json      # Gateway-returned device token (0600)
```

### OpenClawBackend 初始化流程

```typescript
async function initializeOpenClawBackend(gatewayToken: string) {
  // 1. Load or create device identity
  const identity = loadOrCreateDeviceIdentity();
  
  // 2. Connect to Gateway
  const ws = new WebSocket("ws://127.0.0.1:18789");
  
  // 3. Wait for connect.challenge
  // 4. Sign nonce with device private key
  // 5. Send connect frame with gatewayToken + device identity
  
  // 6a. If hello-ok → save device token if returned → ready
  // 6b. If NOT_PAIRED → show requestId → wait for approval → retry
  // 6c. If AUTH_TOKEN_MISMATCH → prompt user for correct token
  
  // 7. Discover capabilities from hello-ok.features
  // 8. Ready for chat.send, sessions.*, skills.* etc.
}
```

## 验证

```bash
node scripts/openclaw-pairing-flow-probe.mjs
npm run build
cargo check
```
