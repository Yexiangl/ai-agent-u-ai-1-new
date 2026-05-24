# OpenClaw Backend 可行性调研报告

## 1. 结论摘要

OpenClaw 适合作为后续主 Agent 后端的候选，但建议按“先抽象、再接入、再替换主路径”的分阶段方式推进，不建议在 TASK-002 直接做不可回退的 OpenClaw-only 改造。

主要依据：

- OpenClaw 已明确提供本地 Gateway，默认端口 `18789`，支持本地进程、后台服务、Web Control UI、WebSocket RPC 和 OpenAI-compatible HTTP endpoints。
- OpenClaw 支持 macOS、Linux、Windows 原生和 WSL2；Windows 原生可用，但官方文档仍建议 WSL2 作为完整体验的稳定路径。
- OpenClaw 的主控制面不是 Hermes 风格的单一 SSE HTTP chat，而是 WebSocket RPC + 事件流；同时也提供 `/v1/chat/completions`、`/v1/responses` 等 OpenAI-compatible HTTP endpoints。
- OpenClaw 已有模型供应、Token/Auth、技能、会话、文件/媒体、使用量、记忆、定时任务、工具审批等能力，覆盖当前 Hermes 应用的大部分功能方向。
- Skill 体系与 ClawHub 较成熟，当前 Skill Center 可以迁移为“内置模板 + ClawHub/OpenClaw skills 管理”的组合形态。

推荐判断：OpenClaw 可以作为主后端方向，但 TASK-002 的 `AgentBackend` 不应照搬 Hermes SSE 形状，而应围绕“能力发现、会话、消息发送、事件订阅、取消、历史、模型、技能、健康状态”设计。

## 2. OpenClaw 安装与运行方式

公开文档确认的安装方式：

- 推荐安装脚本：macOS / Linux / WSL2 使用 `curl -fsSL https://openclaw.ai/install.sh | bash`。
- Windows PowerShell 安装脚本：`iwr -useb https://openclaw.ai/install.ps1 | iex`。
- npm 安装：`npm install -g openclaw@latest`。
- pnpm / bun 也可用于全局 CLI 安装；Gateway runtime 仍推荐 Node。
- npm 包名为 `openclaw`，CLI bin 为 `openclaw`。
- Node 要求：Node 24 推荐，Node 22.19+ 支持。

公开文档确认的运行方式：

- 前台运行：`openclaw gateway` 或 `openclaw gateway run`。
- 指定端口：`openclaw gateway --port 18789`。
- 调试运行：`openclaw gateway --port 18789 --verbose`。
- 服务安装：`openclaw onboard --install-daemon` 或 `openclaw gateway install`。
- 生命周期命令：`openclaw gateway status`、`openclaw gateway restart`、`openclaw gateway stop`。

对当前 Tauri App 的意义：

- 可以由 Tauri 检测 `openclaw` CLI 是否存在。
- 可以检测默认端口 `18789` 是否可达。
- 可以启动前台本地进程作为开发/兜底路径。
- 更适合引导用户安装 OpenClaw 自带服务，而不是由 Tauri 长期托管 Gateway 子进程。

## 3. OpenClaw Gateway / 本地 API

Gateway 是 OpenClaw 的本地控制面，默认端口 `18789`，默认 bind 为 `loopback`。端口优先级为 `--port`、`OPENCLAW_GATEWAY_PORT`、`gateway.port`、`18789`。

公开文档确认同一端口承载：

- WebSocket control/RPC。
- HTTP APIs：`/v1/models`、`/v1/embeddings`、`/v1/chat/completions`、`/v1/responses`、`/tools/invoke`。
- Control UI。
- hooks。
- plugin HTTP routes。

Gateway 协议要点：

- WebSocket 文本帧，JSON payload。
- 第一个 client frame 必须是 `connect`。
- Gateway 会先发 `connect.challenge`。
- client 发送 `connect` 请求，包含 protocol range、client info、role、scopes、auth、device identity 等。
- 响应 `hello-ok`，包含 protocol、server version、feature methods/events、snapshot、auth、policy。
- 当前文档描述 protocol v4。

常用 RPC family：

- 健康与状态：`health`、`status`、`system-presence`。
- 对话：`chat.history`、`chat.send`、`chat.abort`、`chat.inject`。
- 会话：`sessions.list`、`sessions.create`、`sessions.send`、`sessions.abort`、`sessions.patch`、`sessions.reset`、`sessions.delete`、`sessions.compact`。
- 模型与用量：`models.list`、`usage.status`、`usage.cost`、`sessions.usage`。
- 技能：`skills.status`、`skills.search`、`skills.detail`、`skills.install`、`skills.update`。
- 配置：`config.get`、`config.patch`、`config.apply`、`config.schema.lookup`。
- 工具：`tools.catalog`、`tools.effective`、`tools.invoke`。

