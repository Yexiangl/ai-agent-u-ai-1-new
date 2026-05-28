# Agent 后台运行任务与跨页面持续生成 - 方案设计

TASK-021A：后台任务不中断架构方案设计。

日期：2026-05-26 | 本轮只做方案设计，不改业务代码。

---

## 一、当前实现分析

### 1.1 代码结构

| 层 | 文件 | 角色 |
|---|---|---|
| 路由 | `App.tsx:933-943` | `Page()` 用 `if (active === "chat") return <ChatPage />`，切换即卸载 |
| 状态 | `App.tsx:1523-1551` | `messages`/`messagesRef`/`chatSessions`/`loading`/`currentSessionId` 全在 ChatPage 内部 |
| 发送 | `App.tsx:2066-2435` | `send()` 用 `await oc.startChat(...)` 同步等待 |
| 完成后 | `App.tsx:2391-2400` | HTTP 返回后写 `messagesRef.current`→`setMessages`→`saveCurrentSession` |
| 持久化 | `App.tsx:1638-1651` | `saveCurrentSession`→`updateSessionsView`→`enqueueWriteSessions`→`writeChatSessions` |
| 取消 | `App.tsx:2437-2474` | `stopGeneration` 本地标记 `stoppedIdsRef`，`OpenClawBackend.cancelChat()` 为空实现 |
| 后端 | `openclawBackend.ts:74-93` | `startChat` → `openClawChatCompletion`(Rust command)，`stream=false`，同步返回 |

### 1.2 10 个分析问题

**1. 当前 OpenClaw 请求是否会因为切页面被取消？**

**会。** `Page()` 条件渲染 → `active !== "chat"` 时 React 卸载 ChatPage 组件。`send()` 中的 `await oc.startChat(...)` 返回后 `setMessages`/`setLoading` 调用对象已卸载。但 Rust HTTP 请求本身独立运行，不会被取消。

**2. 当前 request Promise 存在哪里？**

`send()` 函数的 `try` 块内（line 2375）：`const runHandle = await oc.startChat(...)`。Promise 由 `OpenClawBackend.startChat()` 返回，调用链为 `openClawChatCompletion` → `invoke("openclaw_http_chat_completion")` → Rust reqwest。Promise 独立于组件生命周期，但 `.then()`/`await` 之后的代码在组件作用域内。

**3. 当前消息状态是否在 App 顶层还是 ChatPage 局部？**

**全在 ChatPage 局部：**

| 状态变量 | 行号 | 类型 |
|---|---|---|
| `messages` | 1523 | `useState<UiChatMessage[]>` |
| `messagesRef` | 1551 | `useRef<UiChatMessage[]>` |
| `chatSessions` | 1524 | `useState<ChatSession[]>` |
| `chatSessionsRef` | 1552 | `useRef<ChatSession[]>` |
| `currentSessionId` | 1525 | `useState<string \| null>` |
| `currentSessionIdRef` | 1553 | `useRef<string \| null>` |
| `loading` | 1533 | `useState<boolean>` |
| `activeRequestRef` | 1554 | `useRef<string \| null>` |

App 顶层（`App()` line 551）无任何 run state 或消息状态。

**4. 当前 saveCurrentSession 何时调用？**

| 调用点 | 行号 | 触发场景 | 保存内容 |
|---|---|---|---|
| `saveCurrentSession(nextMessages)` | 2126 | 发送后 | 用户消息（不含 assistant 回复） |
| `saveCurrentSession(nextRef, { model })` | 2400 | HTTP 响应返回后 | 完整对话（含 assistant 回复） |
| `saveCurrentSession(failedMessages, ...)` | 1662 | 错误时 | 错误摘要替换 assistant 消息 |
| `saveCurrentSession(messagesRef.current)` | 2466 | stopGeneration | 停止状态（partial + warning） |

**5. 当前 stopGeneration 对 HTTP-first 是否只是本地取消？**

**是。** HTTP-first v0 的 `OpenClawBackend.cancelChat()` 是空实现（`openclawBackend.ts:95-98`）。`stopGeneration` 仅做本地清理：标记 `stoppedIdsRef`、清除 timer、标记消息为 "已停止生成"。无法真正中断 Rust 端的 HTTP 请求。

**6. 当前是否有 active run / pending run 概念？**

**无。** 只有 ChatPage 局部的：
- `activeRequestRef` (string | null) — 当前 requestId
- `loading` (boolean) — 是否正在请求
- `stoppedIdsRef` (Set<string>) — 已停止的 requestId 集合

