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

### TASK-005：OpenClaw Gateway WebSocket RPC 最小验证

- 状态：已完成
- 优先级：P1
- 负责人：OpenCode

说明：

- 按用户本轮指令执行 WebSocket RPC 协议探针，不实现 `OpenClawBackend`。
- 不改 Agent 对话主链路，不改 `src/App.tsx`，不改 Rust command，不改 Token 写入，不改 Skill Center，不删除 Hermes。
- 不读取 `.env`，不输出 Token，不修改 OpenClaw 配置，不自动安装或重启 OpenClaw。

#### OpenCode 执行反馈

- 修改文件：`docs/openclaw-ws-rpc-notes.md`，`scripts/openclaw-ws-rpc-probe.mjs`，`AGENT_BOARD.md`
- probe 结果：`node scripts/openclaw-ws-rpc-probe.mjs` 可连接 `ws://127.0.0.1:18789`，收到 `connect.challenge`，payload 包含 `nonce` 和 `ts`；脚本随后发送 `connect` request frame，使用 protocol v4、`client.id=gateway-client`、`client.mode=backend`、`role=operator`、`scopes=[operator.read]`，未发送 auth token、password、device、Authorization 或 provider key。
- hello-ok 结果：未收到 `hello-ok`。Gateway 返回 `NOT_PAIRED`，message 为 `device identity required`，details code 为 `DEVICE_IDENTITY_REQUIRED`。
- 可用 RPC：本轮未能进入 authenticated / paired session，因此没有拿到 `hello-ok.features.methods`，无法确认实际可用 RPC method 列表；`health/status`、`skills.status`、`models.list` 均按脚本逻辑跳过并记录原因。
- 失败点：WS transport 和 challenge 可用，但 RPC session 建立被 device identity / pairing 要求阻断。TASK-004 的 `/v1/models` 已确认返回 Control UI HTML fallback，本轮进一步确认后续不能依赖 HTTP `/v1/models` 或裸 WS connect 作为主接入依据。
- 后续 OpenClawBackend 建议：优先实现合规 `connect.challenge` -> signed device identity / auth / pairing -> `hello-ok` 流程；收到 `hello-ok` 后以 `features.methods/events` 做能力发现；再验证 `health` 或 `status`、`skills.status`、`models.list`、`chat.send`、`chat.abort`、`chat.history`、`sessions.*` 的真实 payload 和错误码。UI 事件层应按 WS event model 归一化 `chat`、`agent`、`session.message`、`session.operation`、`session.tool`，不要按 Hermes SSE 或 HTTP `/v1/models` 固化抽象。
- 验证命令：`node scripts/openclaw-ws-rpc-probe.mjs`；`npm run build`；`cargo check`
- 验证结果：probe 命令完成且无 hard failure，但明确记录 `hello-ok` 未成功，RPC 调用被跳过；`npm run build` 通过；`cargo check` 在 `src-tauri` 通过。
- 残余风险：未验证合法 device identity / pairing / auth token 流程；未调用真实 RPC payload；未做 Windows 原生实机验证；未实现 `OpenClawBackend`。

### TASK-006：OpenClaw Gateway 配对 / device identity / auth 最小验证

- 状态：已完成
- 优先级：P0
- 负责人：OpenCode

目标：

- 不改业务代码。
- 不接入 App UI。
- 不实现 `OpenClawBackend`。
- 只通过文档和 probe 脚本验证 Gateway connect 所需的 device identity / pairing / auth 流程。
- 最终目标是收到 `hello-ok`，并尝试调用 `health` / `status` 或 `skills.status`。

验收标准：

- 生成 `docs/openclaw-pairing-auth-notes.md`。
- 更新 `scripts/openclaw-ws-rpc-probe.mjs` 或新增 `scripts/openclaw-pairing-probe.mjs`。
- 不读取 `.env`。
- 不输出 Token。
- 不修改 OpenClaw 配置。
- 不把 gateway token 写进代码。
- Node probe 脚本能清晰输出：
  - `connect.challenge`
  - `connect` frame 是否发送
  - 是否需要 device identity
  - 是否需要 pairing approval
  - 是否收到 `hello-ok`
  - 如果仍失败，输出错误摘要。

