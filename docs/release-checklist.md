# AI Agent Workspace 发布前验收清单 (OpenClaw RC)

> 用于每次打包或给客户试用前逐项测试。完成后请勾选对应条目。

## 1. 基础启动

- [ ] `npm run build` 通过
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过
- [ ] `node scripts/openclaw-http-api-probe.mjs` 通过 (/v1/models + /v1/chat/completions)
- [ ] `npm run dev` 可启动
- [ ] 首次启动不白屏
- [ ] App 关闭后重新打开正常
- [ ] 深色/浅色模式切换正常

## 2. Onboarding (OpenClaw 初始化)

- [ ] Onboarding 标题为 "初始化 OpenClaw Agent"
- [ ] 不显示 Hermes 文案
- [ ] 环境检测：配置文件 / Gateway / HTTP 对话接口 / Gateway Token 状态逐项显示
- [ ] OpenClaw CLI 未安装时显示安装命令（curl / iwr）
- [ ] Gateway 未运行时显示重启命令（openclaw gateway restart）
- [ ] HTTP 对话接口未启用时显示启用命令（config set）
- [ ] Token 输入框为密码框，可切换显示/隐藏
- [ ] 速度优先 / 质量优先档位可选
- [ ] 点击"应用到 OpenClaw 配置"后成功反馈，清空 Token 输入
- [ ] 成功提示包含 "openclaw gateway restart" 命令
- [ ] 验证 HTTP 对话接口按钮可用，显示模型列表
- [ ] "进入工作台"按钮正常，可选"稍后配置"跳过
- [ ] Onboarding 完成后配置持久化 (hasCompletedOnboarding=true)
- [ ] Token 不写入 AppConfig.apiKey / localStorage / sessionStorage
- [ ] 不显示 baseUrl / provider / API URL

## 3. AI 助手页

- [ ] 标题为 "AI 助手"
- [ ] 普通视图：AI 助手状态 + 当前模型 + 重新检查 + 模型配置 + 保存配置
- [ ] 普通视图不出现 Gateway / HTTP 主链路 / OpenClaw config / provider / baseUrl / API URL
- [ ] 状态检测显示：配置文件 / 本地服务 / 对话接口 / 对话状态
- [ ] 可用模型列表显示 openclaw, openclaw/default, openclaw/main
- [ ] 默认模型显示 openclaw/default
- [ ] 模型配置：密钥输入 + 速度优先/质量优先档位
- [ ] 密钥输入说明用户化，placeholder 为"请输入密钥"
- [ ] "保存配置"按钮正常，显示成功/失败反馈
- [ ] 保存成功后提示可能需要重启本地服务
- [ ] 不显示 "保存 Token 到本地" 按钮
- [ ] 不显示 baseUrl / provider / API URL / Token 明文
- [ ] 高级诊断按钮为小字链接，默认隐藏技术信息
- [ ] 高级诊断弹窗显示 Gateway / 配置文件 / Legacy 引擎状态（不显示 Token/API URL）

## 4. AI 对话 (OpenClaw HTTP-first)

- [ ] 对话页默认使用 OpenClaw HTTP-first
- [ ] 输入框 placeholder: "向 AI Agent 发送消息..."
- [ ] 发送 "你好，简单回复一句" 可正常回复
- [ ] 回复气泡底部显示 "OpenClaw Agent" / "openclaw/default"
- [ ] 不显示 "Hermes Agent" / "hermes-agent"
- [ ] 生成完成后可以继续下一轮对话
- [ ] 连续两轮对话不覆盖、不重复
- [ ] 停止生成按钮正常
- [ ] 回到底部按钮正常
- [ ] 中文输入法 Enter 选字不误发送
- [ ] Shift + Enter 换行正常
- [ ] Markdown / 代码块显示正常
- [ ] 推理过程（如有 reasoning_content）折叠面板正常

## 5. 历史会话持久化

- [ ] 发送消息后切页面（如 Home → Chat），回复不丢失
- [ ] 刷新 / 重启 App 后历史会话可恢复
- [ ] 新建会话默认模型为 openclaw/default
- [ ] 切换会话正常
- [ ] 重命名正常
- [ ] 删除会话有确认弹窗
- [ ] 置顶/取消置顶正常
- [ ] 搜索正常
- [ ] `chat-sessions.json` 损坏时可从 `bak.1` 恢复
- [ ] 备份文件 `bak.1` / `bak.2` / `bak.3` 存在
- [ ] 历史不保存 provider Token