**7. 当前 requestId 是否足够作为 runId？**

**足够。** `requestId`（`crypto.randomUUID()`）在发送时生成，贯穿全生命周期：用户消息 → assistant placeholder → 后端请求 → 响应处理 → stop/cancel。可直接作为 `runId` 使用。

**8. 当前多次连续发送是否安全？**

**依赖 `loading` 布尔标志。** `send()` 首行检查 `if (loading) return`。但如果切页面后回到 ChatPage（组件重新挂载，`loading` 重置为 `false`），前一个请求尚未完成时用户可发起新请求，导致并发。

**9. 当前如果请求返回时用户已经切页面，会发生什么？**

1. Rust HTTP 请求正常完成（独立进程）
2. `setMessages`/`setLoading`/`setPhase` 调用无效（React 静默丢弃已卸载组件的 setState）
3. `messagesRef.current` 是卸载前闭包中的旧引用
4. `saveCurrentSession` 使用旧 `messagesRef.current` 的值 → session 中 assistant 回复可能为空
5. **结论：回复可能丢失**

**10. 当前如果请求失败，错误消息是否保存？**

`saveErrorSummary`（line 1653）会尝试保存。但同样依赖 `messagesRef.current` 和 `setMessages`，切页面后同样可能丢失。

### 1.3 核心问题

> OpenClaw HTTP 请求（Rust command 执行）独立于 React 组件生命周期，但响应处理和消息写入全部绑定在 ChatPage 内部状态上。页面切换导致组件卸载，响应丢失。

---

## 二、目标体验

用户发送消息后：

1. 立即出现用户消息和 assistant placeholder
2. 任务进入 running 状态，不阻塞 UI
3. 用户切到 Agent 引擎页 / Skill Center / 文件库，任务继续运行
4. 左侧导航显示 "AI Agent 正在处理" 状态（spinner + 文字）
5. 任务完成后 assistant 回复自动写入对应会话，会话历史持久化
6. 回到 Agent 对话页可见完整回复（当前 run 状态、已完成的消息）
7. 任务失败后 error 消息写入会话，可重试
8. 用户点击停止时本地标记 cancelled，忽略后续响应

---

## 三、RunState 数据结构

### 3.1 类型定义

```ts
// src/lib/runState.ts

export type AgentRunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type AgentRun = {
  runId: string;            // = requestId (crypto.randomUUID())
  sessionId: string;
  status: AgentRunStatus;
  startedAt: number;
  finishedAt?: number;
  modelName: string;        // "openclaw/default"
  source: "OpenClaw Agent";
  userMessageContent: string;  // 用户原始消息文本
  hasAttachments: boolean;     // 是否有附件
  error?: string;              // 失败时的错误摘要
  localCancel?: boolean;       // 用户手动停止
  resultContent?: string;      // 完成时的 assistant 回复
  resultModel?: string;        // 实际响应的模型名
};
```

### 3.2 与现有字段映射

| AgentRun 字段 | 来源 |
|---|---|
| `runId` | `send()` 中的 `requestId`（line 2094） |
| `sessionId` | `currentSessionIdRef.current` |
| `startedAt` | `Date.now()` 在 send 开始时 |
| `modelName` | `"openclaw/default"` |
| `source` | `"OpenClaw Agent"` |
| `userMessageContent` | `displayContent`（line 2092） |
| `hasAttachments` | `savedAttachments !== null`（line 2093） |
| `resultContent` | `raw?.content` from HTTP response（line 2387） |
| `resultModel` | `raw?.model` from HTTP response（line 2387） |

### 3.3 状态机

```
idle → running
running → completed
running → failed
running → cancelled (localCancel=true)
```

状态转换：
- `idle → running`：`send()` 被调用
- `running → completed`：HTTP 响应成功返回，`resultContent` 非空
- `running → failed`：HTTP 请求异常或 `result.ok === false`
- `running → cancelled`：用户点击停止，`stopGeneration()` 被调用

---

## 四、顶层 Run Store 设计

### 4.1 Store 结构