HTTP OpenAI-compatible endpoint 的意义：

- 若只需要基础 chat，可以评估 `/v1/chat/completions` 或 `/v1/responses`。
- 若要完整复用 OpenClaw 的会话、技能、工具事件、取消、历史、模型 picker、用量等能力，更建议使用 Gateway WebSocket RPC。

## 4. 对话与流式输出能力

OpenClaw 支持流式输出，但流式形态与 Hermes SSE 不同。

WebSocket RPC 形态：

- `chat.send` 是非阻塞调用，立即返回 `{ runId, status: "started" }`。
- 回复通过 `chat` event、`agent` event、`session.message`、`session.operation`、`session.tool` 等事件推送。
- `chat` delta payload 在 protocol v4 中包含 `deltaText`，`message` 保留累计 assistant snapshot。
- 工具调用和工具输出会以 live tool output cards / agent events 的方式推送给 Control UI。
- 事件不可重放；client 发现 sequence gap 后需要刷新 `health`、presence 或 history 等状态。

HTTP OpenAI-compatible 形态：

- 文档确认 `/v1/chat/completions` 与 `/v1/responses` 存在。
- 调研未验证这些 endpoint 的具体 SSE chunk schema、取消语义、工具事件映射和历史落库行为。
- 因此不建议 TASK-002 只按 OpenAI SSE 设计接口，否则会损失 OpenClaw 的 session/tool/event 能力。

停止生成：

- Control UI 使用 `chat.abort`。
- `chat.abort` 支持只传 `{ sessionKey }` 来 abort 当前 session 的所有 active runs。
- session 层还有 `sessions.abort`，可按 session key 或 runId abort。
- CLI `openclaw agent` 在 SIGTERM/SIGINT 时，如果 Gateway 已接受 run，会发送 `chat.abort`。

## 5. 模型供应与 Token 配置

OpenClaw 支持多 provider / model refs，模型引用通常为 `provider/model`。公开文档确认：