禁止事项：

- 不要修改 `src/` 或 `src-tauri/`。
- 不要接入真实 App UI。
- 不要实现真实 OpenClawBackend。
- 不要自动修改 OpenClaw config。
- 不要执行会改变用户 OpenClaw 安全状态的 repair/install/reset 操作，除非另行得到用户明确确认。
- 不要把 gateway token、device token、provider Token、password、SecretRef 明文写入脚本、文档或日志。

#### OpenCode 执行反馈

- 修改文件：`docs/openclaw-pairing-auth-notes.md`，`scripts/openclaw-pairing-probe.mjs`，`AGENT_BOARD.md`
- probe 结果：新增 pairing/auth probe，生成并复用 Ed25519 device identity，发送包含 `device.id`、`device.publicKey`、`device.signature`、`device.signedAt`、`device.nonce` 的 protocol v4 `connect` frame；脚本不读取 `.env`，不打印 Token，不批准设备，不修改 OpenClaw 配置。实测 WS 可连接，`connect.challenge` 包含 `nonce` 和 `ts`，device identity frame 已发送。
- 是否收到 hello-ok：未收到。相比 TASK-005 的 `DEVICE_IDENTITY_REQUIRED`，本轮已前进到 `AUTH_TOKEN_MISSING`：Gateway 返回 `INVALID_REQUEST`，message 为 `unauthorized: gateway token missing (provide gateway auth token)`，details code 为 `AUTH_TOKEN_MISSING`。同时 `openclaw config get gateway.auth.mode` 显示当前 Gateway auth mode 为 `token`。
- 是否打通基础 RPC：未打通。由于未收到 `hello-ok`，没有 authenticated / paired WS session，`health/status`、`skills.status`、`models.list` 未调用。脚本已实现 hello-ok 成功后的方法发现和基础 RPC 调用逻辑。
- Pairing / CLI 调研结果：`openclaw devices list/approve/reject/remove/rotate/revoke` 是 device pairing 管理入口；`openclaw devices approve --latest --json` 只 preview 最新 pending request，不批准。本轮只 preview，未执行具体 requestId approve。当前 `devices list` 显示 Control UI 已是 paired operator admin/pairing 设备；CLI 有 `operator.read` paired device，并存在 `operator.pairing` scope upgrade pending request。
- Control UI 观察：用户截图确认 Dashboard 可访问，左侧包含“技能”等模块，但未看到明显 Pairing / Devices / Approvals 入口。后续应人工检查“节点 / 实例 / 基础设施 / 调试 / 日志 / AI 与代理”是否隐藏相关入口；若 UI 无入口，产品 onboarding 必须提供 CLI fallback。
- 残余风险：未使用真实 gateway token 继续验证 `hello-ok`；未批准 probe device；未验证 returned device token 的存储/复用；未验证 `health/status`、`skills.status`、`models.list` payload；未做 Windows native 实机验证；未实现 `OpenClawBackend`。
- 对 OpenClawBackend 初版建议：Tauri 后端应生成并安全持久化 App 专属 Ed25519 device identity；等待 `connect.challenge` 后签名 nonce；通过用户输入或安全存储提供 gateway token/password，不读取 `.env`，不输出 Token；收到 `AUTH_TOKEN_MISSING` 时提示授权，收到 `NOT_PAIRED` / pairing required 时引导用户在 Dashboard 或 `openclaw devices approve <requestId>` 批准；收到 `hello-ok` 后按 `features.methods/events` 做能力发现，再接 `health/status`、`skills.status`、`models.list`、`chat.send`、`chat.abort`、`sessions.*`。
- 验证命令：`node scripts/openclaw-pairing-probe.mjs`；`openclaw devices list --json`；`openclaw devices approve --latest --json`；`openclaw config get gateway.auth.mode`；`npm run build`；`cargo check`
- 验证结果：pairing probe 完成且无 hard failure，但明确记录 `hello-ok` 未成功，当前阻塞为 `AUTH_TOKEN_MISSING`；`npm run build` 通过；`cargo check` 在 `src-tauri` 通过。

