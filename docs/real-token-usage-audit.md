# 真实 Token Usage 字段审计

TASK-032A：确认 OpenClaw HTTP 对话响应中是否包含真实 usage 字段，定位 Token 为 0 的根因，给出接入方案。

---

## 1. 当前对话链路

```
用户点击发送
  └─ App.tsx doSend()
       └─ OpenClawBackend.startChat()
            └─ openclawHttpClient.openClawChatCompletion()
                 └─ Tauri invoke("openclaw_http_chat_completion")
                      └─ Rust main.rs
                           └─ reqwest POST http://127.0.0.1:18789/v1/chat/completions
                                └─ OpenClaw Gateway
                                     └─ 下游模型供应（deepseek-v4-pro 等）
                                          └─ 返回 OpenAI-compatible JSON 响应
```

---

## 2. 当前 usage 字段情况

### 2.1 各层验证

| 层 | 位置 | 获取 usage？ | 返回 usage？ |
|---|---|---|---|
| API 响应 | OpenClaw Gateway `/v1/chat/completions` | ✅ 包含完整 usage 对象 | N/A |
| Rust | `main.rs:2352` — `json.get("usage").cloned()` | ✅ 提取 | ✅ 返回 |
| TypeScript 客户端 | `openclawHttpClient.ts:22,96` — `usage?: unknown` | ✅ 类型定义 | ✅ invoke 返回 |
| Backend 适配层 | `openclawBackend.ts:91` | ❌ **丢弃** | ❌ 未传递 |
| App 消息保存 | `App.tsx:2499` (前台) `App.tsx:2674` (后台 run) | ❌ **不设置** | ❌ 未写入 |

### 2.2 API 响应验证

通过本地 probe 确认，OpenClaw HTTP `/v1/chat/completions` 接口返回 **完整的 OpenAI-compatible usage 对象**：

```
Top-level keys: id, object, created, model, choices, usage
usage EXISTS
usage keys: prompt_tokens, completion_tokens, total_tokens
```

示例值（一次简单对话）：prompt_tokens=21819, completion_tokens=5, total_tokens=21824。

### 2.3 Rust 层确认

`src-tauri/src/main.rs:2352-2359`：

```rust
let usage = json.get("usage").cloned();          // ✅ 从 API 响应提取
return Ok(serde_json::json!({
    "ok": true,
    "content": content,
    "model": json.get("model")...,                // ✅ 返回模型名
    "usage": usage,                                // ✅ 返回 usage
}));
```

### 2.4 TypeScript 类型确认

`src/lib/openclawHttpClient.ts:17-24`：

```typescript
export interface OpenClawChatResult {
  ok: boolean;
  content?: string;
  model?: string;
  finishReason?: string;
  usage?: unknown;      // ✅ 类型定义包含 usage
  error?: string;
}
```

---

## 3. 当前 Token 为 0 的根因

**根因不是"没有数据源"，而是"数据被丢弃"。**

完整链路：

1. **API 确实返回 usage**（已通过本地 probe 证实）
2. **Rust 确实提取并返回 usage**（`main.rs:2352,2359`）
3. **TypeScript 客户端类型支持 usage**（`openclawHttpClient.ts:22`）
4. **Backend 适配层丢弃 usage** → **根因点 1**（`openclawBackend.ts:91`）

```typescript
// openclawBackend.ts:86-92
return {
  backend: this.type,
  requestId: request.requestId,
  sessionId: request.sessionId ?? null,
  accepted: true,
  raw: { content: result.content, model: result.model },  // ❌ 丢弃了 result.usage
};
```

5. **App.tsx 不设置 message.usage** → **根因点 2**（`App.tsx:2499`）

```typescript
// App.tsx:2498-2500 前台
? { ...m, content: ..., modelName: raw?.model || "openclaw/default" }
                                                     // ❌ 未设置 usage 字段
// App.tsx:2674-2675 后台 run 同
```

6. **能力声明为 false** → **根因点 3**（`openclawBackend.ts:22`）

```typescript
usage: false,  // ❌ 与实际情况不符
```

### 补充：数据模型已就绪

`UiChatMessage` 类型（`src/App.tsx:64`）和 Hermes 接口类型（`src/lib/hermes.ts:37,64,154`）均已定义 `usage` 字段：

```typescript
usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
```

数据模型完整，仅需填充数据。

---

## 4. openclaw/default 根因

### 4.1 本质

`openclaw/default` 是 **OpenClaw Gateway 的内部路由别名**，不是面向用户的产品模型名。它的含义是"使用 OpenClaw 配置中默认的模型供应和模型"。

### 4.2 硬编码位置

| 位置 | 代码 | 上下文 |
|---|---|---|
| `openclawBackend.ts:28` | `const CHAT_MODEL = "openclaw/default"` | 请求模型 |
| `App.tsx:334` | `createEmptySession("openclaw/default")` | 新会话默认 |
| `App.tsx:2222` | `modelName: "openclaw/default"` | 发送消息 |
| `App.tsx:2499` | `modelName: raw?.model \|\| "openclaw/default"` | 回复消息 |
| `App.tsx:2509` | `model: "openclaw/default"` | 保存会话 |
| `App.tsx:2628,2636` | `modelName: "openclaw/default"` | 后台 run |
| `App.tsx:2674` | `modelName: raw?.model \|\| "openclaw/default"` | 后台 run 回复 |
| `App.tsx:2682` | `model: "openclaw/default"` | 后台 run 保存 |
| `agentRunStore.ts:12` | `modelName: "openclaw/default"` | 注释说明 |