```ts
// 在 App() 组件顶层 (src/App.tsx)

const runsRef = useRef<Map<string, AgentRun>>(new Map());
const [activeRuns, setActiveRuns] = useState<AgentRun[]>([]);  // UI 渲染用快照

const runStore = {
  addRun(run: AgentRun) {
    runsRef.current.set(run.runId, run);
    setActiveRuns(Array.from(runsRef.current.values()));
  },

  updateRun(runId: string, patch: Partial<AgentRun>) {
    const existing = runsRef.current.get(runId);
    if (!existing) return;
    runsRef.current.set(runId, { ...existing, ...patch });
    setActiveRuns(Array.from(runsRef.current.values()));
  },

  completeRun(runId: string, result: { content: string; model: string }) {
    this.updateRun(runId, {
      status: "completed",
      finishedAt: Date.now(),
      resultContent: result.content,
      resultModel: result.model,
    });
  },

  failRun(runId: string, error: string) {
    this.updateRun(runId, {
      status: "failed",
      finishedAt: Date.now(),
      error,
    });
  },

  cancelRun(runId: string) {
    this.updateRun(runId, {
      status: "cancelled",
      finishedAt: Date.now(),
      localCancel: true,
    });
  },

  getRun(runId: string): AgentRun | undefined {
    return runsRef.current.get(runId);
  },

  get activeRunId(): string | null {
    for (const [id, run] of runsRef.current) {
      if (run.status === "running") return id;
    }
    return null;
  },

  get hasRunning(): boolean {
    return this.activeRunId !== null;
  },
};
```

### 4.2 状态位置对比

| 状态 | 当前（ChatPage 局部） | 新方案（App 顶层） |
|---|---|---|
| `messages` | ChatPage useState | App 顶层 useState |
| `messagesRef` | ChatPage useRef | App 顶层 useRef |
| `chatSessions` | ChatPage useState | App 顶层 useState |
| `currentSessionId` | ChatPage useState | App 顶层 useState |
| `loading` | ChatPage useState | `runStore.hasRunning` |
| `activeRequestRef` | ChatPage useRef | `runStore.activeRunId` |
| Run 追踪 | 无 | `runStore` (Map + activeRuns) |

---

## 五、消息写入策略

### 5.1 写入流程

```
用户点击发送
  ↓
Step 1: 创建 AgentRun (status=running)  → runStore.addRun()
                    ↓
Step 2: 写入 user message               → chatMessagesRef + setChatMessages
                    ↓
Step 3: 写入 assistant placeholder       → chatMessagesRef + setChatMessages
         (requestId 作为关联键)                        ↓
Step 4: 保存用户消息到 session          → saveCurrentSession(userMessages)
                    ↓
Step 5: 发起 HTTP 请求 (不 await)       → oc.startChat().then()...
                    ↓
         ↑──── 此处 UI 不阻塞 ────↑
         │  用户可以切页面、操作其他功能  │
         ↓                                ↓
Step 6a: 成功                        Step 6b: 失败
  更新 assistant 消息 content          更新 assistant 消息 content
  runStore.completeRun()               runStore.failRun()
  saveCurrentSession(完整消息)          saveCurrentSession(完整消息+错误)
```

### 5.2 关键约束

- **requestId 一致性**：assistant placeholder 的 `requestId` = HTTP 请求的 `requestId` = AgentRun 的 `runId`
- **消息更新而非重建**：通过 `requestId` 查找 existing assistant 消息并更新其 `content` 字段
- **saveCurrentSession 只传完整数组**：每次保存时传入 `chatMessagesRef.current` 的完整快照
- **切页面不丢**：`chatMessagesRef.current` 在 App 顶层，不受页面切换影响

### 5.3 send 函数改造

