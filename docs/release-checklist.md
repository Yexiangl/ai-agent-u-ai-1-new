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

- [ ] 类型标签：内置 / 工作流 / 插件 / 即将支持
- [ ] 风险标签：低风险 / 中风险 / 高风险 / 未验证
- [ ] 内置工作流按钮为"使用"
- [ ] 暂不可用按钮为"暂未开放"
- [ ] 安装确认框：风险/权限提示 + 二次确认（高风险/未验证）
- [ ] 排行免责：排行仅用于浏览参考，不代表安全性
- [ ] 外部插件区显示"暂未开放"
- [ ] 页面标题为"能力中心"
- [ ] "使用"按钮填入 prompt 并跳转对话页
- [ ] 外部插件显示"暂未开放"
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
- [ ] 今日休息任务含"不刷短视频、不沉迷、不影响正事"
- [ ] 摸鱼中心无"装死""摆烂""下线""系统维护"等过度摆烂词
- [ ] Hero 副标题为"让状态慢慢回来"，不再写"系统维护"
- [ ] AI 桌宠 bubble 为"合理放空"，不再"合理装死"

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
