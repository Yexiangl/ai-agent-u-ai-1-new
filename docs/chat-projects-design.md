# 项目 / 分组数据模型设计

TASK-023C-A：Chat Projects 数据模型设计。

日期：2026-05-26 | 本轮只做方案设计，不改业务代码。

---

## 一、当前会话结构分析

### 1.1 ChatSession 类型

定义位置：`src/lib/hermes.ts:161-172`

```ts
export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
  hermesSessionId?: string | null;
  model: string;
  totalTokens?: number;
  lastMessagePreview?: string;
  pinned?: boolean;
}
```

### 1.2 createEmptySession

定义位置：`src/App.tsx:331-334`

```ts
function createEmptySession(model = "openclaw/default"): ChatSession {
  const now = nowStamp();
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: now, updatedAt: now,
    messages: [],
    hermesSessionId: null,
    model, totalTokens: 0,
    lastMessagePreview: "暂无消息",
    pinned: false
  };
}
```

### 1.3 会话存储

- **读取**：`readChatSessions()` → `invoke("read_chat_sessions")` → Rust → `chat-sessions.json`
- **写入**：`writeChatSessions(sessions)` → Rust → `chat-sessions.json`
- **数据格式**：JSON 数组 `ChatSession[]`
- **备份**：写入前旋转备份（`chat-sessions.json.bak.1/2/3`）

### 1.4 会话排序

`sortSessions()` (`App.tsx:363`)：按 pinned 降序，然后 updatedAt 降序

### 1.5 会话更新

`updateSessionFromMessages()` (`App.tsx:367`)：`{ ...session, ...extra, messages, updatedAt, ... }`

### 1.6 后台 run 关系

- Run store 使用 `sessionId` 字段关联会话（`runsRef[runId].sessionId`）
- 跨页面写回使用 `saveMessagesToSession(messages, targetSessionId)`
- 不依赖 projectId

---

## 二、8 个分析问题回答

**1. 当前 ChatSession 类型有哪些字段？**

id, title, createdAt, updatedAt, messages, hermesSessionId, model, totalTokens, lastMessagePreview, pinned

**2. 当前会话数据存在哪里？**

通过 Rust command `write_chat_sessions` 持久化到 `chat-sessions.json`，备份机制为 `.bak.1/2/3` 轮转。

**3. 当前会话保存是否支持兼容新增字段？**

是。TypeScript interface 允许 JSON 反序列化时携带额外字段。`{ ...session, ...extra }` 的展开语法保留已有字段。`updateSessionFromMessages` 使用展开确保不丢失额外字段。

**4. 当前 createEmptySession 适合在哪里补默认 projectId？**

在 `createEmptySession` 函数末尾添加 `projectId: DEFAULT_PROJECT_ID`。所有新建会话的调用点（新建、fallback 创建、错误恢复创建）都经过此函数，一处改全局生效。

**5. 当前旧会话没有 projectId 时，应该如何兼容？**

运行时读取时使用 fallback：`const effectiveProjectId = session.projectId || DEFAULT_PROJECT_ID`。不强制迁移旧数据。首次保存时可选地补写 `projectId`。

**6. 当前删除会话 / 重命名 / 搜索是否会受 projectId 影响？**

否。这些操作基于 `session.id`，不接触 projectId。搜索目前匹配 `title` + `lastMessagePreview` + `messages.content`，不受影响。

**7. 后台 run 写回是否会受项目分组影响？**

否。run 只记录 `sessionId`，通过 `saveMessagesToSession(messages, targetSessionId)` 写回。projectId 是会话的静态属性，不参与 run 生命周期。

**8. 是否需要给 run 也记录 projectId？**

不需要。run → sessionId → projectId 的间接映射已足够。全局 running 指示可通过 `hasRunningRun` 提示，按项目筛选时也能通过 session 的 projectId 关联。

---

## 三、ChatProject 类型设计

