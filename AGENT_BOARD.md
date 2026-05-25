# AGENT_BOARD.md

## 0. 协作规则

- Codex 只做规划、任务拆解、审查，不直接修改业务代码。
- OpenCode 读取本文件，只执行“待执行”的最高优先级任务。
- 用户最终确认优先级和验收。
- 每次只执行一个任务，禁止一次性重构全项目。
- 执行完成后，OpenCode 必须写回执行反馈，包括改动文件、实现摘要、验证命令和结果。
- 不读取或输出 `.env` 内容。
- 不输出 Token。
- 不允许客户自定义 Base URL。
- 不暴露 provider、baseUrl、API URL 到普通用户 UI。
- 不恢复 fallback / 轻量模式。
- 不做视频生成、OCR、U 盘工作区、Windows WSL2 自动配置。

## 1. 项目新方向

项目方向从 **Hermes-only** 调整为 **OpenClaw-first**。

新的产品定位是：

> AI Agent Workspace with OpenClaw Backend

OpenClaw 将成为主体 Agent 后端。Hermes 不再作为普通用户主路径，后续应逐步降级、隐藏或删除 Hermes 相关能力。

迁移原则：

- 保留当前已经完成的 UI 和文件工作流，避免推倒重来。
- 先建立 Agent Backend 抽象，再接入 OpenClaw。
- 当前 Agent 对话界面、历史会话、AI 文件库、附件分析、回复保存为文件、Skill Center 页面框架、使用概况和 Onboarding 大框架尽量复用。
- Hermes 相关逻辑在迁移期可以作为旧 backend 包装保留，但不要继续投入 Hermes Cron、Hermes Memory、Hermes 配置写入等方向。
- 普通用户体验要从“配置 Hermes”转向“初始化并使用 Agent 工作台”。

## 2. 现有功能资产

### 应保留模块

- Agent 对话 UI
- 历史会话
- AI 文件库
- 文件上传 / 预览 / 分析
- 回复保存为文件
- Skill Center UI
- 使用概况
- Onboarding 框架
- Token 配置 UI

### 准备弱化 / 移除模块

- Hermes 管理
- Hermes 配置写入
- Hermes API Server 检测
- Hermes 原生记忆
- Hermes Cron / 定时任务
- Hermes 专属文案

## 3. 迁移路线

### Phase 0：OpenClaw 本地调用方式调研

目标：

- 先确认 OpenClaw 的安装方式、本地运行方式、gateway/API 形态、流式输出格式、鉴权方式和技能体系接入方式。
- 调研完成前，不设计最终 `AgentBackend` 接口，避免照搬 Hermes 形状导致返工。
- 输出可供后续架构任务使用的研究报告。

### Phase 1：Agent Backend 抽象

目标：

- 引入统一 `AgentBackend` 接口。
- 根据 OpenClaw 实际调用方式设计抽象，而不是盲目照搬 Hermes。
- 先把现有 Hermes 调用包起来，不改 UI 大逻辑。
- 为 `OpenClawBackend` 预留接口。
- 保持当前行为不变，降低后续替换成本。

### Phase 2：OpenClaw Backend 初版

目标：

- 新增 OpenClaw 检测。
- 新增 OpenClaw 本地服务连接配置。
- 实现 OpenClaw chat 调用。
- Agent 对话能通过 OpenClaw 返回内容。

### Phase 3：Onboarding / 管理页切换

目标：

- Onboarding 从 Hermes 安装引导改为 OpenClaw 初始化。
- 管理页从 Hermes 管理改成 Agent 引擎管理。
- 普通用户默认 OpenClaw。
- Hermes 入口隐藏到高级 / 开发者模式或删除。

### Phase 4：Skill Center 接 OpenClaw 技能生态

目标：

- Skill Center 从本地模板为主，改成 OpenClaw 技能展示 / 启用 / 运行。
- 保留当前官方模板作为“内置模板”。
- 支持 OpenClaw 技能库或本地技能目录。

### Phase 5：清理 Hermes 残留

目标：

- 删除普通 UI 中 Hermes-only 文案。
- 删除未使用 Hermes command。
- 删除定时任务页。
- 删除 Hermes 记忆页或改为 OpenClaw 记忆 / 知识库页。

## 4. 当前第一批任务队列