```ts
// 在 App() 中，替代 ChatPage 中的 send()

const sendMessage = (input: string, attachments: PreparedAttachment[]) => {
  if (!input.trim() || runStore.hasRunning) return;  // 单 run 限制

  const requestId = crypto.randomUUID();
  const sessionId = currentSessionIdRef.current!;
  const displayContent = input.trim();

  // Step 1: 创建 run
  runStore.addRun({
    runId: requestId,
    sessionId,
    status: "running",
    startedAt: Date.now(),
    modelName: "openclaw/default",
    source: "OpenClaw Agent",
    userMessageContent: displayContent,
    hasAttachments: attachments.length > 0,
  });

  // Step 2-3: 写入用户消息 + assistant placeholder
  const userMsg: UiChatMessage = { role: "user", content: displayContent };
  const placeholder: UiChatMessage = {
    requestId,
    role: "assistant",
    source: "OpenClaw Agent",
    content: "",
    modelName: "openclaw/default",
  };
  chatMessagesRef.current = [...chatMessagesRef.current, userMsg, placeholder];
  setChatMessages(chatMessagesRef.current);

  // Step 4: 保存用户消息
  void saveSession(sessionId, chatMessagesRef.current);

  // Step 5: 发起请求（异步，不阻塞 UI）
  initOpenClawBackend()
    .then(async (oc) => {
      if (!oc) throw new Error("OpenClaw Backend 不可用");

      const modelContent = buildModelContent(displayContent, attachments);
      const agentMessages = buildAgentMessages(modelContent);
      const handle = await oc.startChat({ requestId, model: "openclaw/default", messages: agentMessages });

      if (runStore.getRun(requestId)?.localCancel) {
        // run 已被用户取消，忽略结果
        return;
      }

      if (!handle.accepted) throw new Error("请求提交失败");

      const raw = handle.raw as { content?: string; model?: string };
      const content = raw?.content || "";

      // Step 6a: 更新 assistant 消息
      chatMessagesRef.current = chatMessagesRef.current.map(m =>
        m.requestId === requestId
          ? { ...m, content, modelName: raw?.model || "openclaw/default" }
          : m
      );
      setChatMessages(chatMessagesRef.current);

      runStore.completeRun(requestId, { content, model: raw?.model || "openclaw/default" });
      void saveSession(sessionId, chatMessagesRef.current);
    })
    .catch((err) => {
      // Step 6b: 失败处理
      chatMessagesRef.current = chatMessagesRef.current.map(m =>
        m.requestId === requestId
          ? { ...m, content: `请求失败：${getErrorMessage(err)}` }
          : m
      );
      setChatMessages(chatMessagesRef.current);
      runStore.failRun(requestId, getErrorMessage(err));
      void saveSession(sessionId, chatMessagesRef.current);
    });

  // 立即返回，不阻塞 UI
};
```

---

## 六、跨页面状态提示

### 6.1 UI 设计（本轮仅设计）

在左侧导航 "Agent 对话" 菜单项或 App 顶部 header 显示：

```
┌─────────────────────────────────┐
│  AI Agent Workspace              │
│  ● Agent 正在处理 1 个任务...    │  ← 全局 run 指示器
├─────────────────────────────────┤
│  历史对话                        │
│    📝 新对话                     │
│  Agent 引擎                      │
│  Skill Center                    │
│  ...                             │
└─────────────────────────────────┘
```

实现思路（P1，TASK-021D）：
- 检查 `runStore.hasRunning`
- 显示 spinner 图标 + "Agent 正在处理中"
- 点击可跳转到 Agent 对话页（`setActive("chat")`）
- 任务完成/失败后显示短暂结果（3 秒后消失）

### 6.2 ChatPage 读取顶层状态

```tsx
function ChatPage({ chatMessages, activeRuns, sendMessage, stopGeneration, ... }) {
  const isRunning = activeRuns.some(r => r.status === "running");

  return (
    <>
      {/* 消息列表 */}
      <MessageList messages={chatMessages} />

      {/* 输入区 */}
      <InputArea
        onSend={sendMessage}
        disabled={isRunning}
        onStop={stopGeneration}
      />
    </>
  );
}
```

---

## 七、取消策略

### 7.1 HTTP-first v0（当前）

- `OpenClawBackend.cancelChat()` 是空实现
- HTTP 请求无法从客户端真正终止（Rust reqwest 已在执行）
- 策略：**本地标记 + 忽略结果**

```ts
// stopGeneration 改造逻辑

const stopGeneration = () => {
  const runId = runStore.activeRunId;
  if (!runId) return;

  // 1. 本地标记 cancelled
  runStore.cancelRun(runId);

  // 2. 更新 assistant 消息为 "已停止"
  chatMessagesRef.current = chatMessagesRef.current.map(m =>
    m.requestId === runId
      ? { ...m, content: m.content || "(已停止生成)", partial: true, warning: "已停止生成" }
      : m
  );
  setChatMessages(chatMessagesRef.current);
  void saveSession(currentSessionIdRef.current!, chatMessagesRef.current);

  // 3. 如果 HTTP 响应后返回但 run 已 cancelled，忽略 assistant content（在 .then() 中检查 runStore.getRun()）
};
```

### 7.2 后续版本（streaming/SSE）

- 实现真正的 `cancelChat`：通过 Rust command 发送 abort 信号
- 或使用 HTTP/2 RST_STREAM 终止连接

---

## 八、重试策略

### 8.1 设计