```ts
// src/lib/chatProjects.ts (新文件，设计方案)

export const DEFAULT_PROJECT_ID = "default";

export const SYSTEM_PROJECT_IDS = {
  default: "default",
  fileAnalysis: "file-analysis",
  skillCenter: "skill-center",
  businessTask: "business-task",
  debugLog: "debug-log",
} as const;

export type SystemProjectId = typeof SYSTEM_PROJECT_IDS[keyof typeof SYSTEM_PROJECT_IDS];

export type ChatProjectType = "system" | "custom";

export interface ChatProject {
  id: string;               // uuid for custom, SYSTEM_PROJECT_IDS value for system
  name: string;
  description?: string;
  color?: string;           // hex color for UI badge
  icon?: string;            // lucide icon name
  type: ChatProjectType;
  createdAt: number;        // timestamp ms
  updatedAt: number;
}
```

### 默认系统项目模板

```ts
export const SYSTEM_PROJECTS: ChatProject[] = [
  {
    id: "default",
    name: "默认",
    type: "system",
    createdAt: 0,
    updatedAt: 0,
  },
  // 后续可选扩展：
  // { id: "file-analysis", name: "文件分析", type: "system", ... },
  // { id: "skill-center", name: "Skill Center", type: "system", ... },
];
```

### ChatSession 扩展

```ts
// 在 hermes.ts ChatSession 接口中新增：
export interface ChatSession {
  // ...existing fields...
  projectId?: string;       // 归属项目 ID，默认为 "default"
  sourceType?: "chat" | "skill" | "file" | "debug" | "onboarding";  // 来源标签
}
```

---

## 四、默认项目策略

### 4.1 第一版建议

**只创建 "默认" 一个系统项目。**

理由：
- MVP 不需要用户面对多个系统项目
- "文件分析" / "Skill Center" / "业务任务" 可通过 `sourceType` 标签标记，不急于做独立项目
- 后续 TASK-023C-C（创建项目）时再引入自定义项目

### 4.2 策略

- **系统项目**：`type === "system"`，id 为预定义常量（`DEFAULT_PROJECT_ID`）
  - 不显示删除按钮
  - 不作为项目选择器中的可删除项
- **自定义项目**：`type === "custom"`，id 为 uuid
  - 可重命名、可删除
- **区分方式**：通过 `type` 字段判断，而非 id 前缀

### 4.3 sourceType vs projectId

- `sourceType`：标记会话的来源（从哪个入口创建），不用来做分组
  - `"chat"` — 普通对话创建
  - `"skill"` — Skill Center 生成指令后创建
  - `"file"` — AI 文件库 "用于 Agent 分析" 创建
  - `"debug"` — 调试/诊断产生
  - `"onboarding"` — Onboarding 中创建（如适用）
- `projectId`：用于分组和筛选

---

## 五、存储策略

### 5.1 项目存储位置

**方案 A（推荐）：与 sessions 一起保存在同一文件**

```
chat-sessions.json → { sessions: ChatSession[], projects: ChatProject[] }
```

当前存储格式为 `ChatSession[]`。改为对象包装：

```json
{
  "version": 2,
  "sessions": [...],
  "projects": [...]
}
```

优点：一次读写，原子性保证，无需新增 storage key。

缺点：需要修改 Rust command 或 JS 层序列化/反序列化。当前 Rust `write_chat_sessions` 接收 `ChatSession[]`，如果改接口需要更新 Rust 代码。

**方案 B：独立 projects.json 文件**

新增 Rust command：`read_projects` / `write_projects`，存储到 `projects.json`。

优点：不改 sessions 存储格式，独立文件隔离风险。

缺点：多一次 IPC 调用，两个文件需要一致性管理。

**推荐方案 A**，因为改动集中、原子性好。但需要评估 Rust command 改动成本。如果 Rust 改动成本高，可以降级到方案 B。

### 5.2 兼容旧数据

**方案 A（包格式）：**
```ts
async function readChatSessions(): Promise<{ sessions: ChatSession[]; projects: ChatProject[] }> {
  const raw = await invoke("read_chat_sessions");
  if (Array.isArray(raw)) {
    // 旧格式：会话数组
    return {
      sessions: raw as ChatSession[],
      projects: SYSTEM_PROJECTS,  // 自动生成默认项目
    };
  }
  // 新格式
  const data = raw as { version: number; sessions: ChatSession[]; projects: ChatProject[] };
  return data;
}
```

**方案 B（独立文件）：**
首次读取 `projects.json` 不存在时，返回 `SYSTEM_PROJECTS`。

