# 后台任务不中断架构设计方案

TASK-021A：Agent 后台运行任务与跨页面持续生成方案设计。

日期：2026-05-26

## 一、现状分析：10 个关键问题

### 1. 当前 OpenClaw 请求是否会因为切页面被取消？

**会。** 当前路由使用条件渲染 (`if (active === "chat") return <ChatPage .../>`，`src/App.tsx:935`)。当 `active` 改变为其他页面时，React 直接卸载 ChatPage 组件。这导致：

- 所有 ChatPage 局部 `useState` 和 `useRef` 被销毁
- `send()` 中 `await oc.startChat(...)` 返回后的 `setMessages` / `setLoading` 调用对象已卸载
- 请求完成后的 `saveCurrentSession` 调用仍可能执行（Promise 不在组件作用域），但写入的 `messagesRef.current` 已经被组件卸载后的闭包所绑定

**实际行为**：HTTP 请求本身不会被取消（网络请求已发出），但响应返回后无法写入 UI 状态，`messagesRef.current` 写入的是卸载前的旧引用。这可能导致数据不一致。

### 2. 当前 request Promise 存在哪里？

存在 `send()` 函数内部的 `try` 块中，具体在 `src/App.tsx:2375`：

```ts
const runHandle = await oc.startChat({ requestId, model: "openclaw/default", messages: agentMessages });
```

Promise 由 `OpenClawBackend.startChat()` 返回（`openclawBackend.ts:74`），它调用 `openClawChatCompletion` 并 await。该 Promise 不受组件生命周期绑定——网络请求发起后就独立运行，但 Promise 的 then/catch 回调中的 setState 调用对象已无效。

### 3. 当前消息状态是否在 App 顶层还是 ChatPage 局部？

**ChatPage 局部。** 

- `messages` (line 1517): `useState<UiChatMessage[]>`
- `messagesRef` (line 1545): `useRef<UiChatMessage[]>`
- `chatSessions` (line 1518): `useState<ChatSession[]>`
- `chatSessionsRef` (line 1546): `useRef<ChatSession[]>`
- `currentSessionId` (line 1519): `useState<string | null>`
- `currentSessionIdRef` (line 1547): `useRef<string | null>`

所有消息和会话状态都在 ChatPage 内部。App 顶层（`App()` 函数，line 551）没有任何 run state 或消息状态。

### 4. 当前 saveCurrentSession 何时调用？

调用时机（`src/App.tsx`）：

| 调用点 | 行号 | 时机 |
|---|---|---|
| `saveCurrentSession(nextMessages)` | 2126 | 发送后保存用户消息（不含 assistant 回复） |
| `void saveCurrentSession(nextRef, { model })` | 2400 | HTTP 响应返回后，保存完整对话（含 assistant 回复） |
| `void saveCurrentSession(failedMessages, ...)` | 1662 | 错误时保存错误摘要 |
| `void saveCurrentSession(messagesRef.current)` | 2466 | stopGeneration 后保存停止状态 |

所有调用都在 ChatPage 内部。session 数据通过 `enqueueWriteSessions()` → `writeChatSessions()` 持久化到 `chat-sessions.json`。

### 5. 当前 stopGeneration 对 HTTP-first 是否只是本地取消？

**是。** `stopGeneration()` (`line 2437`) 做的事：

1. 从 `activeRequestRef.current` 获取当前 requestId
2. 添加到 `stoppedIdsRef`（阻止后续 chunk 处理）
3. 清除 timer、typewriter、loading 状态
4. 标记当前 assistant 消息为 "已停止生成" 或移除空 placeholder
5. 调用 `saveCurrentSession` 保存停止状态
6. 调用 `oc.cancelChat(...)` 但 `OpenClawBackend.cancelChat` 是空实现（`openclawBackend.ts:95-98`）

对于 HTTP-first v0，由于 `stream=false`，请求会在 Rust command 中一次性完成。`stopGeneration` 最多只能忽略返回结果，无法真正 abort 服务器端处理。

### 6. 当前是否有 active run / pending run 概念？

**没有全局概念。** 仅有 ChatPage 局部变量：