## 6. 能力中心

- [ ] 官方模板可搜索
- [ ] 校园副业 / 通用办公 / 自媒体 / 学习资料 / 编程辅助 分类筛选正常
- [ ] 已启用列表正常
- [ ] 扩展预览（HermesHub）不显示安装按钮
- [ ] 运行技能打开 Skill Runner
- [ ] 必填字段为空时不能继续
- [ ] 生成指令后新建对话（session 标题为技能名称）
- [ ] 技能生成的消息走 OpenClaw HTTP-first 路径
- [ ] 不污染旧会话
- [ ] 邮件润色技能可运行
- [ ] 朋友圈宣传文案技能可运行
- [ ] 客户咨询回复技能可运行
- [ ] 周报/月报生成技能可运行
- [ ] 会议纪要整理技能可运行
- [ ] 工作汇报拆解技能可运行
- [ ] 表格数据解释技能可运行

## 7. 文件库

- [ ] 上传 txt / md / csv / json / log 正常
- [ ] 上传 xlsx / xls 正常
- [ ] 上传 docx 正常
- [ ] 上传 pptx 正常
- [ ] 不支持文件显示友好提示
- [ ] 文件预览正常
- [ ] 删除文件有确认弹窗
- [ ] 打开文件位置正常
- [ ] 复制路径正常
- [ ] 保存回复到 generated 正常
- [ ] "用于 Agent 分析"按钮对支持文件类型显示
- [ ] "用于 Agent 分析"点击后跳转到 AI 对话页
- [ ] 跳转后附件显示在输入区
- [ ] 不支持文件类型不显示"用于 Agent 分析"按钮

## 8. 文件分析

- [ ] xlsx 表格走快速结构化摘要
- [ ] csv 表格走快速结构化摘要
- [ ] docx 可提取文本
- [ ] pptx 可提取文本
- [ ] 文件内容不完整显示在聊天气泡里
- [ ] 用户气泡只显示问题 + 附件 chip
- [ ] 附件分析走 OpenClaw HTTP-first 路径
- [ ] 同一文件重复分析命中缓存（第二次更快）
- [ ] 文件过大时有截断/摘要提示
- [ ] 重新上传同路径同大小但不同时间的文件不命中旧缓存

## 9. 使用概况

- [ ] 使用概况数据来自本地历史会话统计
- [ ] 没有 mock 固定数据
- [ ] 无历史时空状态正常
- [ ] Token 统计大致合理
- [ ] 本地估算说明清楚

## 10. 助手记忆

- [ ] 页面标题为 "助手记忆"
- [ ] 记忆文件列表正常（MEMORY / USER / SOUL）
- [ ] 记忆内容可查看
- [ ] 明确标注"只读"
- [ ] 不显示 "Hermes 记忆" 或 "请配置 Hermes 记忆"
- [ ] 敏感内容（Token / API Key）已脱敏

## 11. 使用教程 / 关于

- [ ] 教程页显示 OpenClaw/Agent 初始化流程，不显示 Hermes 文案
- [ ] 关于页标题为 "AI Agent 工作台 U盘版"
- [ ] 关于页不显示 Hermes 管理 / Hermes 对话服务
- [ ] 使用步骤为 OpenClaw Gateway 配置流程

## 12. Hermes Legacy 入口

- [ ] 左侧导航不显示 "Hermes 管理"
- [ ] 左侧导航不显示 "Hermes 记忆"
- [ ] 左侧导航不显示 "定时任务"
- [ ] 左侧导航显示 "AI 助手" / "助手记忆"
- [ ] 移动端页面选择器无 Hermes 入口
- [ ] Legacy 引擎诊断信息在 "售后诊断" 折叠区（默认隐藏）
- [ ] HermesLegacyBackend 代码保留未删除
- [ ] `src/lib/hermes.ts` 完整保留
- [ ] Rust Hermes commands 完整保留

## 13. 安全检查 (OpenClaw RC)