### 5.3 session.projectId 兼容

读取时统一处理：
```ts
function ensureProjectId(session: ChatSession): ChatSession {
  return { ...session, projectId: session.projectId || DEFAULT_PROJECT_ID };
}
```

保存时可选补写：首次持久化旧会话时保留 `projectId` 字段。

### 5.4 数据损坏恢复

- projects 数组为空/缺失 → fallback 到 `SYSTEM_PROJECTS`
- session.projectId 指向不存在的项目 → fallback 到 DEFAULT_PROJECT_ID
- projects.json 损坏 → 重建系统项目，所有会话归入默认

---

## 六、删除项目策略

```ts
function deleteProject(projectId: string, sessions: ChatSession[]) {
  if (projectId === DEFAULT_PROJECT_ID) return;  // 不能删除默认项目
  if (isSystemProject(projectId)) return;        // 不能删除系统项目

  return {
    projects: projects.filter(p => p.id !== projectId),
    sessions: sessions.map(s =>
      s.projectId === projectId
        ? { ...s, projectId: DEFAULT_PROJECT_ID }
        : s
    ),
  };
}
```

关键规则：
- 默认项目不可删除
- 系统项目不可删除
- 自定义项目删除时，所属会话移回默认项目
- 不删除任何会话

---

## 七、sourceType 策略

创建会话时自动标记来源：

| 入口 | sourceType |
|---|---|
| 点击 "新建对话" | `"chat"` |
| Skill Center "生成并进入对话" | `"skill"` |
| AI 文件库 "用于 Agent 分析" | `"file"` |
| 调试/诊断产生 | `"debug"` |
| Onboarding 创建 | `"onboarding"` |

`sourceType` 用于未来 UI 标签或统计，不参与项目分组逻辑。

---

## 八、后台 run 兼容

| 场景 | 处理 |
|---|---|
| run 完成后写回 session | 按 `sessionId` 写回，与 projectId 无关 ✅ |
| 会话移动项目 | run 仍写回原 sessionId，不受影响 |
| 用户切到其他项目 | 当前 run 对应的 session 可能被筛选掉，通过全局 run indicator 提示 |
| 全局 running 指示 | 继续使用 `hasRunningRun`，不依赖项目筛选 |

---

## 九、安全边界

- project name / description 是用户本地文本，不包含 token
- 不存储 provider / baseUrl / API URL / Authorization / Bearer 到 project metadata
- 不存储 gateway.auth.token 到 project
- 不与 .env 交互
- 不输出 token
- 项目数据与历史会话一起备份，备份不包含敏感信息

---

## 十、后续任务拆分

| Task ID | 内容 | 预计改动 |
|---|---|---|
| TASK-023C-B | 项目列表 UI + 默认项目显示 | `App.tsx` — 新增 ProjectsSidebar 或在现有侧栏顶部加项目选择器；`hermes.ts` — ChatSession 加 projectId 可选字段 |
| TASK-023C-C | 创建项目 + 移动到项目 + 筛选 | `App.tsx` — 新增创建项目对话框、移动会话菜单项、筛选下拉 |
| TASK-023C-D | 项目重命名 / 删除 / 回归 | `App.tsx` — 重命名/删除逻辑；`release-checklist.md` 加验收项 |

### 依赖关系

```
TASK-023C-A (设计,本轮)
    ↓
TASK-023C-B (UI + 默认项目)
    ↓
TASK-023C-C (创建 + 移动 + 筛选)
    ↓
TASK-023C-D (重命名 + 删除 + 回归)
```

---

## 十一、风险与回滚方案

| 风险 | 缓解 |
|---|---|
| 旧会话兼容性 | 运行时 fallback `projectId || DEFAULT_PROJECT_ID`，不强制迁移 |
| 存储格式变更 | 使用 version 字段 + 数组格式检测，双重兼容 |
| 删除项目误操作 | 默认项目不可删除；删除自定义项目前弹确认对话框 |
| UI 复杂度 | 第一阶段只显示默认项目列表，项目选择器为可选下拉 |
| Rust command 改动 | 如果接口改动成本高，可通过 JS 层包装序列化/反序列化，不改 Rust |
