# 用量概览真实性审计与重构方案

TASK-032A：审计当前用量概览页面数据来源、真实性和缺失项，输出重构方案。

---

## 一、当前用量概览数据来源

### 1.1 页面代码

`src/App.tsx:4057-4182` — `UsagePage()` 组件。

### 1.2 数据来源链路

```
UsagePage
  → readChatSessions()          ← Tauri Rust command: read_chat_sessions
  → 读取本地文件 chat-sessions.json
  → 遍历每个 session.messages
  → 从 message.usage 提取 Token 统计
  → 从 message.modelName 提取模型分布
```

### 1.3 数据统计口径

| 指标 | 数据来源 | 来源字段 | 真实性 |
|---|---|---|---|
| 总会话数 | `sessions.length` | 本地文件 | ✅ 真实 |
| 总消息数 | `allMessages.length` | 本地文件 | ✅ 真实 |
| 总 Token | `message.usage?.total_tokens` | 消息元数据 | ❌ 全为 0 |
| 近 7 天 | `message.usage?.total_tokens`（7 天内） | 消息元数据 | ❌ 全为 0 |
| 今日 Token | `message.usage?.total_tokens`（当天） | 消息元数据 | ❌ 全为 0 |
| 输入 Token | `message.usage?.prompt_tokens` | 消息元数据 | ❌ 全为 0 |
| 输出 Token | `message.usage?.completion_tokens` | 消息元数据 | ❌ 全为 0 |
| 平均每次回复 | `totalTokens / assistantMsgs.length` | 计算值 | ❌ 全为 0 |
| 模型用量分布 | `message.modelName` + `message.usage?.total_tokens` | 消息元数据 | ⚠️ 模型名真实但统计为 0 |
| 最近会话 | `session.updatedAt` + `session.totalTokens` | 会话元数据 | ⚠️ 会话列表真实，token 为 0 |

---

## 二、Token 为 0 的根因

### 2.1 完整链路分析

**Rust 层（`src-tauri/src/main.rs:2352-2359`）**：

```rust
let usage = json.get("usage").cloned();  // ✅ 从 OpenClaw API 响应中提取 usage
// ...
json!({
    "usage": usage,    // ✅ 返回给前端
})
```

Rust `openclaw_http_chat_completion` **确实从 API 响应中提取并返回 usage 字段**。

**TypeScript 客户端层（`src/lib/openclawHttpClient.ts:22,96`）**：

```typescript
export interface OpenClawChatResult {
  usage?: unknown;   // ✅ 类型定义包含 usage
}
// ...
usage?: unknown;     // ✅ invoke 结果定义包含 usage
```

**Backend 适配层（`src/lib/openclawBackend.ts:80-92`）**：

```typescript
const result = await openClawChatCompletion(messages, request.model || CHAT_MODEL);

return {
  // ...
  raw: { content: result.content, model: result.model },  // ❌ 丢弃了 result.usage
};
```

`OpenClawBackend.startChat()` 第 91 行的 `raw` 对象 **只传递了 `content` 和 `model`，丢弃了 `result.usage`**。

**App.tsx 消息保存层（`src/App.tsx:2496-2501`）**：

```typescript
messagesRef.current = messagesRef.current.map((m) =>
  m.requestId === requestId
    ? { ...m, content: ..., modelName: raw?.model || "openclaw/default" }
    // ❌ 没有设置 usage 字段
    : m
);
```

消息更新时 **没有从 `runHandle.raw` 中读取 `usage`**。

**能力声明（`src/lib/openclawBackend.ts:22`）**：

```typescript
export const openclawCapabilities: AgentBackendCapabilities = {
  usage: false,     // ❌ 显式声明不支持 usage
};
```

### 2.2 结论

**Token 全为 0 的根本原因有三个层次**：

1. **P0 (直接原因)**：`OpenClawBackend.startChat()` 丢弃了 Rust 返回的 `usage` 字段
2. **P0 (存储原因)**：`App.tsx` 消息保存时从不设置 `message.usage`
3. **P1 (声明原因)**：`openclawCapabilities` 将 `usage` 声明为 `false`

三个短板叠加，导致 `message.usage` 始终为 `undefined`/`null`，所有 Token 统计全为 0。

### 2.3 Hermes 路径对比

Hermes Legacy 路径（`src/App.tsx:2396,2421`）**确实**设置了 usage：
```typescript
usage: event.payload.rawUsage ?? null,
```
因此如果用户通过 Hermes 路径对话，Token 数据是真实的。但当前主路径已切换为 OpenClaw HTTP-first。