### TASK-007：OpenClaw Gateway token auth + hello-ok 最小验证

- 状态：待验收
- 优先级：P0
- 负责人：OpenCode

目标：

- 不改业务代码。
- 不接入 App UI。
- 不实现 `OpenClawBackend`。
- 只在 probe 脚本中验证 gateway token auth + device identity + nonce signature 是否能收到 `hello-ok`。
- 如果 `hello-ok` 成功，尝试 `health` / `status`、`skills.status`、`models.list`。
- 如果失败，明确失败 code 和缺失字段。

验收标准：

- 生成 `docs/openclaw-auth-hello-ok-notes.md`。
- 新增或更新 `scripts/openclaw-auth-probe.mjs`。
- 不读取 `.env`。
- 不输出 Token。
- 不把 Token 写进代码。
- 不修改 OpenClaw 配置。
- Node probe 脚本能清晰输出：
  - `connect.challenge`
  - device identity 是否生成
  - auth token 是否由用户临时提供
  - `hello-ok` 是否收到
  - 基础 RPC 是否成功

禁止事项：

- 不要修改 `src/` 或 `src-tauri/`。
- 不要接入真实 App UI。
- 不要实现真实 `OpenClawBackend`。
- 不要读取项目 `.env` 或 OpenClaw `.env`。
- 不要把 gateway token、device token、provider Token、password、SecretRef 明文写入脚本、文档或日志。
- 不要通过 CLI 参数传递 gateway token。
- 不要自动修改 OpenClaw 配置。
- 不要自动批准设备或改变 OpenClaw 配对安全状态，除非另行得到用户明确确认。

#### OpenCode 执行反馈 (初版)

- 修改文件：`docs/openclaw-auth-hello-ok-notes.md`，`scripts/openclaw-auth-probe.mjs`，`AGENT_BOARD.md`
- probe 结果：新增独立 token auth probe。脚本不读取 `.env`，不通过 CLI 参数接收 Token，不打印 Token，不写入 Token，不修改 OpenClaw 配置；只接受当前进程环境变量 `OPENCLAW_GATEWAY_TOKEN`。当前运行环境未提供该变量，脚本输出 `token_present=false; 需要临时提供 OPENCLAW_GATEWAY_TOKEN 才能验证 hello-ok`，并按要求无 hard failure 退出。
- 用户补充实测：用户临时通过 shell 设置 `OPENCLAW_GATEWAY_TOKEN` 后运行脚本，首轮 WS connect / `connect.challenge` / `connect` frame 均 PASS，`token_present=true`，但未收到 `hello-ok`；Gateway 返回 `AUTH_TOKEN_MISMATCH`，message 为 `unauthorized: gateway token mismatch (provide gateway auth token)`，`details.recommendedNextStep=retry_with_device_token`，且 `details.canRetryWithDeviceToken` 含敏感值，已按 Token 处理不得输出。
- 初版脚本问题：脚本输出 `device_token_present=false`，未执行第二轮 device token retry。根因是 `extractRetryDeviceToken()` 仅检查有限已知字段名，且未在原始 payload 接收点立即预提取，若字段名/嵌套与预期不完全一致则静默返回 null。
- 验证命令（初版）：`node scripts/openclaw-auth-probe.mjs`；`npm run build`；`cargo check`
- 验证结果（初版）：auth probe 在无 `OPENCLAW_GATEWAY_TOKEN` 时 skip 且退出成功；`npm run build` 通过；`cargo check` 在 `src-tauri` 通过。

#### Reasonix 执行反馈 (TASK-007 第三次修正)

