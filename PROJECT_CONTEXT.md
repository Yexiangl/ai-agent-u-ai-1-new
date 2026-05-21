# PROJECT_CONTEXT

## 产品定位
AI Agent 工作台（U盘交付版桌面应用），面向个人用户提供本地 Hermes Agent 对话助手。
Tauri + React + TypeScript + Vite + Tailwind CSS，最终交付为 macOS / Windows 可执行文件。

## 商业模式
- U盘硬件交付，赠送初始模型调用额度
- 额度用完后联系商家续费（售后 QQ：858070120）
- 用户打开即用，无需安装 Node.js、Cargo、Docker

## 当前核心功能
- Hermes Agent 对话（SSE 流式 + 打字机效果 + 推理过程折叠 + 工具事件）
- Hermes 管理（检测安装状态、对话服务；合并模型供应配置：专属 Token + 模型选择 + 应用到 Hermes + 真实写入 config/.env）
- Skill Center（24 个官方模板技能启用/运行，14 个 HermesHub 技能预览）
- Hermes 记忆（只读查看原生记忆文件）
- 历史会话（多 session，搜索，重命名，置顶，删除，本地持久化）
- 定时任务（仅草稿保存，不执行）
- 使用情况（示例数据占位）
- 教程 & 关于页面
- Onboarding 引导（检测 Hermes → 配置 Token → 选择模型 → 应用到 Hermes → 进入工作台）

## 明确不做的功能
- 不支持 Hermes 以外的 Agent 引擎
- 不支持用户直接输入上游 API Key（只保存专属模型供应 Token）
- 不支持执行本地命令/修改系统文件的 Skill
- HermesHub 技能当前不执行真实安装（`hermes skills install`）
- 不修改 Hermes 原生记忆文件（当前只读）
- 定时任务当前不实际执行
- Windows 和 macOS 不可共用同一可执行文件

## Hermes 配置策略
- `~/.hermes/config.yaml` 由 Tauri Rust 后端通过 `hermes config set` 写入
- `apply_hermes_model_config` 写入前自动备份 `config.yaml` 和 `.env`
- `selectedEngine` 在 `mergeConfig` 中固定为 `"hermes"`
- Rust 后端强制模型白名单，不允许用户自定义：
  - `deepseek-v4-flash`
  - `deepseek-v4-pro`
  - `kimi-k2.6`
- Provider 映射（Rust 后端强制）：
  - `deepseek-v4-*` → `deepseek`
  - `kimi-k2.6` → `kimi-coding`
- baseUrl 固定为 `https://ai.f1class.icu/v1`，不允许用户修改
- Token 同时写入 `DEEPSEEK_API_KEY` 和 `KIMI_API_KEY`（便于切换模型）
- API 模式固定为 `chat_completions`
- 本地配置优先 Tauri invoke（`read_config`/`write_config`），fallback 到 localStorage

## 模型供应策略
- 固定 baseUrl：`https://ai.f1class.icu/v1`
- 可选模型：`deepseek-v4-flash`（快速）、`deepseek-v4-pro`（高质量）、`kimi-k2.6`（长文本）
- Provider 映射：deepseek-v4-* → deepseek，kimi-k2.6 → kimi-coding
- 模型供应 API 模式固定为 `chat_completions`
- App 不保存上游官方 API Key，只保存客户专属 Token

## 安全边界
- 专属 Token 本地明文保存（代码预留加密存储结构）
- 所有 Skill 为本地模板，不执行本地命令、不修改系统文件
- HermesHub 兼容技能不执行 `hermes skills install`，不修改 `~/.hermes`
- Hermes 记忆文件只读展示，不写入、不删除、不执行命令
- Hermes 对话服务位于 `http://127.0.0.1:8642/v1`；流式请求不应设置过短总超时
- 所有 Tauri 命令统一通过 `invoke` 调用，Rust 后端负责文件 I/O

## 当前主要页面
| 路由 ID | 页面 | 说明 |
|---------|------|------|
| home | 首页 | 状态概览、快捷入口、Token/Hermes 状态警告 |
| chat | Agent 对话 | Hermes SSE 流式对话、历史会话列表 |
| engines | Hermes 管理 | 状态检测、模型供应配置（Token + 模型选择）、应用到 Hermes、高级诊断（无独立"模型供应"页面，已合并） |
| skills | Skill Center | 官方模板/已启用/HermesHub 兼容三个 Tab |
| memory | Hermes 记忆 | 只读查看 Hermes 原生记忆文件 |
| tasks | 定时任务 | 草稿保存（不执行） |
| usage | 使用情况 | 示例数据占位 |
| tutorials | 教程 | 静态教程列表 |
| about | 关于 | 版本信息、使用步骤、重置配置 |

## Onboarding 流程
1. 检测本机 Hermes 安装状态和对话服务
2. 填写专属模型供应 Token（支持可见/隐藏切换）
3. 选择 Hermes 使用模型（deepseek-v4-flash / deepseek-v4-pro / kimi-k2.6）
4. 测试 Token 连接（可选）或跳过直接进入
5. 进入工作台后可在 Hermes 管理页再次应用到 Hermes

## 开发注意事项
- 开发机器需要安装 Rust/Cargo 和系统 WebView 依赖
- `npm run dev` 启动 Tauri 开发窗口（Vite 端口 1420）
- 流式调试开关 `DEBUG_STREAM = false`（仅开发排查时启用）
- Tauri Rust 后端通过事件系统推送 `hermes-chat-chunk`、`hermes-tool-progress`、`hermes-chat-done`、`hermes-chat-error` 到前端
- 首屏加载时并发检测 Hermes CLI、API Server、模型配置
- `selectedEngine: "hermes"` 不可变更（全链路硬编码）
- 打包命令：`npm run tauri:build:mac` / `npm run tauri:build:windows`
