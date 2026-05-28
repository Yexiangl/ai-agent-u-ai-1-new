# OpenClawBackend Implementation Notes

TASK-010：OpenClawBackend 初版接入。

## 架构

```
src/lib/openclawGateway.ts     ← WebSocket Gateway client
    │                              - Ed25519 device identity (localStorage)
    │                              - connect.challenge → sign nonce
    │                              - hello-ok → capabilities discovery
    │                              - RPC request/response
    │                              - event dispatch
    │
src/lib/openclawBackend.ts     ← AgentBackend implementation
    │                              - checkStatus: connect + capabilities
    │                              - startChat: chat.send RPC
    │                              - cancelChat: chat.abort RPC
    │                              - subscribeEvents: map Gateway events → AgentEvent
    │
src/lib/agentBackend.ts        ← Unified interface
    │                              - exports AgentBackend type
    │                              - exports HermesLegacyBackend (unchanged)
    │                              - exports getOpenClawBackend()
    │                              - exports isOpenClawBackendAvailable()
    │
src/App.tsx                    ← Dev switch
                                   - USE_OPENCLAW_BACKEND = false (default)
                                   - When true: uses OpenClawBackend for send/cancel
```

## 关键设计决策

### Device identity

- 使用 `@noble/ed25519` (纯 JS, ~5KB) 进行 Ed25519 签名
- Identity 持久化到 `localStorage` (v0，后续升级到 Tauri 安全存储)
- deviceId = publicKey hex (32 bytes)，Gateway 通过 publicKey 签名验证设备

### Gateway token

- `getOpenClawBackend(token?)` 接受可选的 gateway token 参数
- Token 仅内存使用，不进日志、不存 localStorage、不返回 UI
- v0 中 token 由调用者提供（通过 `USE_OPENCLAW_BACKEND` dev switch 时需手动配置）

### 事件映射

| Gateway Event | AgentEvent |
|---|---|
| `chat` (deltaText) | `text_delta` |
| `chat` (done/stopped) | `message_snapshot` + `done` |
| `session.message` | `message_snapshot` |
| `session.tool` | `tool_event` |
| `agent` | `tool_event` |

### Hermes 保留

- `HermesLegacyBackend` 完全不变
- `USE_OPENCLAW_BACKEND = false` 时行为与修改前完全一致
- Hermes SSE 流式、Tauri 事件监听均保留

## 限制 (v0)

1. Gateway token 通过 Rust command `read_openclaw_gateway_auth_for_local_use` 从 `~/.openclaw/openclaw.json` 读取（dev-only 安全债）
2. Device identity 为内存态 ephemeral，每次重启需重新配对 Gateway
3. 不支持 attachments（`capabilities.attachments = false`）
4. 不支持 memory / cron
5. `chat.send` payload shape 未在真实 Gateway 环境中验证
6. 事件映射基于文档推断，需实机验证

## 修复记录 (Codex 第二次复审)

| 问题 | 状态 |
|---|---|
| Gateway token 注入 | ✅ Rust command + `initOpenClawBackend()` |
| 初始化失败粘住 | ✅ 移除 sticky error, 新增 `resetOpenClawBackend()` |
| 事件订阅顺序 (先发后订) | ✅ 改为先 `subscribeEvents` 后 `startChat` |
| Private key 在 localStorage | ✅ 改为内存态 ephemeral |
| 缺少 App 侧 smoke test | ✅ `OpenClawBackend.runSmokeTest()` |

## 下一步

1. 用户提供 Gateway token → 设置 `USE_OPENCLAW_BACKEND = true` → 验证 `checkStatus`
2. 验证 `chat.send` → 确认事件映射正确
3. 验证 `chat.abort` → 确认取消语义
4. 添加 Rust command `read_openclaw_gateway_token` 从 `~/.openclaw/openclaw.json` 读取 token
5. 迁移 localStorage → Tauri 安全存储
6. 完整 Onboarding 集成

## 禁止事项

- 不输出 Gateway token / device token
- 不修改 OpenClaw 配置
- 不自动重启 Gateway
- 不删除 Hermes

## TASK-017：Onboarding OpenClaw 初始化流程