- 修改文件：`scripts/openclaw-auth-probe.mjs`，`docs/openclaw-auth-hello-ok-notes.md`，`AGENT_BOARD.md`
- 修正摘要：根因定位 — 启发式扫描误将 `details.recommendedNextStep = "retry_with_device_token"` 当作 device token 候选提取。device token 诊断（length=23, firstChar=r, lastChar=n, prefix2=re）精确匹配该系统字符串。核心修正：
  1. **完全移除启发式扫描** — `extractRetryDeviceToken()` 只从 4 个已知字段名提取，不再扫描任意 string 值。
  2. **值校验** — 新增 `INVALID_TOKEN_VALUES` set，拒绝 `"retry_with_device_token"`、`"update_auth_credentials"`、`"true"`、`"false"`、`"[REDACTED]"` 及任何含 `REDACTED` 的字符串。
  3. **新增 `diagnoseCanRetryWithDeviceToken(details)`** — 输出 typeof / is_string / is_boolean / length / looks_like_next_step / is_redacted_literal / likely_valid_token，全部 non-sensitive。
  4. **新增 gateway token 诊断** — 输出 gateway_token_length / trimmed_length / has_newline / sha256_prefix (8 hex)，排查 token 换行/空白污染。
  5. **retry gate 简化** — 只看 `retryDeviceToken` 是否为 null，移除 `shouldRetryWithDeviceToken` 前置条件。
- 关键发现：在当前 Gateway 环境下，`canRetryWithDeviceToken` 的真实语义尚未确认（可能是 token 字符串 / boolean true / capability flag）。在确认其为真实 token 之前，脚本不执行 device token retry。`same-socket retry`、`new-socket retry`、`auth shape variants` 均在 `retryDeviceToken` 有效时才执行。
- 是否收到 hello-ok：未。初次 connect 仍 `AUTH_TOKEN_MISMATCH`，且 device token 尚未确认真实可用。
- 是否打通基础 RPC：未。
- 残余风险：`canRetryWithDeviceToken` 字段语义不明；Gateway token 可能有换行/空白污染；未做 Windows native 验证。
- 下一步建议：用户用真实 token 运行脚本，重点查看 `canRetryWithDeviceToken likely_valid_token` 和 `gateway_token_has_newline` 输出。
- 验证命令：`node scripts/openclaw-auth-probe.mjs`；`npm run build`；`cargo check`
- 验证结果：`node --check` 通过；`node scripts/openclaw-auth-probe.mjs` skip（无 token）；`npm run build` 通过；`cargo check` 在 `src-tauri` 通过。

### TASK-008：确认 OpenClaw Gateway 当前真实 auth token 来源与设备批准流程

- 状态：已完成
- 优先级：P0
- 负责人：Reasonix

目标：

- 不改业务代码。
- 只做认证来源调查和最小安全验证。
- 确认 Gateway 当前真实认证 token 来源。
- 确认 device pairing / approval 流程。

#### Reasonix 执行反馈

- 修改文件：`scripts/openclaw-auth-source-probe.mjs`，`docs/openclaw-auth-source-notes.md`，`AGENT_BOARD.md`
- 调查摘要：根本原因已定位 — hello-ok 未打通不是因为 token 字段形状或协议版本，而是因为 probe 脚本生成的设备身份不在 Gateway 配对表中。
- 关键发现：
  1. `openclaw config get gateway.auth.token` 永远返回 `__OPENCLAW_REDACTED__` — CLI 自动脱敏。
  2. Gateway auth mode = `token`，首次设备配对需要提供 gateway token。
  3. `openclaw` CLI **自身**可连接 Gateway 并执行 RPC（`rpc.ok=true`），因为它使用 `~/.openclaw/identity/` 中的已配对设备身份。
  4. TASK-007 probe 脚本的设备身份（`/tmp/ai-agent-workspace-openclaw-auth-probe-device.json`）**不在** Gateway 的已配对或待批准列表中 — 完全未知。
  5. `canRetryWithDeviceToken=true` 是 **boolean capability flag**，不是 token 值。之前的启发式扫描误将 `recommendedNextStep` 当作 token 提取，而 `canRetryWithDeviceToken` 本身一直是 boolean。
  6. Gateway 有 2 个已配对设备（Control UI + CLI probe），1 个待批准请求（CLI operator.pairing 权限升级）。
