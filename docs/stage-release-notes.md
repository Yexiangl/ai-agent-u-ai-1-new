# AI Agent 工作台 — 阶段性版本发布说明

版本：v0.2.0-stage（内部测试）
日期：2026-05-28
基线提交：f6988c5（feature/skill-center）

---

## 核心能力摘要

本阶段完成了从"工程后台"到"用户产品"的全面转型：

| 模块 | 状态 | 说明 |
|---|---|---|
| Onboarding | 已完成 | 4 步轻量引导，用户化文案 |
| 首页 | 已完成 | Workspace 入口，快速操作 + 最近会话 |
| Agent 对话 | 已完成 | 260px 侧栏 + 弹性聊天区，后台 run |
| Agent 引擎 | 已完成 | 用户化配置，真实模型展示 |
| Skill Center | 已完成 | 内置工作流 + 外部目录 + 安装/卸载 + 排行 |
| Portable | 阶段性 | 路径基础 + 安全策略 + redaction helper |
| 安全 | 已完成 | redactSensitive 21 项覆盖 |

---

## 功能详情

### Onboarding（TASK-020C）

- 4 步引导：欢迎 → 检查 AI 助手 → 选择入口 → 完成
- 用户化文案，无技术术语
- 可跳过，完成后持久化不再弹出
- 首页可重新打开

### 首页 / Agent 对话（TASK-025）

- 首页：快速入口 + 最近会话 + AI 助手状态卡
- 对话页：260px 项目/会话侧栏 + 弹性聊天区
- 后台 run：切页面不丢消息，running 指示器
- 消息操作：复制/继续/重试/重新生成/填入
- 会话/项目：新建/重命名/删除/移动/搜索

### Agent 引擎页（TASK-026）

- 普通视图显示真实 primary model
- 不显示思考强度/显示思考过程（假配置已移除）
- 高级诊断不暴露 Token/API URL
- 模型供应配置仍可用

### Skill Center（TASK-027）

- 能力中心：内置工作流 + OpenClaw 插件占位
- 外部目录：9 项 curated catalog（ClawHub/SkillHub/OpenClaw/Curated）
- 一键安装：Rust allowlist 9 项 + 确认框 + 高风险二次确认
- 卸载：CLI uninstall + 记录清理
- 排行：全部/热门/趋势/新上架/高风险 tabs
- 权限/风险：4 级风险 + 9 项权限标签

### 文件 / 数据工作流（TASK-027D）

8 个内置工作流：文件总结、表格分析、数据清洗建议、资料整理成报告、批量命名/分类、条款提取、学习资料整理、数据可视化建议。

### 娱乐摸鱼工作流（TASK-027E）

6 个内置工作流：下班倒计时、随机冷知识、精神状态诊断、AI 桌宠设定、今日摸鱼任务、成就徽章生成器。

### Portable A+B 阶段性能力（TASK-028）

- workspace_root macOS/Windows 推导
- portable_data_status / portable_runtime_status
- app_data_root system/portable 双模式
- chat-sessions.json / chat-projects.json 文件持久化
- 安全策略文档 + redaction policy

### 安全与脱敏（TASK-028H-1）

- redactSensitive：Bearer/apiKey/token/URL/path/env/query 全覆盖
- redactObject：对象安全序列化
- JSON 脱敏保留引号（合法 JSON 输出）
- 21 项测试用例全部通过

---

## 已知限制

| 项 | 说明 |
|---|---|
| Streaming | HTTP-first v0 暂不支持 SSE 流式输出 |
| 外部目录 | 当前为 curated mock，未接入真实 ClawHub API |
| 安装/卸载 | 依赖本地 OpenClaw CLI 可用 |
| Portable runtime | 未实现真实 runtime 打包 |
| Windows 打包 | 未执行 Windows release build |
| Onboarding Step 3 | 选择入口后不跳转对应页面（P2） |
| Windows 控制台 | install/uninstall 未调用 hide_command_window（P2） |
| console.log | 保留 [send-perf] 性能日志（不含敏感信息） |
| localStorage | 仅 Tauri 写入失败时的 legacy fallback |

---

## 构建验证

| 项目 | 结果 |
|---|---|
| npm run build | 通过（400KB JS） |
| cargo check | 通过（3 warnings） |
| openclaw probe | 通过（3 models, chat OK） |
| test-redaction | 21/21 passed |

---

## 下一步计划

| 优先级 | 任务 | 说明 |
|---|---|---|
| P2 | TASK-028H-2 | 诊断包脱敏导出 |
| P2 | TASK-028H-3~5 | Portable 实现类子任务 |
| P2 | TASK-028F-1 | Portable 安全增强 |
| P1 | TASK-020/021 | 父任务收口 |
| — | Windows 打包 | 待执行 |
| — | 真实 ClawHub API 接入 | 待评估 |