- `activeRequestRef` (line 1548): `useRef<string | null>` — 当前 active requestId
- `loading` (line 1527): `useState<boolean>` — 布尔标志
- `stoppedIdsRef` (line 1549): `useRef<Set<string>>` — 已停止的 requestId 集合

这些在 ChatPage 卸载时全部销毁。App 顶层不知道是否有正在运行的 AI 任务。

### 7. 当前 requestId 是否足够作为 runId？

**足够，但需语义区分。**

`requestId` (`crypto.randomUUID()`) 在发送时生成，贯穿整个请求生命周期：用户消息、assistant placeholder、后端请求、响应处理、stop/cancel。

`requestId` 可同时作为 `runId` 使用——每个 run 唯一对应一次发送→完成的完整过程。但建议在类型上做显式别名：

```ts
type RunId = string;
// requestId 即 runId
```

### 8. 当前多次连续发送是否安全？

**基本安全，但依赖 `loading` 状态。**

`send()` 函数在开头检查 `if (!input.trim() || loading) return` (`line 2067`)。只要 `loading` 为 true，新发送被阻止。

但如果 ChatPage 卸载再重新挂载（切页面再回来），`loading` 重置为 `false`。如果此时前一个请求尚未完成（网络耗时较长），用户可发起新请求，导致多个并发请求。当前没有全局并发控制。

### 9. 当前如果请求返回时用户已经切页面，会发生什么？

**会发生：**

1. **网络请求**：不受影响，仍然完成（Rust command 在独立进程）
2. **ChatPage 已卸载**：`setMessages`、`setLoading`、`setPhase` 调用无效（React 静默丢弃）
3. **messagesRef.current**：是卸载前闭包中的旧值，写入后无实际效果
4. **saveCurrentSession**：仍会调用，但使用的是旧 `messagesRef.current` 的值
5. **实际后果**：用户切换页面后，assistant 回复可能丢失，或者 session 中保存的是空 assistant 内容

**当前 TASK-016 修复**：已经在 HTTP 返回后先同步 `messagesRef.current = nextRef`，再 `setMessages`。但这个修复只在组件挂载期间有效。组件卸载后，这个写入无效。

### 10. 当前如果请求失败，错误消息是否保存？

**是。** 通过 `saveErrorSummary` (`line 1653-1663`) 实现：

1. 更新 `messagesRef.current`（将 assistant 消息内容设为 `请求失败：{summary}`）
2. 调用 `setMessages`
3. 调用 `saveCurrentSession`

但同样的，如果 ChatPage 已卸载，`messagesRef.current` 更新可能无效，错误消息可能丢失。

---

## 二、现状总结

| 维度 | 现状 | 问题 |
|---|---|---|
| 消息状态 | ChatPage 局部 | 页面切换丢失 |
| 会话状态 | ChatPage 局部（含 persist） | persist 有效，但写入依赖局部 ref |
| Run 状态 | 无全局概念 | 无法追踪正在执行的任务 |
| 生命周期 | 组件 mount/unmount | unmount 后 setState 无效 |
| 并发控制 | loading 布尔标志 | 仅组件内有效 |
| 网络请求 | Rust command (独立进程) | HTTP 请求本身不受影响 |
| 持久化 | chat-sessions.json | 仅在 ChatPage 内触发 |
| 错误处理 | saveErrorSummary | 依赖 ChatPage 状态 |

**核心问题**：OpenClaw HTTP 请求（由 Rust command 执行）独立于 React 组件生命周期，但响应处理和消息写入全部绑定在 ChatPage 内部状态上。页面切换导致组件卸载，响应丢失。

---

## 三、设计方案

### 整体思路

将消息/会话/run 状态提升到 App 顶层（`App()` 组件），与 React 组件生命周期解耦。引入 `useSyncExternalStore` 或自定义 `useRef` + `useState` 组合，使 ChatPage 可以从顶层读取和写入状态。

### 3.1 RunState 类型