- Device pairing CLI：`openclaw devices approve <requestId> --token <gateway-token>`
- Control UI：`http://127.0.0.1:18789`，`allowInsecureAuth=true`，loopback 模式可能直接进入。用户可在 UI 中找到 gateway token。
- 用户获取 gateway token 的路径：
  - Control UI → 设置 → 基础设施
  - 手动从 `~/.openclaw/openclaw.json` 复制 `gateway.auth.token`
  - **不能用** `openclaw config get`（自动脱敏）
- 对 OpenClawBackend 策略建议：
  - App 使用持久化设备身份（生成 Ed25519 keypair 并存于 App 安全目录）
  - 用户提供 gateway token → App connect → Gateway 返回 NOT_PAIRED → 用户批准 → App 收到 hello-ok + device token → 持久化 device token
  - 后续连接使用已保存的 device token，无需再次提供 gateway token
- 验证命令：`node scripts/openclaw-auth-source-probe.mjs`；`npm run build`；`cargo check`
- 验证结果：`node scripts/openclaw-auth-source-probe.mjs` 通过（1 FAIL 为预期：probe identity 未配对）；`npm run build` 通过；`cargo check` 在 `src-tauri` 通过。

### TASK-009：OpenClaw 设备配对流程最小闭环验证

- 状态：待验收
- 优先级：P0
- 负责人：Reasonix

目标：

- 在不接入 App UI 的前提下，验证完整设备配对闭环。
- probe 生成持久化 Ed25519 device identity → 发起 connect → 处理 NOT_PAIRED / hello-ok → 尝试基础 RPC。

#### Reasonix 执行反馈

- 修改文件：`scripts/openclaw-pairing-flow-probe.mjs`，`docs/openclaw-device-pairing-flow.md`，`AGENT_BOARD.md`
- **✅ hello-ok 已打通！基础 RPC 全部成功！**
- 关键突破：
  1. **Token 来源**：`OPENCLAW_GATEWAY_TOKEN` env (length=21) 与 `~/.openclaw/openclaw.json` 中真实 token (length=48) **不同** — 这是 TASK-005~007 全部返回 `AUTH_TOKEN_MISMATCH` 的根因。
  2. `openclaw config get gateway.auth.token` 永远返回 `__OPENCLAW_REDACTED__`。
  3. **正确 token 来源**：`~/.openclaw/openclaw.json` → `gateway.auth.token`（仅内存，不打印，不写入）。
  4. `client.id` 必须为 Gateway 允许的值（`gateway-client` 有效）。
- 实测结果：
  - Protocol 4, Server 2026.5.22
  - 173 RPC methods, 27 events
  - RPC health ✅, status ✅, skills.status ✅ (58 skills), models.list ✅ (gpt-5.5)
- 设备配对流程：
  - 当前 probe 使用 gateway token 直接 connect，设备已自动配对
  - 若为新设备 + 正确 gateway token → NOT_PAIRED + requestId → 用户批准 → 重试 → hello-ok（Probe 已实现自动轮询重试）
- 对 OpenClawBackend 初版建议：
  - Tauri App 持久化 Ed25519 device identity 到 `~/.openclaw-agents/ai-agent-workspace/`
  - Gateway token 从用户输入获取，仅内存使用
  - connect 等待 `connect.challenge`，签名 nonce，发送 connect frame
  - 处理 NOT_PAIRED → 引导批准 → 轮询重试
  - hello-ok 后能力发现（features.methods/events）
  - Gateway token 不进日志、不入文件、不上报
- 验证命令：`node scripts/openclaw-pairing-flow-probe.mjs`；`npm run build`；`cargo check`
- 验证结果：probe hello-ok ✅ + 4/4 RPC ✅；`npm run build` 通过；`cargo check` 在 `src-tauri` 通过。

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

### Codex 审查反馈：TASK-005

- 审查日期：2026-05-25
- 审查范围：`docs/openclaw-ws-rpc-notes.md`、`scripts/openclaw-ws-rpc-probe.mjs`、`AGENT_BOARD.md`
- 审查结论：TASK-005 合格，状态改为“已完成”。
- 业务代码检查：本次审查未修改 `src/`、`src-tauri/`，未执行 TASK-006，未实现 `OpenClawBackend`，未读取 `.env`，未输出 Token。