### TASK-001：OpenClaw 本地调用方式调研

- 状态：已完成
- 优先级：P0
- 负责人：OpenCode

任务目标：

- 不改代码。
- 不修改 `src/` 或 `src-tauri/`。
- 输出 `docs/openclaw-backend-research.md`。
- 调研 OpenClaw 是否适合替代 Hermes 成为主 Agent 后端。
- 在本文件的 OpenCode 执行反馈区写回结果摘要。

### TASK-002：建立 Agent Backend 抽象层，不改变现有行为

- 状态：待验收
- 优先级：P0
- 负责人：OpenCode

说明：

- 必须等 TASK-001 调研完成后再细化。
- `AgentBackend` 接口应根据 OpenClaw 实际调用方式设计，不要盲目照搬 Hermes。
- 已在用户确认后由 OpenCode 执行本任务。

#### OpenCode 执行反馈

- 修改文件：`src/lib/agentBackend.ts`，`src/App.tsx`，`AGENT_BOARD.md`
- 修改摘要：新增 `AgentBackend` 抽象类型与能力模型，包含 `AgentBackendType`、`AgentBackendStatus`、`AgentBackendCapabilities`、`AgentChatMessage`、`AgentChatRequest`、`AgentRunHandle`、`AgentEvent`、`AgentBackend`；新增 `HermesLegacyBackend`，包装现有 Hermes installed/status/chat/cancel 能力，并预留事件桥接接口以适配 OpenClaw Gateway/WebSocket event model；`ChatPage` 仅将 Hermes 状态检测、提交对话和停止生成改为调用 `HermesLegacyBackend`，保留原有 Tauri 事件监听、流式输出、附件分析、Skill 进入对话和 UI 行为。
- 验证命令：`npm run build`；`cargo check`
- 验证结果：通过。`npm run build` 完成 `tsc && vite build`；`cargo check` 在 `src-tauri` 通过。未修改 Rust command，未接 OpenClaw 真实调用，未删除 Hermes，未改 Token 写入逻辑。
- 残余风险：未做真实 GUI 人工点击验证；需验收 Agent 普通对话、停止生成、文件附件分析、Skill 运行生成指令后进入对话是否仍正常。`OpenClawBackend` 仅保留 TODO，真实接入应在后续 TASK-005 执行。

### TASK-003：删除普通导航中的定时任务页面

- 状态：待验收
- 优先级：P1
- 负责人：OpenCode

说明：

- 这个可以在 TASK-001 后执行，属于低风险收口任务。
- 从普通侧边栏移除定时任务入口。
- 不删除后端 Cron command，先保留。
- `docs/release-checklist.md` 同步调整。

#### OpenCode 执行反馈

- 修改文件：`src/App.tsx`，`docs/release-checklist.md`，`AGENT_BOARD.md`
- 修改摘要：从普通左侧导航和移动端页面选择器的数据源中移除“定时任务”入口；从 `Page` 分发中移除 `tasks` 页面分支，普通用户无法再通过普通 UI 进入定时任务页；保留前端 Cron 页面组件和 Rust 后端 cron command，未删除后端逻辑。
- 验证命令：`npm run build`；`cargo check`；`git status --short`；代码检索 `id: "tasks"|active === "tasks"|setActive\("tasks"|Timer`；后端检索 `read_hermes_cron_overview|read_hermes_cron_cli_status|cron`
- 验证结果：`npm run build` 通过；`cargo check` 通过；`src/App.tsx` 中不再存在 `tasks` 导航项、`tasks` 页面分支或 `Timer` 导航图标引用；`src-tauri/src/main.rs` 中 `read_hermes_cron_overview`、`read_hermes_cron_cli_status` 和 invoke handler 仍保留。
- 残余风险：未删除未引用的前端 `TasksPage` 组件，避免本轮扩大改动；未做真实 GUI 点击检查，人工验收时仍需确认 App 不白屏、Agent 对话、Skill Center、AI 文件库、使用概况均正常。

### TASK-004：OpenClaw Gateway smoke test

- 状态：已完成
- 优先级：P1
- 负责人：OpenCode

说明：

