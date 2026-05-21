# DEV_LOG

## 已完成

### Tauri + React + Vite
- 项目从旧架构迁移至 Tauri 2.x + React 19 + TypeScript + Vite 7 + Tailwind CSS 3
- UI 组件库（Badge, Button, Card, ConfirmDialog, Input, Switch, Table, Textarea）基于 class-variance-authority + lucide-react + tailwind-merge
- Tauri Rust 后端负责 Hermes CLI 检测、配置读写、SSE 流式代理、原生记忆扫描

### Hermes-only
- `selectedEngine` 在 `config.ts:mergeConfig` 中固定为 `"hermes"`，全局不可变
- 前端不再保留任何非 Hermes 引擎分支

### Hermes 管理合并模型配置
- Hermes 管理页面统一管理：状态检测 + 模型供应 Token + 模型选择 + 应用到 Hermes
- `apply_hermes_model_config` Tauri 命令已真实写入成功，通过 `hermes config set` 执行
- 写入前自动备份 `~/.hermes/config.yaml` 和 `~/.hermes/.env`
- Token 同步写入 `DEEPSEEK_API_KEY` 和 `KIMI_API_KEY` 两个环境变量
- Rust 后端强制模型白名单和 provider 映射，不允许前端传入自定义值
- 支持"测试 Token""保存配置""应用到 Hermes""读取 Hermes 配置"四个操作
- 修复 Hermes CLI 路径检测：不再将 `~/.hermes/hermes-agent` 目录误识别为 CLI
- 现在优先使用 PATH / `~/.local/bin/hermes` 等真实可执行 Hermes CLI

### 专属模型供应 Token
- 用户使用专属 Token 调用模型服务，前/后端不保存上游 API Key
- Token 在设置页和 Onboarding 页支持可见/隐藏切换
- 本地明文保存，`storage.ts` 通过 Tauri invoke 持久化

### 固定 baseUrl
- `DEFAULT_BASE_URL = "https://ai.f1class.icu/v1"`（`config.ts`）
- Onboarding 和 Engines 页均显示该地址，不提供修改入口

### SSE 流式对话
- `hermesChatCompletion` 通过 Tauri invoke 调用 Rust 后端，后端以 SSE 连接 Hermes API Server
- Rust 后端通过事件推送到前端：`hermes-chat-chunk`（content/reasoning）、`hermes-tool-progress`、`hermes-chat-done`、`hermes-chat-error`、`hermes-stream-diagnostics`
- 前端打字机效果：`TypewriterState` 控制逐字渲染，支持快速跳过
- 推理过程（reasoning）折叠面板、工具事件列表
- 流式诊断面板（`DEBUG_STREAM` 开关控制）

### 历史会话
- 多 session 管理：新建、切换、重命名、置顶/取消置顶、删除、搜索
- 本地持久化：`writeChatSessions`/`readChatSessions`/`clearChatSessions` 通过 Tauri invoke
- session 元数据：title（从第一条用户消息提取）、updatedAt、totalTokens、lastMessagePreview、pinned
- 历史轮次限制：最多 20 条消息，总字符不超过 20000

### Hermes 原生记忆只读
- `readHermesNativeMemory` Tauri 命令扫描 `~/.hermes/memories/` 目录
- 文件列表 + 内容查看，按 kind 分类（memory/user/soul）
- 明确标注"只读"，不写入、不删除、不执行命令
- 业务记忆模板（业务介绍/价格表/回复风格等）标记为"后续版本开放"

### Skill Center 当前状态
- 官方模板 24 个（校园副业 9 + 通用办公 4 + 自媒体 4 + 学习资料 3 + 编程辅助 3，含 1 个预留）
- 官方技能可在对话中启用，通过"运行技能"生成 prompt 跳转到对话页
- HermesHub 兼容技能 14 个，仅预览展示，标记为"后续开放"
- 所有技能声明：不执行本地命令、不修改系统文件
- HermesHub 技能不执行 `hermes skills install`

### 其他
- 首页状态仪表板（Hermes 状态/当前模型/Token 状态/已启用 Skills）
- Onboarding 引导页：检测 Hermes 安装状态 → 填写专属 Token → 选择模型 → 直接复用 `applyHermesModelConfig` 写入 Hermes 配置 → 进入工作台
- 深色模式切换
- 定时任务页面（草稿保存）、使用情况页面（示例数据）、教程页面、关于页面

## 仍待完成
- [ ] 使用概况真实化：从 `chat-sessions.json` 统计 token，替换示例数据
- [ ] Hermes Cron 只读状态 / 输出记录 / 任务预览
- [ ] 后续再做真实 Cron 创建/暂停/恢复/删除
- [ ] 真实定时任务后台执行
- [ ] HermesHub 技能安装（安全安装流程）
- [ ] 业务记忆模板写入 Hermes 原生记忆
- [ ] Token 加密存储（当前明文）
- [ ] Windows 平台打包与测试