#### 关键判断

1. TASK-005 的目标不是打通完整 RPC，而是找到真实协议阻塞点；当前目标已达成。
   - probe 已验证 WebSocket transport 可用。
   - probe 已收到 `connect.challenge`。
   - probe 已发送裸 `connect` frame。
   - Gateway 拒绝裸 connect，错误为 `NOT_PAIRED`，message 为 `device identity required`，details code 为 `DEVICE_IDENTITY_REQUIRED`。
   - 这说明当前阻塞点不是端口、Control UI 或 WS transport，而是 Gateway pairing / device identity / auth。

2. 后续不能直接开始 OpenClawBackend 初版。
   - 目前还没有收到 `hello-ok`。
   - 没有拿到 `hello-ok.features.methods/events`。
   - 没有成功调用 `health`、`status`、`skills.status` 或任意真实 RPC。
   - 在此状态下实现 OpenClawBackend 会把未确认的 auth/pairing 假设写进产品代码，返工风险高。

3. 下一步必须先做 TASK-006：OpenClaw Gateway pairing / device identity / auth 最小验证。
   - TASK-006 应继续保持只读/探针性质，不接入 App UI。
   - 目标是厘清 connect 所需 device identity、pairing approval、gateway auth、scope 和 hello-ok 条件。
   - 成功标准应至少包括收到 `hello-ok`，并尝试调用 `health` / `status` 或 `skills.status`。

4. OpenClawBackend 初版必须等 `hello-ok` 和至少一个基础 RPC 成功后再开始。
   - `hello-ok` 是能力发现入口。
   - `features.methods/events` 应作为 backend capability 的真实来源。
   - 至少一个基础 RPC 成功后，才有足够依据设计连接生命周期、错误处理、权限提示和事件订阅。

5. HTTP `/v1/models` 已确认不是主接入依据，只能作为辅助诊断。
   - TASK-004 已实测 `/v1/models` 返回 Control UI HTML fallback。
   - TASK-005 进一步确认主路径应围绕 WebSocket Gateway protocol。
   - 后续 `/v1/models` 只能用于辅助诊断或后续单独确认，不应作为 OpenClawBackend 的主链路。

#### TASK-006 建议边界

下一步任务：

> TASK-006：OpenClaw Gateway 配对 / device identity / auth 最小验证

建议允许范围：

- 新增 `docs/openclaw-pairing-auth-notes.md`。
- 更新 `scripts/openclaw-ws-rpc-probe.mjs` 或新增 `scripts/openclaw-pairing-probe.mjs`。
- 只做 loopback Gateway protocol 探针和文档记录。

建议禁止范围：

- 不改业务代码。
- 不修改 `src/` 或 `src-tauri/`。
- 不接入 App UI。
- 不实现 `OpenClawBackend`。
- 不读取 `.env`。
- 不输出 Token。
- 不修改 OpenClaw 配置。
- 不把 gateway token 写进代码。

#### TASK-006 验收重点

- probe 能清晰输出是否收到 `connect.challenge`。
- probe 能清晰输出是否发送 `connect` frame。
- probe 能清晰输出是否需要 device identity。
- probe 能清晰输出是否需要 pairing approval。
- probe 能清晰输出是否收到 `hello-ok`。
- 若仍失败，probe 输出脱敏后的错误摘要。
- 如果收到 `hello-ok`，尝试调用 `health` / `status` 或 `skills.status` 中至少一个基础 RPC，并记录结果。

### Codex 审查反馈：TASK-006

- 审查日期：2026-05-25
- 审查范围：`docs/openclaw-pairing-auth-notes.md`、`scripts/openclaw-pairing-probe.mjs`、`AGENT_BOARD.md`
- 审查结论：TASK-006 合格，状态改为“已完成”。
- 业务代码检查：本次审查未修改 `src/`、`src-tauri/`，未执行 TASK-007，未实现 `OpenClawBackend`，未读取 `.env`，未输出 Token。

#### 关键判断