- 按用户本轮指令执行 OpenClaw Gateway smoke test，不执行旧 Onboarding 文案任务。
- 不修改 `src/` 或 `src-tauri/`。
- 不读取 `.env`，不输出 Token，不修改 OpenClaw 配置，不执行 `openclaw doctor --repair`。

#### OpenCode 执行反馈

- 修改文件：`docs/openclaw-smoke-test.md`，`scripts/openclaw-smoke-test.mjs`，`AGENT_BOARD.md`
- 修改摘要：新增 OpenClaw Gateway smoke test 文档和只读 Node 脚本；覆盖 macOS、Windows 原生、Gateway `18789`、`/v1/models`、WebSocket、常见问题和接入 `OpenClawBackend` 前必须确认的 API 行为。脚本只使用 Node 内置能力，执行 `openclaw --version`、`openclaw gateway status`、Gateway HTTP 探测、`GET /v1/models`、WebSocket 探测；不读取 `.env`，不发送或输出 gateway token，不修改配置。
- 关键判断：Gateway 可达不等于 OpenAI-compatible API 可用，Control UI 可达不等于 `/v1/models` 可用；`/v1/models` 必须区分 JSON、`401` / `403` 鉴权失败、`text/html` / Control UI fallback。WebSocket RPC `connect.challenge` / hello-ok 行为应作为后续 `OpenClawBackend` 接入重点验证对象。
- 验证命令：`npm run build`；`cargo check`；`node scripts/openclaw-smoke-test.mjs`
- 验证结果：`npm run build` 通过；`cargo check` 在 `src-tauri` 通过；smoke test 无 hard failure。实测 OpenClaw `2026.5.22`，Gateway runtime running，监听 `127.0.0.1:18789`，HTTP root 返回 `200 OK`，WebSocket 成功连接并收到 `connect.challenge`。
- 重要实测：`GET /v1/models` 返回 `200 OK` 但 `content-type=text/html; charset=utf-8`，响应体为 Control UI HTML 摘要，因此脚本判定为 WARN：`html_fallback=possible_control_ui; api_confirmed=false`。后续 `OpenClawBackend` 不应盲目依赖 `/v1/models`，必须先确认真实 endpoint、header、鉴权方式和返回 schema。
- 残余风险：未做 Windows 原生实机验证；未实现 OpenClaw auth、device pairing、完整 WS handshake 或 chat RPC；未修改业务代码。

### TASK-005：新增 OpenClaw Backend 初版

- 状态：待规划
- 优先级：P1
- 负责人：OpenCode

## 5. TASK-001 详细说明

### TASK-001: OpenClaw 本地调用方式调研

#### 背景

项目方向已经从 Hermes-only 转为 OpenClaw-first，但当前还没有确认 OpenClaw 的真实本地调用方式。

如果现在先按 Hermes 的接口形状抽象，可能会把错误边界固化进项目，后续接 OpenClaw 时产生返工。

因此第一步不是改代码，而是调研 OpenClaw 是否适合替代 Hermes 成为主 Agent 后端，并明确它的安装、启动、API、流式输出、鉴权和技能体系。

#### 目标

- 不改业务代码。
- 不修改 `src/` 或 `src-tauri/`。
- 输出 `docs/openclaw-backend-research.md`。
- 为后续 TASK-002 的 Agent Backend 抽象提供事实依据。

#### 调研内容

1. OpenClaw 是否能在 macOS / Windows 原生运行。
2. Windows 是否需要 WSL2。
3. 是否通过 npm 安装。
4. 是否能作为普通本地进程启动。
5. 是否有本地 HTTP API / gateway。
6. 是否支持 OpenAI-compatible 模型供应。
7. 是否支持固定 Base URL 为我们的中转站。
8. 是否支持用户只填 Token。
9. 是否支持流式输出。
10. 是否支持技能系统。
11. Skill Center 如何接 OpenClaw 技能。
12. 是否能由 Tauri App 检测 / 启动 / 停止。
13. 需要哪些配置文件。
14. 与当前 Hermes 功能对照：
    - Agent 对话
    - 停止生成
    - 历史会话
    - 文件分析
    - Skill Center
    - AI 文件库
    - 使用概况
    - 记忆
    - 定时任务

#### 输出文件

`docs/openclaw-backend-research.md`

建议报告结构：