---

## 三、openclaw/default 显示根因

### 3.1 来源

| 位置 | 代码 | 说明 |
|---|---|---|
| `openclawBackend.ts:28` | `const CHAT_MODEL = "openclaw/default"` | OpenClaw 路由 ID |
| `App.tsx:334` | `createEmptySession("openclaw/default")` | 新建会话默认模型 |
| `App.tsx:2222` | `modelName: "openclaw/default"` | 发送时写入消息 |
| `App.tsx:2239` | `modelName: "openclaw/default"` | 失败消息 |
| `App.tsx:2499` | `modelName: raw?.model \|\| "openclaw/default"` | 接收后写入 |
| `App.tsx:2509` | `model: "openclaw/default"` | 保存会话时 |
| `App.tsx:2628` | `modelName: "openclaw/default"` | 后台 run 发送 |
| `App.tsx:2636` | `modelName: "openclaw/default"` | 后台 run 接收 |
| `App.tsx:2674` | `modelName: raw?.model \|\| "openclaw/default"` | 后台 run fallback |
| `App.tsx:2682` | `model: "openclaw/default"` | 后台 run 保存会话 |
| `agentRunStore.ts:12` | `modelName: string; // "openclaw/default"` | 注释说明 |
| `App.tsx:1581` | `formatDisplayModel(ocPrimaryModel) \|\| "openclaw/default"` | ChatPage 显示 fallback |

### 3.2 本质

`openclaw/default` 是 **OpenClaw Gateway 的内部路由别名**，不是面向用户的产品模型名。它指向 OpenClaw 配置中的默认 provider 模型。当 `ocPrimaryModel`（真实配置模型名如 `deepseek-v4-pro`）不可用时，UI 回退到此值。

### 3.3 已有真实模型名字段

- `ocPrimaryModel` / `cf.defaultModelPrimary`：来自 OpenClaw 配置的 `agents.defaults.model.primary`
- `result.model`：OpenClaw API 响应返回的 `model` 字段
- `formatDisplayModel()`：从 `provider/model` 格式中提取短名

---

## 四、OpenClaw 是否返回 usage 字段

**是。** 以下是证据：

1. **Rust 层**（`src-tauri/src/main.rs:2352,2359`）：从 API JSON 响应中 `json.get("usage")` 提取并返回
2. **TypeScript 类型**（`src/lib/openclawHttpClient.ts:22,96`）：`usage?: unknown` 字段存在
3. **API 标准**：OpenAI-compatible `/v1/chat/completions` 响应体必然包含 `usage` 对象（含 `prompt_tokens`、`completion_tokens`、`total_tokens`）

**瓶颈纯粹在前端传递链路**：Rust → `openclawHttpClient` → `openclawBackend.startChat()` → `App.tsx` 消息保存。usage 在 Backend 层被丢弃。

---

## 五、推荐方案

### 5.1 P0：UI 文案修正（本周）

**目标**：避免用户误以为 Token 统计 0 是 bug，并减少 `openclaw/default` 造成的困惑。

| 序号 | 改动 | 位置 |
|---|---|---|
| P0-1 | 页面标题从"使用概况"改为"本地用量概览" | `App.tsx:4113` |
| P0-2 | Token 统计区域增加醒目提示"本页 Token 统计暂未启用" | `App.tsx:4114` 下方 |
| P0-3 | 空状态文案从"暂无使用数据"改为"暂无使用数据，开始一次 AI 对话后这里会自动统计会话数和消息数。Token 统计暂未启用。" | `App.tsx:4120` |
| P0-4 | Token 为 0 时不显示 "0"，改为 "—" 或 "未启用" | `App.tsx:4127-4135` |
| P0-5 | 模型用量分布中 `openclaw/default` 标记为"路由入口"或在模型名旁添加说明 | `App.tsx:4147` |
| P0-6 | 页面底部已有"本页仅做本地估算，不代表真实账单"—保留 | `App.tsx:4120,4114` |

### 5.2 P1：保存 usage 字段（下周）

**目标**：让 Token 统计真实可用。