```ts
// src/lib/runState.ts

export type AgentRunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type AgentRun = {
  runId: string;           // = requestId
  sessionId: string;
  startedAt: number;
  finishedAt?: number;
  status: AgentRunStatus;
  modelName: string;       // "openclaw/default"
  source: "OpenClaw Agent";
  error?: string;          // 失败时的错误摘要
  localCancel?: boolean;   // 用户手动停止
  resultContent?: string;   // 完成时的回复内容
  resultModel?: string;    // 实际使用的模型
};

export type RunStore = {
  runs: Map<string, AgentRun>;          // runId → run
  activeRunId: string | null;           // 当前正在执行的 runId
  sessions: Map<string, ChatSession>;   // sessionId → session (latest version)
  currentSessionId: string | null;
};
```

### 3.2 顶层状态架构

```ts
// 在 App() 组件中 (App.tsx)

// --- 新增：顶层 run store ---
const runStoreRef = useRef<RunStore>({
  runs: new Map(),
  activeRunId: null,
  sessions: new Map(),
  currentSessionId: null,
});

const [globalLoading, setGlobalLoading] = useState(false);
const [activeRuns, setActiveRuns] = useState<AgentRun[]>([]);  // 用于 UI 显示

// --- 新增：顶层消息状态 ---
const [chatMessages, setChatMessages] = useState<UiChatMessage[]>([]);
const chatMessagesRef = useRef<UiChatMessage[]>([]);
```

**状态位置对比：**

| 状态 | 当前 | 新方案 |
|---|---|---|
| `messages` | ChatPage useState | App 顶层 useState |
| `messagesRef` | ChatPage useRef | App 顶层 useRef |
| `chatSessions` | ChatPage useState | App 顶层 useState |
| `loading` | ChatPage useState | App 顶层 useState + RunStore |
| `activeRequestId` | ChatPage useRef | RunStore.activeRunId |
| Run 状态 | 无 | RunStore + activeRuns |

### 3.3 发送流程改造

```ts
// 在 App() 组件中

const sendMessage = async (input: string, attachments?: ...) => {
  const requestId = crypto.randomUUID();
  const sessionId = currentSessionIdRef.current!;

  // 1. 创建 run
  const run: AgentRun = {
    runId: requestId,
    sessionId,
    startedAt: Date.now(),
    status: "running",
    modelName: "openclaw/default",
    source: "OpenClaw Agent",
  };
  runStoreRef.current.runs.set(requestId, run);
  runStoreRef.current.activeRunId = requestId;
  setActiveRuns(Array.from(runStoreRef.current.runs.values()));

  // 2. 添加用户消息到顶层
  const userMsg: UiChatMessage = { role: "user", content: input, ... };
  chatMessagesRef.current = [...chatMessagesRef.current, userMsg];
  setChatMessages(chatMessagesRef.current);

  // 3. 添加 assistant placeholder
  const placeholder: UiChatMessage = {
    requestId, role: "assistant",
    source: "OpenClaw Agent",
    content: "",
    modelName: "openclaw/default",
  };
  chatMessagesRef.current = [...chatMessagesRef.current, placeholder];
  setChatMessages(chatMessagesRef.current);

  // 4. 保存用户消息到 session
  void saveSession(sessionId, chatMessagesRef.current);

  // 5. 发起请求（不 await，在后台完成）
  setGlobalLoading(true);

  initOpenClawBackend().then((oc) => {
    if (!oc) {
      handleRunError(requestId, "OpenClaw Backend 不可用");
      return;
    }
    return oc.startChat({ requestId, model: "openclaw/default", messages })
      .then((handle) => {
        handleRunComplete(requestId, handle);
      })
      .catch((err) => {
        handleRunError(requestId, getErrorMessage(err));
      });
  }).finally(() => {
    setGlobalLoading(false);
  });

  // sendMessage 立即返回，不阻塞 UI
};
```

**关键变化**：
- `sendMessage` 不再 `await` 后端响应
- 后端响应在 `.then()` 中异步处理
- 所有 `setState` 操作目标为 App 顶层状态
- ChatPage 通过 props 接收 `chatMessages` 和函数引用

### 3.4 跨页面状态保持

```tsx
// App() JSX 中
<Page
  active={active}
  setActive={setActive}
  chatMessages={chatMessages}           // 顶层消息
  setChatMessages={setChatMessages}
  sendMessage={sendMessage}             // 顶层发送函数
  stopGeneration={stopGeneration}
  globalLoading={globalLoading}
  activeRuns={activeRuns}              // 顶层 run 列表
  // ... 其他 props
/>
```