```md
# OpenClaw Backend Research

## Summary

## Installation And Runtime

## Windows Compatibility

## macOS Compatibility

## Local Process / Gateway

## Chat API

## Streaming

## Auth And Model Provider Configuration

## Skill System

## Tauri Integration Feasibility

## Feature Mapping Against Current Hermes App

## Risks / Unknowns

## Recommendation
```

#### 修改范围

允许修改：

- `docs/openclaw-backend-research.md`
- `AGENT_BOARD.md` 的 TASK-001 执行反馈区

禁止修改：

- `src/`
- `src-tauri/`
- `package.json`
- `package-lock.json`
- Tauri 配置文件
- 构建配置文件

#### 禁止事项

- 不要改业务代码。
- 不要新增依赖。
- 不要执行会修改项目结构的安装命令。
- 不要读取或输出 `.env` 内容。
- 不要输出 Token。
- 不要恢复 Hermes-only 设计。
- 不要恢复 fallback / 轻量模式。
- 不要允许客户自定义 Base URL。
- 不要暴露 provider / baseUrl / API URL 到普通 UI。
- 不要做视频生成、OCR、U 盘工作区、Windows WSL2 自动配置。

#### 验收标准

- `docs/openclaw-backend-research.md` 已创建。
- 报告覆盖全部 14 项调研内容。
- 报告明确给出 OpenClaw 是否适合作为主 Agent 后端的建议。
- 报告明确指出 TASK-002 设计 `AgentBackend` 时需要哪些接口能力。
- 没有修改 `src/` 或 `src-tauri/`。
- 没有读取或输出 `.env` 内容。
- 没有输出 Token。

#### 需要执行的验证命令

本任务不要求运行构建命令，因为不应修改业务代码。

建议执行：

```bash
git diff --stat
```

确认只新增 / 修改：

```bash
docs/openclaw-backend-research.md
AGENT_BOARD.md
```

#### OpenCode 执行反馈

OpenCode 执行反馈：

- 改动文件：`docs/openclaw-backend-research.md`，`AGENT_BOARD.md`
- 调研摘要：已调研 OpenClaw 安装、运行、本地 Gateway、WebSocket RPC、OpenAI-compatible HTTP endpoints、流式事件、停止生成、模型/Token 配置、Skill/ClawHub、Windows 支持和与当前 Hermes 功能的映射。
- 关键结论：OpenClaw 有本地 Gateway，默认端口 `18789`，主控制面是 WS RPC + events，同时提供 `/v1/chat/completions`、`/v1/responses` 等兼容端点；Windows 原生可用但 WSL2 仍是官方推荐完整体验路径；Skill/ClawHub 能承接 Skill Center 迁移。
- 是否建议 OpenClaw 作为主后端：建议作为主后端方向推进，但采用分阶段迁移，不建议在 TASK-002 直接做 OpenClaw-only 或按 Hermes SSE 形状固化接口。
- TASK-002 接口设计建议：`AgentBackend` 应包含 status/capabilities、session list/history/create/reset/delete、sendMessage、subscribeEvents、abort、models、usage、skills 等能力；事件层需能表达 text delta、message snapshot、tool event、done、error；普通 UI 不暴露 provider/baseUrl/API URL。
- 未做事项：未修改业务代码；未实现 `AgentBackend` 或 `OpenClawBackend`；未修改 `src/`、`src-tauri/`、依赖、Tauri 配置或构建配置；未读取 `.env`；未输出 Token。
- 验证命令：`git diff --stat`；`git diff -- docs/openclaw-backend-research.md AGENT_BOARD.md`；`git status --short`；`git diff --no-index --stat /dev/null docs/openclaw-backend-research.md`
- 验证结果：通过。`git status --short` 仅显示 `AGENT_BOARD.md` 与 `docs/openclaw-backend-research.md`；未出现 `src/`、`src-tauri/`、依赖、Tauri 配置或构建配置变更。`docs/openclaw-backend-research.md` 为新文件，新增 312 行。
- 遇到的问题：OpenClaw API 面较大，建议 TASK-005 对 Windows native、WS connect、`chat.send`、`chat.abort`、`chat.history`、`skills.status` 做真实 smoke test。

## 6. 审查记录

### Codex 审查反馈：TASK-001