| 序号 | 改动 | 位置 |
|---|---|---|
| P1-1 | `OpenClawBackend.startChat()` raw 字段增加 `usage: result.usage` | `openclawBackend.ts:91` |
| P1-2 | `App.tsx` 消息保存时设置 `usage: raw?.usage` | `App.tsx:2499`（前台）+ `App.tsx:2674`（后台 run） |
| P1-3 | 后台 run 同口径补 `usage` | `App.tsx:2674` |
| P1-4 | `openclawCapabilities.usage` 改为 `true` | `openclawBackend.ts:22` |
| P1-5 | Token 统计正常后移除 P0 中的"未启用"提示 | UsagePage |

### 5.3 P2：模型名去内部化（下周）

**目标**：用量概览不再显示 `openclaw/default`，改为用户可理解的模型名。

| 序号 | 改动 | 说明 |
|---|---|---|
| P2-1 | 消息 `modelName` 优先使用 `result.model` 替代 `"openclaw/default"` | API 返回的 `model` 是真实模型名 |
| P2-2 | `formatDisplayModel()` 作为通用格式化函数已存在 | 提取 `provider/name` 的短名 |
| P2-3 | 会话保存 `model` 字段不使用 `"openclaw/default"` 硬编码 | 使用 `ocPrimaryModel` 或 API 返回的 model |
| P2-4 | UsagePage 模型用量分布使用 `formatDisplayModel()` 展示 | 将 `openclaw/default` 转为 `default` |

### 5.4 P3：接入服务端真实统计（后续）

**目标**：长期使用服务端（OpenClaw）提供的统计数据替代本地估算。

- OpenClaw Control UI 有"使用情况"页面，可能通过 WebSocket RPC 或 HTTP API 提供统计端点
- 短期不建议接入：当前 HTTP-first 路径还未稳定，WebSocket 为保留路径
- 本地估算（P1 修复后）对于桌面端的日常用量查看已足够

---

## 六、页面改版建议

### 当前页面结构

```
使用概况
├── 总描述（本页统计来自本机历史会话...）
├── 空状态 / 数据区
├── Metric 卡片：会话数 / 消息数 / 总 Token / 近 7 天
├── Metric 卡片：今日 Token / 输入 Token / 输出 Token / 平均
├── 模型用量分布
├── 最近会话
├── 最近使用时间
└── 刷新统计按钮
```

### 建议新结构

```
本地用量概览
├── 总描述（数据来自本机历史会话，非服务端账单）
├── 核心指标：总会话数 / 总消息数 / 用户消息 / AI 回复
├── Token 估算（P1 修复后）：总 Token / 近 7 天 / 输入 / 输出
│   └── 提示：仅为本地估算
├── 模型用量分布（formatDisplayModel 展示）
├── 最近会话
└── 刷新按钮
```

### 文案调整

| 当前 | 建议 |
|---|---|
| 使用概况 | **本地用量概览** |
| 总 Token | **Token 估算**（P0 暂未启用） |
| 今日 Token | **今日估算** |
| 输入 Token | **输入估算** |
| 输出 Token | **输出估算** |

---

## 七、后续任务拆分

| Task ID | 优先级 | 内容 | 预估工时 |
|---|---|---|---|
| TASK-032B | P0 | UI 文案修正：标题改为"本地用量概览"，Token 未启用提示 | 0.5h |
| TASK-032C | P1 | 保存 usage 字段：Backend 传递 + App.tsx 写入 | 1h |
| TASK-032D | P1 | Token 统计真实化：移除"未启用"提示，验证数据 | 0.5h |
| TASK-032E | P2 | 模型名去内部化：message.modelName 使用真实模型名 | 1h |
| TASK-032F | P2 | UsagePage 模型用量分布 formatDisplayModel 化 | 0.5h |
| TASK-032G | P3 | 服务端真实统计评估与接入 | 评估后定 |

---

## 八、审计结论

1. **会话数/消息数**：✅ 真实，来自本地持久化文件
2. **Token 统计**：❌ 全为 0，因为 `OpenClawBackend` 丢弃了 API 返回的 `usage` 字段
3. **openclaw/default**：⚠️ 是 OpenClaw 内部路由 ID，不是产品模型名，大量硬编码在消息和会话保存中
4. **OpenClaw 返回 usage**：✅ 是，Rust 层正确提取，TypeScript 层类型完整，仅 Backend 适配层丢弃
5. **真实模型名可用**：✅ `ocPrimaryModel`（来自 config）和 `result.model`（来自 API 响应）均可用于替代
6. **页面位置**：桌面端用量概览 → 本地用量概览，本地估算即可，短期无需接入服务端统计