ChatPage 组件通过 props 读取消息和数据，不再持有独立的消息状态。

### 3.5 ChatPage 改造

```tsx
function ChatPage({
  chatMessages,          // props, 非 local state
  sendMessage,           // App 层函数
  globalLoading,
  activeRuns,
  // ...
}) {
  // 本地 UI 状态：输入框、滚动位置、UI 标志
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);

  // 消息列表直接从 props 读取
  const messages = chatMessages;

  // 当前是否有活动 run
  const isRunning = activeRuns.some(r => r.status === "running");

  return (
    <div>
      {/* 消息列表 */}
      {messages.map(msg => <MessageBubble {...msg} />)}

      {/* 顶部 run 状态 */}
      {isRunning && <RunStatusBar run={activeRuns[0]} />}

      {/* 输入区 */}
      <InputArea
        onSend={(input) => sendMessage(input, attachments)}
        disabled={isRunning}
      />
    </div>
  );
}
```

### 3.6 全局 Run 状态提示

在 App 的左侧导航或顶部可以显示：

```tsx
// 在 App() 的导航栏中
{activeRuns.length > 0 && (
  <div className="run-indicator">
    <Loader2 className="animate-spin" />
    Agent 正在处理 ({activeRuns.length} 个任务)
  </div>
)}
```

当用户切到其他页面，run 状态提示仍然显示，点击可回到 Agent 对话页。

---

## 四、最小实施方案 (TASK-021B)

### Phase 1：状态提升（核心）

1. **在 `App()` 中新增**：
   - `chatMessages` / `chatMessagesRef` (useState + useRef)
   - `chatSessions` / `chatSessionsRef`
   - `currentSessionId` / `currentSessionIdRef`
   - `globalLoading` boolean
   - `runStoreRef` (Map of AgentRun)

2. **改造 ChatPage**：
   - 移除局部 `messages`/`messagesRef`/`chatSessions`/`loading`/`currentSessionId`
   - 通过 props 接收这些值
   - 保留输入框、附件、滚动等纯 UI 状态

3. **send 函数迁移到 App 层**：
   - 改为 `sendMessage` 在 App 组件中
   - Promise 使用 `.then()/.catch()` 而非 `await`
   - 所有 setState 指向 App 状态

4. **saveCurrentSession / persistSessions 迁移到 App 层**

### Phase 2：Run 追踪（后续）

1. 类型：`AgentRun` / `RunStore`
2. 全局 run 状态指示器
3. run 失败重试
4. 多 run 并发管理（当前单 run，后续可扩展）

### Phase 3：Streaming + Abort（后续）

1. SSE streaming 支持
2. 真正的 `cancelChat` 实现
3. 进度指示器

---

## 五、兼容性保证

- HermesLegacyBackend 不变（仍通过 Tauri event 订阅）
- OpenClaw HTTP API 调用方式不变（`openclawHttpClient.ts` 不变）
- `chat-sessions.json` 保存格式不变
- 附件分析逻辑不变
- Skill Center 进入对话流程不变
- 不删除任何 Hermes 代码

---

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| App 状态体量增大 | 使用 `useRef` 存储大数据，`useState` 仅存 UI 渲染需要的子集 |
| ChatPage 重构面大 | 渐进迁移：先提 session/会话，再提 messages，最后提 send |
| 并发多 run | Phase 1 仅允许单 run，`globalLoading` 阻止并发 |
| 历史兼容 | `chat-sessions.json` 格式不变，旧数据可读数 |
| React 性能 | 使用 `React.memo` 包裹消息气泡，减少不必要的 re-render |

---

## 七、建议任务拆分

| Task ID | 内容 | 优先级 |
|---|---|---|
| TASK-021B | 状态提升：messages + chatSessions 迁移到 App 层 | P0 |
| TASK-021C | send 函数改造：非阻塞 + 跨页面完成 | P0 |
| TASK-021D | Run 追踪 + 全局状态指示器 | P1 |
| TASK-021E | 并发安全 + 错误重试 | P1 |
| TASK-021F | Streaming 支持 (SSE) | P2 |
| TASK-021G | 真正的 cancelChat | P2 |