- 审查日期：2026-05-25
- 审查范围：`AGENT_BOARD.md`、`docs/openclaw-backend-research.md`
- 审查结论：TASK-001 合格，建议状态改为“已完成”。
- 业务代码检查：本次审查未修改 `src/`、`src-tauri/`，未执行 TASK-002，未读取 `.env`，未输出 Token。

#### 关键判断

1. OpenClaw 是否适合作为主 Agent 后端？
   - 结论：适合作为主后端候选，可以继续推进 OpenClaw-first 迁移，但不建议立刻做 OpenClaw-only。
   - 原因：报告确认 OpenClaw 有本地 Gateway、会话、事件、模型、用量、技能、文件/媒体、记忆等能力，覆盖当前产品主路径。但它的主控制面比 Hermes 更复杂，迁移必须分阶段。

2. OpenClaw 是否能在 Windows 普通用户环境下原生运行？
   - 结论：可以原生运行，但存在普通用户体验风险。
   - 原因：报告确认 native Windows 支持 core CLI 和 Gateway，也有 PowerShell 安装脚本与 managed startup；但文档仍把 WSL2 描述为更稳定/完整体验路径。

3. 是否仍需要 WSL2？
   - 结论：不应作为普通客户默认要求，但应作为高级兼容修复路径保留在售后文档中。
   - 产品判断：普通 onboarding 不应引导用户安装或配置 WSL2，否则会回到 Hermes 当前的售后成本问题。

4. 是否有稳定的本地 Gateway / HTTP API？
   - 结论：有本地 Gateway，默认端口 `18789`，并同时提供 WS RPC 与 OpenAI-compatible HTTP endpoints。
   - 风险：完整 Agent 能力主要在 WS RPC + events；HTTP endpoints 适合基础 chat 验证，但不应作为唯一抽象依据。

5. 是否支持流式输出和取消生成？
   - 结论：支持。
   - 设计影响：流式不应只抽象为 Hermes 风格 SSE；需要统一事件层表达 text delta、message snapshot、tool events、done、error。取消生成应支持 session/run 维度，例如 `chat.abort` / `sessions.abort`。

6. 是否能固定 baseUrl 为我们的中转站，只让客户填写 Token？
   - 结论：可行，但必须内部化配置。
   - 约束：普通 UI 只暴露 Token；provider/baseUrl/API URL 只能由内部配置写入或高级诊断使用，不可进入普通用户 UI。Token 不得走 CLI 参数，不得出现在日志或报告中。

7. Skill Center 是否可以迁移到 OpenClaw 技能体系？
   - 结论：可以。
   - 迁移建议：保留当前官方模板作为“内置模板”，新增 OpenClaw skills inventory，再逐步接 `skills.status`、`skills.search`、`skills.detail`、`skills.install`、`skills.update` 或 ClawHub。

8. 当前项目哪些模块可以复用？
   - 可复用：Agent 对话 UI、历史会话 UI、本地会话列表体验、AI 文件库、上传/预览/分析、回复保存为文件、Skill Center 页面框架、使用概况页面、Onboarding 外壳、Token 配置 UI。
   - 需要适配：聊天事件状态机、停止生成、附件传入后端的边界、使用概况数据来源、Skill Center 数据源、Onboarding 文案和检测逻辑。

9. 哪些 Hermes 模块应该移除或降级？
   - 应降级/隐藏：Hermes 管理页、Hermes API Server 检测、Hermes 配置写入、Hermes 原生记忆、Hermes Cron / 定时任务、Hermes-only 文案。
   - 迁移期可保留：Hermes chat 作为 legacy backend 包装，但不要继续扩展 Hermes-only 功能。

10. TASK-002 是否应该立即开始？
    - 结论：可以开始，但只能做“接口设计 + legacy Hermes 包装”的小步任务，不能实现 OpenClaw 真实调用，也不能一次性重构 UI。
    - 前置约束：TASK-002 必须以本报告为边界，设计 capability/event/session-first 接口，不能按 Hermes SSE 形状硬套。

