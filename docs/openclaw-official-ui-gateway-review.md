# OpenClaw 官方 UI Gateway 客户端调研

TASK-012 Phase A：参考 OpenClaw 官方 Gateway 客户端实现，确认项目 `openclawGateway.ts` 重构方向。

## 1. hashes.sha512 not set — 根因与修复

### 错误

```
OpenClaw 请求异常：hashes.sha512 not set
```

### 根因

`@noble/ed25519` v3 默认只提供 async 方法（`signAsync`、`getPublicKeyAsync`、`keygenAsync`）。同步方法需要显式设置 `ed.hashes.sha512`。

当前 `openclawGateway.ts` 使用了同步方法：
- `ed.utils.randomSecretKey()` — 同步
- `ed.getPublicKey(priv)` — 同步
- `ed.sign(data, privateKey)` — 同步

但**从未设置** `ed.hashes.sha512 = sha512`。

### 官方修复方式（noble-ed25519 README）

```ts
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
ed.hashes.sha512 = sha512;
// Sync methods now work:
ed.keygen();
ed.getPublicKey(secretKey);
ed.sign(message, secretKey);
```

### 备选方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 设置 `ed.hashes.sha512 = sha512` | 最小改动，1 行修复 | 需要在模块顶层执行 |
| B. 全部改用 async 方法 | 无需 sha512 设置 | 大量重构，async 构造函数不可行 |
| C. 迁移到 Rust/Tauri 后端 | 安全性更好，token 不经过 JS | 重大重构，需 P1 规划 |

**推荐**：方案 A 作为立即修复，方案 C 作为 P1 路线。

## 2. 官方 UI Gateway 客户端模式

基于 `docs/openclaw-backend-research.md` 中的调研和 TASK-009 验证的协议交互：

### 2.1 WebSocket 连接

```
1. new WebSocket("ws://127.0.0.1:18789")
2. Gateway sends: { type: "event", event: "connect.challenge", payload: { nonce, ts } }
3. Client sends: { type: "req", id, method: "connect", params: { ... } }
4. Gateway responds: { type: "res", id, ok: true, payload: { protocol, server, features, auth, ... } }
```

### 2.2 connect.challenge 处理

官方协议要求：
- 客户端必须等待 `connect.challenge` 事件
- 提取 `nonce` 从 `payload.nonce`
- 用 nonce 参与 device identity 签名

当前实现 **正确**：我们在 `message` handler 中匹配 `frame.event === "connect.challenge"` 后提取 nonce 并发送 connect。

### 2.3 connect frame 结构

官方 protocol v4 connect params：

```json
{
  "minProtocol": 4,
  "maxProtocol": 4,
  "client": { "id": "...", "displayName": "...", "version": "...", "platform": "...", "mode": "backend" },
  "role": "operator",
  "scopes": ["operator.read"],
  "caps": [],
  "commands": [],
  "permissions": {},
  "auth": { "token": "..." },
  "locale": "en-US",
  "device": {
    "id": "sha256(publicKey)",
    "publicKey": "base64url(publicKeyRaw)",
    "signature": "base64url(ed25519_sign(payload))",
    "signedAt": 1234567890,
    "nonce": "challenge_nonce"
  }
}
```

当前实现 **正确**：结构匹配官方协议。

### 2.4 Token / device identity 处理

官方支持：
- `auth.token` — gateway shared token（当前使用）
- `auth.deviceToken` — 已配对设备的 device token
- `auth.password` — gateway password（alternative）
- `auth.type` — `"device"` 表示 device token auth

当前实现 **使用 gateway token**，device identity 为 ephemeral（每次重启重新生成）。需要后续支持 device token 持久化。

### 2.5 hello-ok 接收

官方 hello-ok payload：

```json
{
  "protocol": 4,
  "server": { "version": "2026.5.22" },
  "features": {
    "methods": ["health", "status", "chat.send", ...],
    "events": ["chat", "session.message", "session.tool", ...]
  },
  "auth": {
    "role": "operator",
    "scopes": ["operator.read"],
    "deviceToken": "..." // optional
  },
  "policy": { ... }
}
```

当前实现 **正确**：解析 `features.methods` 和 `features.events` 存入 capabilities。

### 2.6 RPC request

```json
{ "type": "req", "id": "...", "method": "chat.send", "params": { ... } }
```

响应：
```json
{ "type": "res", "id": "...", "ok": true, "payload": { ... } }
```

当前实现 **正确**：使用 `request<T>()` 方法，内部管理 pending Map。

### 2.7 Event 订阅