失败 run 可重试：

```ts
const retryRun = (failedRunId: string) => {
  const failedRun = runStore.getRun(failedRunId);
  if (!failedRun || failedRun.status !== "failed") return;

  // 1. 创建新 assistant 消息（追加，不覆盖旧的失败消息）
  const newRequestId = crypto.randomUUID();

  // 2. 新 run
  runStore.addRun({
    runId: newRequestId,
    sessionId: failedRun.sessionId,
    status: "running",
    startedAt: Date.now(),
    modelName: "openclaw/default",
    source: "OpenClaw Agent",
    userMessageContent: failedRun.userMessageContent,
    hasAttachments: failedRun.hasAttachments,
  });

  // 3. 追加新 assistant placeholder
  const placeholder: UiChatMessage = {
    requestId: newRequestId,
    role: "assistant",
    source: "OpenClaw Agent",
    content: "",
    modelName: "openclaw/default",
  };
  chatMessagesRef.current = [...chatMessagesRef.current, placeholder];
  setChatMessages(chatMessagesRef.current);

  // 4. 发起请求（复用原 userMessageContent）
  // ... 同 send 逻辑
};
```

### 8.2 重试按钮

在失败的 assistant 消息气泡上添加 "重试" 按钮，调用 `retryRun(failedRunId)`。

---

## 九、多任务策略

### 9.1 当前建议：单 run 模式 (MVP)

**同一 session 同时只允许一个 run。**

理由：
- HTTP-first 无 streaming，用户无法实时感知并发进度
- 多 run 并发增加状态管理复杂度（消息顺序、session 保存一致性）
- 类似 ChatGPT：一个对话同时只处理一个请求
- OpenClaw 后端无 session 隔离，`/v1/chat/completions` 是 stateless 的

实现：
```ts
const sendMessage = (...) => {
  if (runStore.hasRunning) return;  // 阻止并发发送
  // ...
};
```

### 9.2 扩展路径（后续）

- 不同 session 可独立并发（每个 session 有独立的消息列表和 run 队列）
- 同一 session 内后续可支持 run 排队（发送后自动排队）

---

## 十、安全边界

不破坏现有安全约束：
- Token 不进入 `chatMessagesRef` / localStorage / sessionStorage
- 不暴露 provider / baseUrl / API URL
- 不改 OpenClaw config 写入逻辑
- 不回到 WebSocket pairing
- 不删除 Hermes legacy（Hermes Tauri event 路径完整保留）
- 不输出 Token
- 不读取 .env

Assistant 消息的 `content` 字段只存 AI 回复文本，不存 token。

---

## 十一、任务拆分建议

按风险和依赖排序：

| ID | 任务 | 内容 | 优先级 | 风险 |
|---|---|---|---|---|
| TASK-021B | 状态提升 | `messages`/`chatSessions`/`currentSessionId` 从 ChatPage 迁移到 App 顶层 | P0 | 中（重构面大，需保证现有功能不退化） |
| TASK-021C | send 接入 run store | 改造 `send()` 为非阻塞 `.then()/.catch()` + run store 集成 + 跨页面不中断 | P0 | 高（核心链路改造） |
| TASK-021D | 全局 run 指示器 | 左侧导航/header 显示 "Agent 正在处理" 状态 + 点击跳回对话页 | P1 | 低（纯 UI 叠加） |
| TASK-021E | 取消 + 重试 | 本地取消逻辑完善 + 失败消息重试按钮 | P1 | 低（基于 run store 扩展） |
| TASK-021F | 回归测试 | `npm run build` + `cargo check` + probe + 人工验收 | P0 | 低 |
| TASK-021G | release checklist 更新 | 更新 `docs/release-checklist.md` 增加后台运行验收项 | P1 | 低 |

### 依赖关系

```
TASK-021B ──→ TASK-021C ──→ TASK-021D
                        └──→ TASK-021E
                        └──→ TASK-021F
                                 └──→ TASK-021G
```

---

## 十二、风险与回滚方案

| 风险 | 缓解 | 回滚 |
|---|---|---|
| 状态提升破坏现有功能 | 渐进迁移：先提 session，再 messages，最后 send | 每个阶段独立可回滚（状态位置 revert） |
| 非阻塞 send 引入竞态 | 单 run 限制 + `runStore.hasRunning` guard | 恢复 await 模式 |
| ChatPage 重构引入 bug | 保留原 ChatPage 代码结构，通过 props 替换 local state | 回退到原 ChatPage 组件 |
| 会话保存数据不一致 | 统一在 App 层 `saveSession`，保证原子性 | 恢复 ChatPage 内 saveCurrentSession |