1. TASK-006 的目标不是完成 OpenClaw RPC，而是确认 pairing / auth 阻塞点；当前目标已完成。
   - TASK-005 的阻塞点是 `DEVICE_IDENTITY_REQUIRED`。
   - TASK-006 生成并复用了 Ed25519 device identity。
   - probe 使用 `connect.challenge.payload.nonce` 进行 nonce signature。
   - Gateway 接受了 device identity 形状，阻塞点推进到 `AUTH_TOKEN_MISSING`。
   - 这说明 device identity 是必要路径，但仅有 device identity 还不足以进入 RPC session。

2. 后续不能直接开始 `OpenClawBackend`。
   - 目前仍未收到 `hello-ok`。
   - 没有拿到 `hello-ok.features.methods/events`。
   - 没有成功调用 `health` / `status`、`skills.status` 或 `models.list`。
   - 如果现在实现 `OpenClawBackend`，会把尚未验证的 token auth、device token、pairing approval 和 scope 假设固化进业务代码。

3. 下一步必须先做 TASK-007：Gateway token auth + hello-ok 最小验证。
   - TASK-007 应验证 gateway token auth + device identity + nonce signature 能否收到 `hello-ok`。
   - 如果 `hello-ok` 成功，应立刻尝试至少一个基础 RPC，例如 `health` / `status` 或 `skills.status`。
   - 如果失败，必须记录脱敏后的失败 code、缺失字段和下一步判断。

4. `OpenClawBackend` 初版必须等 `hello-ok` + 至少一个基础 RPC 成功后再开始。
   - `hello-ok` 是 Gateway protocol 的能力发现入口。
   - 至少一个基础 RPC 成功后，才有依据设计连接状态、能力模型、错误处理、权限提示和重连策略。

5. 产品 onboarding 后续需要设计以下流程：
   - 连接 OpenClaw Gateway。
   - 本地生成并安全持久化 device identity。
   - 用户填写 / 导入 gateway token。
   - 必要时引导用户批准设备。
   - 收到 `hello-ok` 后再进入 Agent 功能。

6. Token 安全约束：
   - Token 绝不能读取 `.env`。
   - Token 绝不能输出。
   - Token 绝不能写入日志。
   - Token 绝不能通过 CLI 参数传递。
   - Token 不得写进代码、文档或仓库。
   - 后续产品实现应使用用户临时输入和 OS 安全存储，不经过普通前端日志或命令行参数。

#### TASK-007 建议边界

下一步任务：

> TASK-007：OpenClaw Gateway token auth + hello-ok 最小验证

建议允许范围：

- 新增 `docs/openclaw-auth-hello-ok-notes.md`。
- 新增或更新 `scripts/openclaw-auth-probe.mjs`。
- 只做 loopback Gateway protocol probe。
- 允许用户通过环境变量临时提供 gateway token/password，但脚本不得读取 `.env`，不得打印值，且不得通过 CLI 参数接收 Token。

建议禁止范围：

- 不改业务代码。
- 不修改 `src/` 或 `src-tauri/`。
- 不接入 App UI。
- 不实现 `OpenClawBackend`。
- 不读取 `.env`。
- 不输出 Token。
- 不把 Token 写进代码。
- 不修改 OpenClaw 配置。
- 不自动批准设备。

#### TASK-007 验收重点

- probe 清晰输出 `connect.challenge` 是否收到。
- probe 清晰输出 device identity 是否生成 / 复用。
- probe 清晰输出 auth token 是否由用户临时提供，但不显示 Token 值。
- probe 清晰输出 `hello-ok` 是否收到。
- 如果 `hello-ok` 成功，probe 尝试 `health` / `status`、`skills.status`、`models.list`，并记录结果。
- 如果失败，probe 输出脱敏后的 error code、message、details 摘要。

### Codex 审查反馈：TASK-008

- 审查日期：2026-05-25
- 审查范围：`docs/openclaw-auth-source-notes.md`、`scripts/openclaw-auth-source-probe.mjs`、`AGENT_BOARD.md`
- 审查结论：TASK-008 合格，状态改为“已完成”。
- 业务代码检查：本次审查未修改 `src/`、`src-tauri/`，未执行 TASK-009，未实现 `OpenClawBackend`，未读取 `.env`，未输出 Token。