Gateway 主动推送 events：

```json
{ "type": "event", "event": "chat", "payload": { "deltaText": "...", "sessionKey": "...", "runId": "..." } }
```

当前实现 **部分正确**：
- `onEvent()` 注册 listener ✅
- `dispatch()` 广播事件 ✅
- 事件类型映射到 AgentEvent 在 `openclawBackend.subscribeEvents()` 中 ✅

但事件映射表基于文档推断，未在实机上验证 `chat.send` 后的实际 event payload shape。

### 2.8 Reconnect / error handling

官方建议：
- 检测 sequence gap 后刷新 `health`、presence 或 history
- events 不可重放
- 断线后需要重新 connect

当前实现 **缺失**：
- 无自动重连
- 无 sequence gap 检测
- 断线后 `isConnected` 变为 false，需要手动重新 `connect()`
- `cleanup()` 会清除所有 pending requests

## 3. 当前项目 openclawGateway.ts vs 官方实现差异

| 方面 | 官方 | 当前项目 | 状态 |
|---|---|---|---|
| WS 连接 | WebSocket API | ✅ 相同 | OK |
| connect.challenge 处理 | 等待 challenge → 签名 nonce | ✅ 正确 | OK |
| connect frame 结构 | v4 protocol, device identity | ✅ 正确 | OK |
| Ed25519 签名 | noble-ed25519 sync | ❌ 未设置 sha512 | **需修复** |
| hello-ok 解析 | features.methods/events | ✅ 正确 | OK |
| RPC 请求/响应 | req/res frames + id | ✅ 正确 | OK |
| Event 分发 | 全局 event listeners | ✅ 正确 | OK |
| Device identity | 持久化到安全存储 | ❌ ephemeral 内存 | P1 待修 |
| Gateway token | 从 config 读取 | ⚠️ 通过 Rust command | dev-only 安全债 |
| 自动重连 | 支持 | ❌ 未实现 | P1 待修 |
| Sequence gap 检测 | 支持 | ❌ 未实现 | P2 |
| chat.send payload | 需实机验证 | ⚠️ 基于文档推断 | 需验证 |

## 4. 是否应迁移到 Rust/Tauri 后端

### 反对立即迁移的理由

1. **官方 Control UI 也是 JS 实现**：OpenClaw 自带的 Web Control UI 同样使用浏览器 WebSocket + noble-ed25519。
2. **开发迭代速度**：JS 层修改 → 即时生效。Rust 层需要重新编译。
3. **TASK-010/011 刚刚稳定**：现在迁移到 Rust 会破坏已有功能。
4. **复杂度**：Rust 需要 `tokio-tungstenite` + `ed25519-dalek` + async runtime 管理。

### 支持 P1 迁移的理由

1. **Token 安全**：gateway token 目前经过 JS 层（Rust command → JS → WS connect）。在 Rust 后端全权管理 WS 可以消除这个安全债。
2. **Device identity 安全**：private key 在 JS heap 中，Rust 可以放在 OS 安全存储。
3. **重连逻辑**：Rust 的 async runtime 更适合管理长连接生命周期。
4. **Hermes 先例**：Hermes 的 SSE 流式代理就是 Rust 后端管理，事件通过 `app.emit()` 推到前端。

### 推荐路线

| 阶段 | 内容 |
|---|---|
| **现在 (P0)** | 修复 `ed.hashes.sha512 = sha512`，解决 hashes.sha512 not set |
| **P1** | 新增 Rust command `openclaw_gateway_connect`，Rust 后端管理 WS 连接 |
| **P1** | Rust 管理 device identity（`ed25519-dalek`），持久化到 app data dir |
| **P1** | Rust 管理 gateway token 读取，不经过 JS 层 |
| **P2** | Rust 管理 chat.send RPC + event 映射 + 重连 |

## 5. 对当前项目的建议

### 立即修复（TASK-012 Phase A 输出）

在 `openclawGateway.ts` 顶部添加：

```ts
import { sha512 } from "@noble/hashes/sha2.js";
ed.hashes.sha512 = sha512;
```

### 后续重构方向

1. **不要重写 openclawGateway.ts**：协议实现基本正确，只需修复 sha512 设置。
2. **优先验证 chat.send**：在修复 sha512 后，立即验证 `chat.send` 的实际 payload 和 event shape。
3. **事件映射校准**：基于实际 event payload 更新 `openclawBackend.subscribeEvents()` 中的事件映射。
4. **P1 迁移到 Rust**：当 chat.send 验证通过后，规划 Rust 后端接管 WS 连接。