11. 如果开始 TASK-002，AgentBackend 接口应该如何设计？
    - 必须包含 backend status 与 capabilities，不只是 `checkStatus()`。
    - 必须支持非阻塞发送：`sendMessage()` 返回 `runId` / `operationId`。
    - 必须支持事件订阅：text delta、message snapshot、tool event、usage、done、error、connection state。
    - 必须支持取消：按 `sessionId` 和可选 `runId` abort。
    - 必须支持会话：list/create/history/reset/delete 至少预留。
    - 必须支持附件边界：让 UI 继续保留本地 AI 文件库，同时 backend 能声明是否支持 native attachments。
    - 必须支持能力发现：streaming、abort、sessions、skills、usage、memory、cron、tools、attachments。
    - Skill、usage、memory、cron 建议作为可选能力模块，不要塞进最小 chat 接口。

#### TASK-002 建议边界

建议将下一任务改为：

> TASK-002：设计并落地 Agent Backend 最小抽象，不接 OpenClaw 真实调用

建议允许范围：

- 新增 `src/lib/agentBackend.ts`
- 可新增 `src/lib/agentBackends/hermesBackend.ts`
- 如必要，只做最小 import 调整以保证 build

建议禁止范围：

- 不改 UI 页面结构。
- 不实现 OpenClaw 网络请求。
- 不新增依赖。
- 不改 `src-tauri/`。
- 不删除 Hermes command。
- 不引入普通用户可见 provider/baseUrl/API URL。

建议最小接口能力：

```ts
export type AgentBackendType = "hermes" | "openclaw";

export interface AgentBackendCapabilities {
  streaming: boolean;
  abort: boolean;
  sessions: boolean;
  attachments: boolean;
  skills: boolean;
  usage: boolean;
  memory: boolean;
  cron: boolean;
  tools: boolean;
}

export interface AgentBackendStatus {
  type: AgentBackendType;
  label: string;
  installed: boolean;
  running: boolean;
  ready: boolean;
  detail?: string;
  version?: string | null;
  capabilities: AgentBackendCapabilities;
}

export type AgentBackendEvent =
  | { type: "text_delta"; requestId: string; sessionId?: string; runId?: string; text: string }
  | { type: "message_snapshot"; requestId: string; sessionId?: string; runId?: string; content: string }
  | { type: "reasoning_delta"; requestId: string; sessionId?: string; runId?: string; text: string }
  | { type: "tool_event"; requestId: string; sessionId?: string; runId?: string; label: string; data?: unknown }
  | { type: "usage"; requestId: string; sessionId?: string; runId?: string; usage: unknown }
  | { type: "done"; requestId: string; sessionId?: string; runId?: string; stopped?: boolean }
  | { type: "error"; requestId: string; sessionId?: string; runId?: string; error: string };
```

#### 信息完整性评价

- TASK-001 覆盖了要求的 14 项调研内容。
- 报告给出了明确建议：OpenClaw 可作为主后端方向，但需要分阶段迁移。
- 报告指出了 Windows native 与 WSL2 的产品风险。
- 报告明确提醒 TASK-002 不要照搬 Hermes SSE。
- 未发现需要 OpenCode 立即补充的问题。

#### 参考资料

- `docs/openclaw-backend-research.md`
- OpenClaw docs: https://docs.openclaw.ai
- Gateway docs: https://docs.openclaw.ai/gateway
- Gateway protocol: https://docs.openclaw.ai/gateway/protocol
- Windows docs: https://docs.openclaw.ai/platforms/windows

#### 用户确认后的审查补充

1. OpenClaw 可以作为 OpenClaw-first 主后端方向。
2. 不建议直接进行 OpenClaw-only 重构，应保留分阶段迁移路径。
3. TASK-002 应先做 `AgentBackend` 抽象，不改变现有 Hermes 行为。
4. `AgentBackend` 抽象不能照搬 Hermes SSE 模型，应面向 OpenClaw Gateway / WebSocket event model，至少覆盖：
   - status / capabilities
   - connect / disconnect
   - session
   - send message
   - event subscription
   - abort run
   - tool events
   - usage
   - skills
5. ClawHub 第三方技能安装有安全风险。短期 Skill Center 只保留内置模板和 OpenClaw skill 状态读取，不开放任意第三方 skill 一键安装。
6. Windows 原生 OpenClaw 虽可用，但仍需 smoke test，不应承诺完全无坑。
7. 下一步建议执行 TASK-002：Agent Backend 抽象层，不改 UI 大逻辑、不删除 Hermes、不接真实 OpenClaw。