### 实现日期：2026-05-26

### 修改文件
- `src/App.tsx`：重写 `Onboarding` 组件，新增 `DetectionRow` 辅助组件

### Onboarding 新流程

1. **环境检测**：检测配置文件（`~/.openclaw/openclaw.json`）、Gateway 运行状态、HTTP 对话接口启用状态、Gateway Token 配置状态、可用模型列表。
   - 复用：`readOpenClawConfigSummary` (Rust command)、`checkOpenClawHttpStatus` (Rust command)
   - CLI 未安装时显示安装命令（`curl -fsSL https://openclaw.ai/install.sh | bash`）
   - Gateway 未运行时显示重启命令（`openclaw gateway restart`）
   - HTTP 接口未启用时显示启用命令（`openclaw config set gateway.http.endpoints.chatCompletions.enabled true --strict-json`）

2. **模型供应配置**：Token 密码框 + 速度优先/质量优先档位选择 + "应用到 OpenClaw 配置" 按钮。
   - 复用：`applyOpenClawProviderConfig` (Rust command, TASK-016 实现)
   - 成功后清空 Token 输入框，显示重启提示。

3. **验证连接**："验证 HTTP 对话接口" 按钮调用 `checkOpenClawHttpStatus`。

4. **进入工作台**：调用 `updateConfig({ hasCompletedOnboarding: true })`，不写 `apiKey`。

### Token 安全边界

- Token 仅通过 `applyOpenClawProviderConfig` 传给 Rust command `apply_openclaw_model_provider_config`
- 不进入 `AppConfig.apiKey`
- 不进入 `localStorage` / `sessionStorage`
- 不显示在 UI 中（密码框，应用后清空）
- 不打印日志

### Hermes 移除

Onboarding 不再依赖 Hermes：
- 不再传入 `hermesCli` / `hermesApi` props
- 不再调用 `listModels` / `applyHermesModelConfig`
- 不再使用 `draft.apiKey` / `draft.baseUrl` / `draft.defaultModel`
- UI 文案全部改为 OpenClaw / Agent 引擎

### HTTP-first 验证流程

- 环境检测 → 模型供应配置 → 验证连接 → 进入工作台
- 每步可独立操作和重试
- "稍后配置" 跳过所有配置直接进入工作台

### 后续可优化

- 一键启用 HTTP endpoint（自动执行 config set + restart）
- 一键重启 Gateway（通过 Rust command 调用 `openclaw gateway restart`）
- 设备配对信任级别提示

## TASK-018：Hermes Legacy 入口折叠 / 清理

### 实现日期：2026-05-26

### 修改文件
- `src/App.tsx`：清理所有可见 Hermes 文案，重命名为 Legacy 引擎
- `src/data/tutorials.ts`：移除 Hermes 教程，替换为 OpenClaw/Agent 教程

### 清理汇总

- **createEmptySession 默认模型**：`"hermes-agent"` → `"openclaw/default"`
- **6 个 session 创建调用**：`createEmptySession("hermes-agent")` → `createEmptySession()`（使用默认）
- **systemPrompt Hermes 文案**：`"个人 Hermes Agent"` → `"个人 AI Agent"`
- **错误提示**：所有 `"Hermes 请求失败"`/`"Hermes 对话服务"`/`"Hermes API Server"` → `"Agent 请求失败"`/`"Legacy 引擎对话服务"`/`"Legacy 引擎 API Server"`
- **EnginesPage 高级诊断区**：`"Hermes 状态"`/`"Hermes 路径"` → `"Legacy 引擎状态"`/`"Legacy 引擎路径"`
- **EnginesPage Hermes 应用弹窗**：`"应用配置到 Hermes"` → `"应用配置到 Legacy 引擎"`
- **tutorials.ts**：完整 Hermes 管理/配置教程替换为 OpenClaw 初始化流程

### Hermes 保留
- `HermesLegacyBackend`：完整保留
- `src/lib/hermes.ts`：完整保留
- Rust Hermes commands：完整保留
- Hermes 事件 handler (hermes-chat-chunk/done/error)：完整保留（仅 legacy 路径触发）
- 类型定义中的 Hermes 引用：完整保留