### 4.3 可替代的真实模型名

- **`result.model`**：API 响应返回的 `model` 字段（值为 `"openclaw/default"`，即本例中仍是路由名）
- **`ocPrimaryModel`**：来自 OpenClaw 配置的 `agents.defaults.model.primary`（值为 `"deepseek-v4-pro"` 等真实模型名）
- **`formatDisplayModel()`**：从 `provider/model` 格式提取短名（`deepseek-v4-pro` → `deepseek-v4-pro`）

---

## 5. 推荐实现方案

### 5.1 TASK-032B：保存真实 usage ✅ 已完成（2026-05-28）

**实现**：

| 文件 | 位置 | 改动 |
|---|---|---|
| `openclawBackend.ts:22` | `usage: false` → `usage: true` | 能力声明 |
| `openclawBackend.ts:91` | `raw` 增加 `usage: result.usage` | Backend 透传 usage |
| `App.tsx:2492` | `raw` 类型增加 `usage?: unknown` | 类型标注 |
| `App.tsx:2499` | 消息写入增加 `usage: raw?.usage` | 前台保存 |
| `App.tsx:2674` | 消息写入增加 `usage: raw?.usage` | 后台 run 保存 |

**链路**：API → Rust → HttpClient → Backend.raw → App.tsx message.usage ✅

**不变量**：
- 只对 assistant message 保存 usage
- usage 不存在时保持 undefined，不伪造 0
- 不改 chat-sessions 数据结构（`UiChatMessage.usage` 类型已存在）
- 不做本地 token 估算
- 不改用量概览 UI

**前置条件**：API 已返回 usage（已证实 ✅）

| 步骤 | 文件 | 改动 |
|---|---|---|
| 1 | `openclawBackend.ts:91` | `raw` 增加 `usage: result.usage` |
| 2 | `App.tsx:2499` | 前台消息写入 `usage: raw?.usage` |
| 3 | `App.tsx:2674` | 后台 run 消息写入 `usage: raw?.usage` |
| 4 | `openclawBackend.ts:22` | `usage: false` → `usage: true` |
| 5 | 验证 | 发送一次对话 → 用量概览 → Token 统计应有真实数字 |

**不改的数据结构**：`UiChatMessage.usage` 字段已存在，无需修改类型。

### 5.2 TASK-032C：用量概览 UI 修正（P0，预计 0.5h）

| 序号 | 改动 | 说明 |
|---|---|---|
| 1 | 标题 "使用概况" → **"本地用量概览"** | 明确数据来源 |
| 2 | Token 统计区域增加提示 "本页 Token 统计来自本机历史会话，非服务端账单" | 已有类似文案，确认即可 |
| 3 | Token 为 0 时标记为 "暂未统计" 而非 "0" | 避免误导 |
| 4 | 模型用量分布中 `openclaw/default` 使用 `formatDisplayModel()` 美化 | 显示 "default" 更友好 |

### 5.3 TASK-032D：模型名去内部化（P2，预计 1h）

| 步骤 | 文件 | 改动 |
|---|---|---|
| 1 | `App.tsx:2222,2499,2628,2636,2674` | `modelName` 优先使用 `result.model` 或 `ocPrimaryModel`，再 fallback |
| 2 | `openclawBackend.ts:28` | 注释说明 `CHAT_MODEL` 为路由 ID |
| 3 | `App.tsx:334` | 新会话默认模型使用 `ocPrimaryModel` |
| 4 | UsagePage | 模型分布使用 `formatDisplayModel()` 展示 |

---

## 6. 风险与边界

### 安全边界

| 约束 | 状态 |
|---|---|
| 不接服务端后台 | ✅ 本地会话统计即可 |
| 不接 New API 管理接口 | ✅ |
| 不存 Token | ✅ usage 对象不含 Token |
| 不存 provider/baseUrl/API URL | ✅ |
| 不输出敏感日志 | ✅ usage 仅含 token 计数 |
| 不读取 .env | ✅ 所有数据来自已有 API 响应 |

### 功能边界

| 项目 | 当前状态 |
|---|---|
| Token 统计来源 | 本机历史会话中的 `message.usage` |
| 会话数/消息数来源 | 本地持久化文件（真实） |
| 模型名来源 | 消息 `modelName` 字段（当前为 `openclaw/default`） |
| 本地估算 vs 服务端统计 | 当前为本地会话聚合，不依赖服务端统计接口 |
| 不做本地 token 估算（如按字符数估算） | 待真实 usage 接入后再评估必要性 |

---

## 7. 结论

1. **OpenClaw API 确实返回 usage** ✅ — 包含 `prompt_tokens`、`completion_tokens`、`total_tokens`
2. **Rust 层正确提取并返回 usage** ✅
3. **TypeScript 客户端类型完整** ✅
4. **瓶颈在 Backend 适配层** ❌ — `startChat()` 丢弃了 `result.usage`
5. **UiChatMessage 数据模型已就绪** ✅ — `usage` 字段已定义，仅需填充
6. **修复成本极低** — 仅需在 3 个位置传递 already-available 数据（2 行 Backend + 2 行 App.tsx）
7. **建议立即进入 TASK-032B**