### Codex 审查反馈：TASK-004

- 审查日期：2026-05-25
- 审查范围：`docs/openclaw-smoke-test.md`、`scripts/openclaw-smoke-test.mjs`、`AGENT_BOARD.md`
- 审查结论：TASK-004 合格，建议状态改为“已完成”。
- 业务代码检查：本次审查未修改 `src/`、`src-tauri/`，未执行 TASK-005，未读取 `.env`，未输出 Token。

#### 关键判断

1. smoke test 是否正确区分 Gateway 可达、Control UI 可达、OpenAI-compatible API 可用？
   - 结论：区分正确。
   - 依据：文档明确写出 Gateway 可达不等于 OpenAI-compatible API 可用，Control UI 可达也不等于 `/v1/models` 可用；脚本分别检查 HTTP root、`GET /v1/models` 和 WebSocket。

2. `/v1/models` 返回 `text/html` fallback 时是否被判定为 WARN，而不是误判成功？
   - 结论：是。
   - 依据：脚本检查 `content-type` 和响应体中的 Control UI 标记；命中 `text/html` / `openclaw-app` / `OpenClaw Control UI` 时记录 `WARN`，并标注 `api_confirmed=false`。

3. WebSocket `connect.challenge` 是否作为后续 `OpenClawBackend` 的主要依据？
   - 结论：是。
   - 依据：文档明确指出 WebSocket RPC 的 `connect.challenge` / `hello-ok` 行为比 HTTP `/v1/models` 更关键；脚本将收到 `connect.challenge` 作为 WebSocket PASS 条件。

4. 脚本是否没有读取 `.env`、没有输出 Token、没有修改 OpenClaw 配置？
   - 结论：符合要求。
   - 依据：脚本未读取 `.env` 文件，未写入 OpenClaw config，未执行 repair/install 类命令；只调用 `openclaw --version`、`openclaw gateway status`、HTTP 探测和 WebSocket 探测。输出经过 `sanitize()` 脱敏。注意：脚本会把当前 `process.env` 传给 `openclaw` 子进程，这是正常 CLI 执行环境，不等于读取项目 `.env`。

5. 是否可以将 TASK-004 标记为已完成？
   - 结论：可以。
   - 原因：文档和脚本覆盖了 macOS、Windows 原生、Gateway、Control UI、`/v1/models` fallback、WebSocket challenge、常见问题和后续接入前必须确认项；没有发现需要 OpenCode 立即补充的问题。

6. 下一步是否应该设计 OpenClawBackend 初版，且优先走 WebSocket RPC，而不是 HTTP `/v1/models`？
   - 结论：是，但应分成小任务。
   - 建议：下一步可以规划 OpenClawBackend 初版，优先验证 WebSocket `connect.challenge`、完整 handshake、`chat.send`、event subscription、`chat.abort`。HTTP `/v1/models` 只能作为辅助能力探测，不能作为主接入依据。

#### TASK-005 建议边界

建议将 TASK-005 细化为：

> TASK-005：OpenClawBackend 初版设计与最小 WebSocket RPC 接入验证

建议目标：

- 不改大 UI，不替换主路径为 OpenClaw-only。
- 新增 OpenClaw backend 的最小连接层，优先走 Gateway WebSocket RPC。
- 实现或验证 `connect.challenge`、`connect` handshake、基础 status、send message、event subscription、abort run。
- `/v1/models` 只作为辅助诊断；若返回 Control UI HTML，必须保留 WARN，不得当作 models API 成功。
- 不开放 ClawHub 第三方 skill 一键安装。
- 不读取 `.env`，不输出 Token，不修改 OpenClaw 配置。

建议暂不做：

- 不做 OpenClaw-only 重构。
- 不迁移全部 Skill Center。
- 不做 provider/baseUrl 普通 UI。
- 不做 Windows WSL2 自动配置。
- 不实现第三方 skill 安装。

#### 残余风险

- smoke test 文档和脚本本身合格，但 Windows 原生仍需要实机 smoke test，不能承诺完全无坑。
- OpenClaw auth、device pairing、scopes、`hello-ok` 和 chat event payload 仍需 TASK-005 真实验证。
- `/v1/models` 当前实测为 Control UI HTML fallback，后续不能依赖它作为 backend 主路径。
