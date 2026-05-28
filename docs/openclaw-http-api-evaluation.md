# OpenClaw HTTP API Evaluation

TASK-012：OpenClaw OpenAI-compatible HTTP API 验证与最小接入评估。

## 结论摘要

**OpenClaw Gateway 的 OpenAI-compatible HTTP APIs 默认 disabled。**

| 端点 | 状态 | 说明 |
|---|---|---|
| `GET /v1/models` | ❌ HTML fallback | 返回 Control UI HTML，非 JSON API |
| `POST /v1/chat/completions` | ❌ 404 | 端点未启用 |
| `POST /v1/responses` | 未测 | 同 config 控制 |
| `POST /v1/embeddings` | 未测 | 同 config 控制 |

## 配置路径

```
gateway.http.endpoints.chatCompletions.enabled = true
```

启用命令（dry-run 已确认路径有效）：

```bash
openclaw config set gateway.http.endpoints.chatCompletions.enabled true --strict-json
```

重启 Gateway 后生效。

## 是否绕过 device pairing

**理论上可以**。HTTP `/v1/chat/completions` 是 OpenAI-compatible 的 stateless endpoint：
- 不需要 WebSocket 连接
- 不需要 `connect.challenge` / nonce / device identity 签名
- 不需要 `hello-ok` / NOT_PAIRED / pairing approval
- 只需要 Authorization header（如果配置了 gateway auth）

但当前 Gateway auth mode 是 `token`，HTTP endpoints 可能需要 Authorization header。

## 是否支持 stream

OpenAI `/v1/chat/completions` 标准支持 `stream: true`（SSE）。如果 OpenClaw 的 HTTP endpoint 实现完整，应支持流式输出。

## 是否能满足当前 App 基础对话

如果启用后可用：
- ✅ 基础 chat（send message → get reply）
- ✅ Stream 流式输出（通过 SSE）
- ✅ 无 device pairing 复杂状态机
- ❌ 无 session 管理（每次请求独立）
- ❌ 无 tool live events
- ❌ 无 skills.status 查询
- ❌ 无 abort 粒度控制
- ❌ 无 usage/capabilities API

## 相比 WebSocket RPC 的方案对比

| 能力 | HTTP /v1/chat/completions | WS Gateway RPC |
|---|---|---|
| 基础对话 | ✅ | ✅ |
| 流式输出 | ✅ (SSE) | ✅ (WS events) |
| 连接复杂度 | 低（1 POST） | 高（connect → challenge → sign → hello-ok） |
| Device pairing | 不需要 | 必须 |
| Session 管理 | 无（stateless） | ✅ sessions.* RPC |
| Tool events | 无 | ✅ session.tool events |
| Abort | 无（HTTP abort） | ✅ chat.abort / sessions.abort |
| Skills 集成 | 无 | ✅ skills.* RPC |
| Usage 查询 | 无 | ✅ usage.* RPC |

## 推荐：HTTP-first 双路径策略

```
┌──────────────────────────────────────────┐
│           AgentBackend                    │
│                                           │
│  ┌─────────────┐    ┌──────────────────┐ │
│  │ HTTP path    │    │ WS RPC path      │ │
│  │ /v1/chat/    │    │ connect →        │ │
│  │ completions  │    │ chat.send →      │ │
│  │ (stateless)  │    │ events           │ │
│  └─────────────┘    └──────────────────┘ │
│       ↑ default          ↑ future        │
└──────────────────────────────────────────┘
```

**Phase 1（现在）**：HTTP `/v1/chat/completions` 作为基础对话路径。简单、无配对、立即可用。
**Phase 2（未来）**：WebSocket RPC 作为高级能力路径（sessions, tools, skills, usage）。

## 下一步

1. 用户手动执行 `openclaw config set gateway.http.endpoints.chatCompletions.enabled true --strict-json`
2. 重启 Gateway
3. 运行 `node scripts/openclaw-http-api-probe.mjs` 确认 HTTP API 可用
4. 测试最小 chat 请求：
   ```bash
   curl -X POST http://127.0.0.1:18789/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"hello"}],"stream":false}'
   ```
5. 如果可用 → TASK-013：改造 OpenClawBackend 为 HTTP-first，接入 `/v1/chat/completions`
6. 如果不可用（需要 auth 或其他）→ 记录原因，继续评估

## 验证

```bash
node scripts/openclaw-http-api-probe.mjs
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