- onboarding 可选择常见 provider/auth flow，包括 API key、OAuth、自定义 provider。
- `agents.defaults.model.primary` 设置默认模型。
- `agents.defaults.model.fallbacks` 设置 fallback。
- `agents.defaults.models` 可作为模型 allowlist/catalog。
- `models.providers` 支持自定义 provider。
- 自定义 provider 支持 `baseUrl`、`apiKey`、`api`、`models`。
- `api` 支持 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai` 等。
- 对 OpenAI-compatible `/v1/chat/completions` 后端，使用 `api: "openai-completions"`；custom provider 有 `baseUrl` 但无 `api` 时默认 `openai-completions`。

Token / Secret 配置：

- Gateway auth 支持 `gateway.auth.token`、`gateway.auth.password`、`OPENCLAW_GATEWAY_TOKEN`、`OPENCLAW_GATEWAY_PASSWORD`。
- provider key 可以写在 `models.providers.*.apiKey`，也支持 env substitution `${VAR}` 和 SecretRef。
- OpenClaw 会读取 process env、当前工作目录 `.env`、`~/.openclaw/.env`、config `env` block 等，但本次调研没有读取项目 `.env`。
- onboarding 支持 secret reference mode，例如 env-backed refs。

对当前产品约束的适配：

- 可以固定我们的中转站 Base URL 到由应用写入的 OpenClaw config，不在普通 UI 暴露 Base URL。
- 普通用户 UI 可以只收 Token，由 Tauri 写入或引导写入 OpenClaw provider `apiKey` / SecretRef。
- 需要避免把 Token 放入 CLI 参数；优先使用 SecretRef、环境变量、受控 config 写入或 OpenClaw 自身 onboarding。
- 需要明确普通 UI 不开放 custom Base URL；custom provider 能力只作为内部实现或高级诊断能力。

## 6. Skill 体系与 Skill Center 迁移

OpenClaw 使用 AgentSkills-compatible skill folders：每个 skill 是一个包含 `SKILL.md` 的目录，`SKILL.md` 包含 YAML frontmatter 和 instructions。

加载来源和优先级：

1. workspace skills：`<workspace>/skills`。
2. project agent skills：`<workspace>/.agents/skills`。
3. personal agent skills：`~/.agents/skills`。
4. managed/local skills：`~/.openclaw/skills`。
5. bundled skills。
6. config `skills.load.extraDirs`。

Skill 能力：

- 支持 per-agent allowlist。
- 支持 bundled / managed / workspace skills。
- 支持 plugin 自带 skills。
- 支持 `metadata.openclaw.requires` 对 env、binary、config、OS 做加载 gating。
- 支持 `skills.entries.*.enabled`、`apiKey`、`env`、`config` 等配置。
- 支持技能 watcher 和 snapshot refresh。
- 支持 `openclaw skills search/install/update`。

ClawHub：

- ClawHub 是 OpenClaw public skill registry。
- skill 为 `SKILL.md` + supporting files 的 versioned text bundle。
- OpenClaw 原生命令可搜索、安装、更新 skills：`openclaw skills search`、`openclaw skills install <slug>`、`openclaw skills update --all`。
- ClawHub 还承载 code plugins、bundle plugins、souls。
- ClawHub CLI 用于 registry auth、publish、sync、delete/undelete。

Skill Center 迁移建议：

- 短期保留当前官方模板作为“内置模板”。
- 新增 OpenClaw skills inventory，读取 `skills.status`。
- 后续接入 `skills.search` / `skills.detail` 展示 ClawHub 技能详情。
- 安装操作走 `skills.install` 或 `openclaw skills install`，不要自行解压第三方 skill。
- Token/API key 类技能配置走 `skills.entries.*.apiKey` 或 SecretRef，不在提示词和日志中暴露。

## 7. 与当前项目功能适配分析

| 当前功能 | OpenClaw 适配判断 | 备注 |
| --- | --- | --- |
| Agent 对话 | 可适配 | 首选 `chat.send` + WS events；也可评估 `/v1/chat/completions` 基础路径。 |
| 停止生成 | 可适配 | `chat.abort` / `sessions.abort`。 |
| 历史会话 | 可适配 | `chat.history`、`sessions.list`、`sessions.preview`、`sessions.get`。 |
| 文件分析 | 部分可适配 | OpenClaw chat uploads 支持 images 和 non-video files；media/tool 能力更强，但具体与现有附件抽取缓存的边界需 TASK-005 验证。 |
| Skill Center | 可适配 | `skills.status/search/detail/install/update` + ClawHub。 |
| AI 文件库 | 部分可适配 | OpenClaw 有 managed media、artifacts API；当前本地 AI 文件库仍应保留为产品资产。 |
| 使用概况 | 可适配 | `usage.status`、`usage.cost`、`sessions.usage`。 |
| 记忆 | 可适配但需谨慎 | 有 memory / `doctor.memory.status` 等能力；与 Hermes memory 的数据模型不同。 |
| 定时任务 | 可适配 | `cron.*` 能力存在；但当前任务要求不恢复 Hermes Cron 方向。 |
| Onboarding | 可适配 | OpenClaw onboarding 比 Hermes 复杂，普通用户 UI 应包装为“初始化 Agent 引擎”。 |
| Token 配置 | 可适配 | 可固定 provider/baseUrl，仅暴露 Token。 |
| Windows 客户体验 | 可适配但有风险 | 原生 Windows 支持仍有 caveats，WSL2 推荐会增加普通客户门槛。 |

## 8. Windows 普通客户友好度

公开文档确认：

- OpenClaw 支持 native Windows 和 WSL2。
- WSL2 是更稳定路径，推荐用于完整体验。
- native Windows 当前适合 core CLI 和 Gateway 使用。
- Windows 安装脚本为 PowerShell `install.ps1`。
- native Windows managed startup 优先 Scheduled Task，失败后 fallback 到 per-user Startup-folder login item，并立即启动 Gateway。
- Windows companion app 尚未提供。

对普通客户的风险：

- 若要求用户理解 WSL2，会显著增加 onboarding 成本。
- native Windows 虽可用，但文档仍标记 caveats，不适合作为“完全无风险”的唯一默认假设。
- Node runtime、全局 CLI、Windows 防火墙、端口占用、Scheduled Task 权限都可能成为客服问题。

建议：

- 产品层默认走 native Windows 安装与检测，只有遇到兼容性问题时提示 WSL2 作为高级修复路径。
- 不在普通 onboarding 里要求用户配置 WSL2。
- TASK-005 前应做 Windows smoke test：安装、gateway status、dashboard、chat.send、chat.abort、skills.status。

## 9. 推荐架构

推荐架构：Tauri App 作为产品 UI 和本地编排层，OpenClaw Gateway 作为 Agent runtime。

建议分层：

- `AgentBackend`：面向 UI 的稳定接口，不暴露 Hermes/OpenClaw 细节。
- `HermesBackend`：迁移期包装当前能力，保持现有行为。
- `OpenClawBackend`：通过 Gateway WS RPC 实现主要能力。
- `OpenClawProcessManager`：检测安装、检测服务、启动/停止/打开 dashboard，仅处理生命周期，不处理对话业务。
- `OpenClawConfigWriter`：内部写入固定 provider/baseUrl/token/model/skills 配置，普通 UI 不暴露 baseUrl。

TASK-002 的 `AgentBackend` 建议能力：

- `getStatus()`：安装状态、Gateway reachable、auth 状态、版本、健康摘要。
- `listSessions()` / `getSessionHistory(sessionId)`：会话列表与历史。
- `createSession()` / `resetSession()` / `deleteSession()`：会话管理。
- `sendMessage({ sessionId, content, attachments, model?, skillContext? })`：非阻塞发送，返回 run id。
- `subscribeEvents(sessionId, handler)`：统一接收 text delta、message snapshot、tool event、usage、done、error。
- `abort({ sessionId, runId? })`：停止生成。
- `listModels()` / `setSessionModel()`：模型 picker 与 session override。
- `getUsage()`：使用概况。
- `listSkills()` / `installSkill()` / `updateSkill()` / `configureSkill()`：Skill Center 对接。
- `getCapabilities()`：声明 backend 是否支持 streaming、abort、attachments、skills、usage、memory、cron、tools。

不建议接口形状：

- 不要只抽象成 `POST chat + SSE stream`。
- 不要把 Base URL/provider 暴露为普通用户配置。
- 不要把 OpenClaw Gateway Token 或 provider Token 放入前端可见日志或命令参数。

## 10. 分阶段迁移路线

Phase 1：Agent Backend 抽象

- 引入 `AgentBackend`，保持 UI 行为不变。
- Hermes 作为 legacy backend 包装。
- 接口为 OpenClaw WS event 预留，不绑定 Hermes SSE。

Phase 2：OpenClaw 检测与健康

- 检测 `openclaw --version`。
- 检测 `ws://127.0.0.1:18789` 或 `/healthz`、`/readyz`。
- 支持 `openclaw gateway status --json` 诊断。
- 不读取 `.env`，不输出 Token。