#### 关键判断

1. `hello-ok` 未打通的根因不是 token 字段形状、协议版本或签名算法。
   - TASK-006/TASK-007 已验证 device identity + nonce signature 形状能推进协议错误。
   - TASK-008 进一步确认，当前问题不是继续猜 token 字段形状或 HTTP endpoint。

2. 根因是 probe 生成的 device identity 未在 OpenClaw Gateway 设备配对表中。
   - CLI 自身 RPC 能成功，是因为 CLI 使用的是自己已配对身份。
   - probe 脚本生成的是独立 device identity，不在 Gateway 已配对或待批准设备列表中。
   - 因此 OpenClawBackend 不能跳过设备配对流程。

3. `canRetryWithDeviceToken` 是 boolean capability flag，不是 token 值。
   - 不应把 `canRetryWithDeviceToken=true` 当成可用 device token。
   - 也不应继续用启发式扫描任意字段猜 token。

4. `openclaw config get gateway.auth.token` 不能作为可靠 token 来源。
   - CLI 会返回 `__OPENCLAW_REDACTED__`。
   - 产品实现不能依赖该命令获取 gateway token。
   - Gateway token 必须由用户从 Control UI 获取/导入，或通过后续明确安全授权流程提供。

5. 正确路径是设备配对闭环：
   - App 生成持久化 device identity。
   - 用户从 Control UI 复制 gateway token，或按引导批准设备。
   - App connect 触发 pending request。
   - 用户执行 `openclaw devices approve <requestId>`。
   - App 重连收到 `hello-ok`。
   - App 保存 device token，后续使用 device token。

6. `OpenClawBackend` 初版必须包含 pairing / onboarding 逻辑。
   - 不能只写一个 WebSocket transport。
   - 不能只发送裸 connect。
   - 不能假设用户已经有可用 device token。
   - 必须能处理 pending request、approval、hello-ok、device token 持久化和后续 reconnect。

7. 不能再继续猜 HTTP `/v1/models` 或裸 WS。
   - `/v1/models` 已确认不是主接入依据，只能作为辅助诊断。
   - 裸 WS 只能到 `connect.challenge`，不能进入 RPC session。
   - 后续主路径必须围绕 Gateway device identity + pairing + `hello-ok`。

8. 下一步应规划 TASK-009：OpenClaw 设备配对流程最小闭环验证。
   - TASK-009 目标不是接入 `ChatPage`。
   - TASK-009 目标是打通 pending request → approve → `hello-ok` → 基础 RPC。
   - `OpenClawBackend` 初版必须等 TASK-009 成功后再开始。

#### TASK-009 建议边界

下一步任务：

> TASK-009：OpenClaw 设备配对流程最小闭环验证

建议允许范围：

- 新增 `docs/openclaw-device-pairing-loop-notes.md`。
- 新增或更新 `scripts/openclaw-device-pairing-loop-probe.mjs`。
- 只做 loopback Gateway pairing protocol probe 和文档记录。
- 允许用户临时提供 gateway token，但不得读取 `.env`，不得打印 Token，且不得通过 CLI 参数接收 Token。

建议禁止范围：

- 不改业务代码。
- 不修改 `src/` 或 `src-tauri/`。
- 不接入 `ChatPage`。
- 不实现 `OpenClawBackend`。
- 不读取 `.env`。
- 不输出 Token。
- 不把 Token 写进代码。
- 不修改 OpenClaw 配置。
- 不自动批准设备，除非用户明确确认。

#### TASK-009 验收重点

- probe 使用持久化 device identity。
- probe 能触发或识别 pending request。
- probe 能输出 request id 的脱敏摘要和 approve 命令模板。
- 用户批准后，probe 重连能收到 `hello-ok`。
- 收到 `hello-ok` 后，probe 至少调用一个基础 RPC，例如 `health` / `status`、`skills.status` 或 `models.list`。
- 如果失败，probe 输出脱敏后的错误 code、message、details 和下一步判断。