---

## 实际实施状态

| Task ID | 状态 | 说明 |
|---|---|---|
| TASK-021B | ✅ 已完成 | 21 个状态项已提升至 App 层 |
| TASK-021C | ✅ 已完成 | RunStore + 非阻塞 send + localCancel + saveMessagesToSession |
| TASK-021D | ✅ 已完成 | 全局 run 指示器 (nav spinner + banner) |
| TASK-021E | ✅ 已完成 | 真正 retry + "已取消生成" + localCancel guards |
| TASK-021F | ✅ 已完成 | 回归测试 + retry elapsed timer fix + release-checklist 扩展 |

### TASK-021C 实现要点

**新增文件：** `src/lib/agentRunStore.ts` — `AgentRun` / `AgentRunStatus` 类型

**RunStore (App.tsx)：**
- `runsRef` (Map<string, AgentRun>) — 所有 run 内存存储
- `hasRunningRun` (useState<boolean>) — 单 run 并发控制
- `addRun` / `updateRun` / `cancelRun` / `getRun` — run 生命周期管理

**send 非阻塞改造 (OpenClaw 路径)：**
- `hasRunningRun` guard 阻止并发
- 用户消息 + placeholder 后立即 `runsRef.set(requestId, {...})`
- `initOpenClawBackend().then(oc => oc.startChat(...)).then(handle => {...}).catch(err => {...})`
- send() 立即返回，HTTP 响应在 Promise 回调中处理

**跨页面安全写入：**
- 所有 refs 在 App 层（messagesRef, chatSessionsRef, latestSessionsRef）
- `saveMessagesToSession(messages, targetSessionId)` 不依赖 currentSessionId
- Promise 回调中 `messagesRef.current` 的读写不受 ChatPage 挂载状态影响

**取消 (localCancel)：**
- stopGeneration 设置 `runsRef[rid].localCancel = true`
- .then()/.catch() 回调检查 localCancel，若已取消则忽略结果

---

## 当前状态位置 (TASK-021B 完成后)

**在 App() 顶层（通过 chatState 对象传递）：**
- `messages` / `messagesRef` / `setMessages`
- `chatSessions` / `setChatSessions` / `chatSessionsRef` / `latestSessionsRef`
- `currentSessionId` / `setCurrentSessionId` / `currentSessionIdRef`
- `sessionsLoaded` / `sessionsLoadedRef`
- `loading` / `phase` / `error` / `errorDetail`
- `activeRequestRef` / `stoppedIdsRef`
- `timerRef` / `unlistenRef` / `elapsedLive` / `lastElapsed`
- `streamDiagnostics` / `sessionError` / `saveQueueRef`

**仍在 ChatPage 局部：**
- `input` / `attachments` / `attachBusy`（输入和附件草稿）
- UI 展开状态（`showErrorDetail`、`showAdvanced`、`mobileHistoryOpen` 等）
- DOM refs（`inputRef`、`scrollRef`、`endRef`）
- 滚动和 typewriter 状态（`twRef`、`autoFollowRef`）

**send/stopGeneration/saveCurrentSession：** 仍在 ChatPage 内，使用 props 传入的 state/refs，行为与之前完全一致。

**TASK-021C 就绪条件：**
- `messagesRef.current` 在 App 顶层 → 页面切换不丢失 ✅
- `activeRequestRef` 在 App 顶层 → 可跨页面追踪 run ✅
- `setMessages` 在 App 顶层 → Promise 回调中可安全写入 ✅
- 所有 session 持久化 refs 在 App 顶层 → 完成后可保存 ✅

## 十三、不变内容保证

以下代码和逻辑在本方案实施过程中保持不变：
- `src/lib/openclawHttpClient.ts`（`openClawChatCompletion` 调用方式不变）
- `src/lib/openclawBackend.ts`（`startChat`/`cancelChat` 接口不变）
- `src/lib/agentBackend.ts`（`AgentBackend` 接口不变）
- `src/lib/hermes.ts`（Hermes legacy 完整保留）
- `src-tauri/src/main.rs`（Rust commands 不变）
- Onboarding 流程不变
- Agent 引擎页配置不变
- Skill Center 流程不变
- 附件分析逻辑不变
- `chat-sessions.json` 保存格式不变