Phase 3：OpenClaw Chat 初版

- 使用 WS `connect` + `chat.send` + `chat`/`session.*` events。
- 实现 `chat.abort`。
- 读取 `chat.history` 合并现有 UI。

Phase 4：模型与 Token 固定化

- 写入固定 provider/baseUrl config。
- 普通 UI 只让用户填写 Token。
- 使用 SecretRef/env-backed ref 优先，避免 CLI 参数泄露。

Phase 5：Skill Center 迁移

- 展示 `skills.status`。
- 接入 `skills.search/detail/install/update`。
- 保留当前官方模板作为内置模板。

Phase 6：Hermes 弱化/隐藏

- 普通 UI 默认 OpenClaw。
- Hermes 保留为高级/开发者或迁移期 fallback backend，但不继续扩展 Hermes-only 功能。

## 11. 风险清单

- Windows 原生稳定性风险：官方支持 native Windows，但仍推荐 WSL2 完整体验。
- 协议复杂度风险：OpenClaw 主路径是 WS RPC + device/auth/pairing/scope，不是简单 HTTP SSE。
- Auth/Token 风险：Gateway auth、device token、provider API key、SecretRef 同时存在，产品层必须避免泄露和错误持久化。
- 配置写入风险：OpenClaw config 严格校验，错误 config 会导致 Gateway 拒绝启动。
- 事件语义风险：events 不重放，client 要能在 gap/disconnect 后刷新 history/status。
- OpenAI-compatible endpoint 能力边界风险：虽有 `/v1/chat/completions` 和 `/v1/responses`，但对工具事件、取消、历史、Skill Center 的适配不如 WS RPC 完整。
- Skill 安全风险：第三方 skills 属于不可信内容，应使用 OpenClaw 自带扫描、安装、sandbox/allowlist，不应自行安装执行。
- 用户体验风险：OpenClaw 面向开发者/高级用户的配置很多，需要产品 UI 做强约束和简化。

## 12. 下一步建议

TASK-002 可以开始，但应以本报告为边界：

- 先设计 backend capability model，而不是直接实现 OpenClaw。
- `AgentBackend` 必须支持 event subscription 和 abort，不要只支持 SSE。
- 保留附件、历史、AI 文件库、Skill Center 等现有 UI 资产。
- OpenClaw 具体接入放到 TASK-005，先做最小 chat/status/abort/history smoke。
- Windows native 必须在 TASK-005 单独验收，不把 WSL2 作为普通客户默认路径。
- 所有 Token/Base URL 配置保持内部化，普通 UI 只暴露 Token。

参考公开资料：

- OpenClaw docs: https://docs.openclaw.ai
- Getting started: https://docs.openclaw.ai/start/getting-started
- Gateway runbook: https://docs.openclaw.ai/gateway
- Gateway protocol: https://docs.openclaw.ai/gateway/protocol
- Control UI: https://docs.openclaw.ai/web/control-ui
- Configuration: https://docs.openclaw.ai/gateway/configuration
- Models CLI: https://docs.openclaw.ai/concepts/models
- Skills: https://docs.openclaw.ai/tools/skills
- Windows: https://docs.openclaw.ai/platforms/windows
- ClawHub: https://docs.openclaw.ai/clawhub