- [ ] Token 不写入 AppConfig.apiKey
- [ ] Token 不进入 localStorage / sessionStorage
- [ ] Token 不打印到 console.log
- [ ] Token 不显示在 UI 中（密码框除外）
- [ ] 普通 UI 不显示 baseUrl / provider / API URL
- [ ] 普通 UI 不显示 https://ai.f1class.icu / ai-agent-proxy
- [ ] Rust 内部 Authorization / Bearer 不返回前端
- [ ] gateway.auth.token 不显示值，仅显示 "已配置" / "未配置"
- [ ] `save_generated_file` 不允许 .. 路径穿越
- [ ] `delete_ai_file` 只能删除 ai-files 目录内文件
- [ ] `.env` 权限为 0600（Unix）
- [ ] 错误信息不包含 Token
- [ ] 不读取或展示 .env 内容
- [ ] 不支持第三方 Base URL 输入

## 14. macOS 本地验收

- [ ] `npm run dev` 可正常使用
- [ ] Tauri 窗口可打开（`cargo tauri dev` 或 打包后 .app）
- [ ] 所有页面均可正常访问

## 15. Windows 打包 (待执行)

- [ ] Windows 打包通过
- [ ] 打包后首次启动正常
- [ ] 图标正常
- [ ] App 名称正常
- [ ] 配置和历史路径正常

## 已知遗留项 (不阻塞 RC)

| 项 | 说明 |
|---|---|
| Dashboard Token 状态 | `config.apiKey` 状态卡始终显示 "未配置"（OpenClaw 不写该字段） |
| EnginesPage Hermes fallback | `doApply`/`saveConfig` 仍可写旧 apiKey（仅 legacy 路径触发） |
| localStorage fallback | `storage.ts` 仍保留 Tauri 写入失败时的 localStorage 降级 |
| Device pairing | WebSocket Gateway RPC 保留为 advanced/future，不使用 |
| Streaming | HTTP-first v0 暂不支持 SSE 流式输出 |
| Skills.install | 未实现 OpenClaw skills 安装，HermesHub 预览仅展示 |
| Background run retry | 失败重试不传递附件（仅复用 userContent 文本） |
| Cancel persistence | 取消状态刷新后丢失（未持久化 run 到磁盘） |

## 17. 消息操作 (TASK-022)

- [ ] AI 回复复制：只复制回复正文，不复制 metadata/token
- [ ] AI 回复继续：填入 "请继续。"，不自动发送
- [ ] 用户消息复制：只复制用户原文
- [ ] 用户消息填入输入框：填入原文，聚焦，不自动发送
- [ ] 失败消息重试：保留原错误 + 新建 run + 追加新回复
- [ ] AI 回复重新生成：按 regenLast 逻辑
- [ ] running 时 regen/retry 禁用，复制仍可用
- [ ] 消息操作不暴露 token/baseUrl/provider/API URL

## 18. 会话列表 (TASK-023)

- [ ] 会话列表显示 "最近会话"
- [ ] "新建" 按钮正常创建空会话
- [ ] 点击会话项切换到对应 session
- [ ] 当前会话高亮
- [ ] 最新更新的会话排在前面
- [ ] running run 对应会话显示 spinner
- [ ] 后台 run 完成后写回原会话，不写错目标 session
- [ ] 切会话不丢消息

## 16. 后台 Run (TASK-021)

- [ ] 发送后切页面 → 回复写回原会话
- [ ] 跨页面完成 → 回到对话页可见完整回复
- [ ] 左侧 AI 对话导航显示 running spinner
- [ ] 非 ChatPage 时显示 "AI Agent 正在处理消息" 横幅
- [ ] 点击横幅"查看"回到对话页
- [ ] 完成/失败后 running 指示消失
- [ ] 取消 → 显示"已取消生成"
- [ ] 取消后迟到 HTTP response 不覆盖取消消息
- [ ] 取消后可继续发送新消息
- [ ] 失败消息显示安全错误摘要（不含 token/baseUrl/provider）
- [ ] 失败消息旁有"重试"按钮
- [ ] 重试保留原失败消息
- [ ] 重试追加新 assistant placeholder + 新 runId
- [ ] hasRunningRun 不卡住
- [ ] 连续两轮不覆盖、不重复

## 19. UI 总回归 (TASK-025F)

### 首页 HomePage

- [ ] 首页定位为"AI Agent 工作台"
- [ ] Hero / 快速入口 / 最近会话 / AI 助手卡布局正常
- [ ] 1280px 下无横向溢出
- [ ] 不显示 Token/API URL/provider/baseUrl
- [ ] 当前模型显示真实 primary model，不显示 openclaw/default

### AI 对话页 ChatPage

- [ ] 1280px 下 260px sidebar + 弹性聊天区可用
- [ ] 项目 pill / 会话列表 / 搜索框不溢出
- [ ] 消息区居中可读
- [ ] 输入区按钮不被挤压
- [ ] running spinner / banner 不遮挡

### 消息操作

- [ ] AI 复制正常
- [ ] AI 继续只填入"请继续。"不自动发送
- [ ] 用户复制 / 填入正常
- [ ] 失败重试有 hasRunningRun guard
- [ ] 重新生成有 hasRunningRun guard
- [ ] 取消文案为"已取消生成"

### 会话 / 项目侧栏

- [ ] 搜索、项目筛选、项目计数正常
- [ ] 新建 / 重命名 / 删除项目正常
- [ ] chatProjects 主路径为 chat-projects.json
- [ ] running spinner 不挤爆标题

### AI 助手页

- [ ] 普通视图用户化，显示真实模型
- [ ] 不显示思考强度 / 显示思考过程
- [ ] 高级诊断不展示 API URL/Token
- [ ] 窄窗口下不横向溢出

### 能力中心

- [ ] 页面标题为"能力中心"
- [ ] 可用项标记为"内置工作流"
- [ ] "使用工作流"填入 prompt 并跳转对话页
- [ ] OpenClaw 插件显示"接入规划中"
- [ ] 没有安装按钮
- [ ] 分类筛选 1280px 下可用（flex-wrap 换行）

### 桌面窄窗口

- [ ] 1280px / 1366px / 1440px 无横向滚动
- [ ] 卡片不被挤爆
- [ ] 三栏布局不压死聊天区

### Portable 回归

- [ ] portable_data_status 不返回敏感信息
- [ ] portable_runtime_status 不返回敏感信息
- [ ] system mode 默认可用
- [ ] workspace_root Windows/macOS 推导正确

## 20. 阶段性版本测试 (TASK-029A, v0.2.0-stage)

### 构建

- [ ] `npm run build` 通过
- [ ] `cargo check` 通过
- [ ] `node scripts/openclaw-http-api-probe.mjs` 通过
- [ ] `node scripts/test-redaction.mjs` 21/21 通过

### 首次启动

- [ ] 首次启动显示 Onboarding（4 步）
- [ ] 跳过后不再弹出
- [ ] 首页"新手引导"可重开

### 首页

- [ ] 快速入口可用
- [ ] 最近会话显示
- [ ] AI 助手状态卡正常
- [ ] 不显示 Token/baseUrl/provider

### AI 对话

- [ ] 发送消息正常
- [ ] 后台 run 切页面不丢消息
- [ ] 停止/重试/重新生成正常
- [ ] 会话/项目侧栏正常

### 能力中心

- [ ] 内置工作流可用
- [ ] 外部目录 9 项显示
- [ ] 排行 tabs 筛选正常
- [ ] 安装确认框完整（名称/来源/风险/权限/免责）
- [ ] 高风险需 checkbox
- [ ] 安装后显示"卸载"
- [ ] 卸载后恢复"安装"
- [ ] 刷新后安装状态持久

### 文件/数据工作流

- [ ] 文件总结可运行
- [ ] 表格分析可运行
- [ ] 条款提取含法律免责

### 娱乐工作流

- [ ] 随机冷知识可运行
- [ ] 精神状态诊断含非医学免责
- [ ] 今日摸鱼任务含"不刷短视频"

### Portable

- [ ] portable_data_status 返回正常
- [ ] portable_runtime_status 返回正常
- [ ] 不暴露敏感信息

### 敏感信息

- [ ] 普通 UI 不显示 Token/baseUrl/provider/API URL
- [ ] 高级诊断不暴露 Token
- [ ] 安装记录不含 Token
- [ ] console.log 不含 Token
- [ ] localStorage 仅 legacy fallback

### 导航命名 (TASK-031B)

- [ ] 左侧显示：首页 / AI 对话 / AI 助手 / 能力中心 / 摸鱼中心 / 助手记忆 / 用量概览 / 文件库 / 教程 / 关于
- [ ] 点击每个导航，页面正常切换，不出现空白页
- [ ] 导航文案无中英文混杂（无 "Skill Center" "Agent 对话" "Agent 引擎" 等旧文案）
- [ ] RouteId 未变，功能逻辑不受影响
