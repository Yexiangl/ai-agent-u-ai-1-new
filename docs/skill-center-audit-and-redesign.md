# Skill Center 真实能力审计与重构方案

TASK-027A：Skill Center 审计与重构方案。

日期：2026-05-27 | 本轮只做审计和方案，不改业务代码。

---

## 一、当前 Skill Center 真实状态

### 1.1 这不是真实能力中心，是提示词模板列表

当前 Skill Center 本质上是一个 **硬编码的提示词模板展示页**，不具备任何真实的 skill 安装、管理或执行能力。

### UI 三栏

| 标签 | 内容 | 数据来源 | 是否真实 |
|---|---|---|---|
| **官方模板** | 23 个 prompt 模板 | `src/data/skills.ts` 硬编码 | ✅ 真实可用（作为 prompt） |
| **已启用** | 按 `config.enabledSkills` 过滤 | AppConfig（localStorage/Tauri） | ✅ 真实状态 |
| **扩展预览** | 13 个占位卡片 | `src/data/skills.ts` 硬编码，全部 `status: "coming_soon"` | ❌ 纯展示，无实际功能 |

### 1.2 "运行" 按钮做什么？

```
用户点击 "运行" → 填写 inputFields 表单 → "生成并进入对话" →
  1. setPendingNewSessionTitle(skill.name)
  2. setChatDraft(builtPrompt)       ← 把 prompt 拼成一段文本
  3. setActive("chat")               ← 跳转到 Agent 对话页
```

**本质：只是把一段 prompt 文本填入 Agent 对话输入框，没有任何真实的 skill 安装/执行。**

### 1.3 关键判断

| 问题 | 答案 |
|---|---|
| Skill 是否可安装？ | ❌ 无安装功能 |
| Skill 是否可启用/禁用？ | ✅ 仅为前端 toggle（过滤模板列表显示） |
| Skill 是否可运行？ | ❌ 仅为生成 prompt 跳转对话页 |
| 是否影响 OpenClaw？ | ❌ 无任何影响 |
| 是否需要 OpenClaw？ | ❌ 不依赖 |
| 是否是真实能力？ | ❌ 本质是 prompt 模板货架 |

---

## 二、Skill 数据来源

| UI 内容 | 数据来源 | 是否真实 | 是否可执行 | 建议 |
|---|---|---|---|---|
| 官方模板列表 (23个) | `src/data/skills.ts` `officialSkills[]` | ✅ 类型定义+硬编码 | ⚠️ 仅 prompt 拼接 | 保留为"内置提示词模板"，改名为"工作流"更准确 |
| 扩展预览列表 (13个) | `src/data/skills.ts` `hermesHubSkills[]` | ❌ 全是 `coming_soon` | ❌ 无功能 | 移除或改为"已安装 skill"真实列表 |
| 已启用列表 | `config.enabledSkills` 过滤 | ✅ 前端 toggle | ⚠️ 不影响 OpenClaw | 保留 |
| skill 运行 (generateAndGo) | `builtPrompt` 字符串拼接 | ✅ 仅文本 | ⚠️ 仅为 prompt 生成 | 保留 |
| OpenClaw skills.list | — | ❌ 未接入 | ❌ | 待 TASK-027C |
| OpenClaw skill install | — | ❌ 未接入 | ❌ | 待 TASK-027D |
| ClawHub / skillhub.cn | — | ❌ 未接入 | ❌ | 待评估 |
| 本地 skill 目录 | — | ❌ 未接入 | ❌ | 待评估 |

---

## 三、OpenClaw Skill 接入可能性

### 3.1 当前代码状态

| 能力 | 状态 | 证据 |
|---|---|---|
| `openclaw skills list` | ❌ 未接入 | 无 Rust command |
| `openclaw skill install` | ❌ 未接入 | 无 Rust command |
| `skills.install` RPC | ❌ 未接入 | 无代码 |
| `skills.status` RPC | ⚠️ 已有 WebSocket capability discovery | TASK-009 曾调用 skills.status（58 skills）|
| ClawHub/skillhub.cn | ❌ 未接入 | 无代码 |
| 本地 OpenClaw skills 目录 | ❌ 未读取 | 无代码 |
| OpenClaw config skill summary | ❌ 未读取 | 无代码 |

### 3.2 可行接入方案

**阶段 A (P0)：读取已安装列表**
- 通过 Rust command 调用 `openclaw skills list --json`
- 解析返回的 JSON，提取 skill 名称/描述/状态
- 在 Skill Center 中展示为"已安装"

**阶段 B (P1)：安装 skill**
- 通过 Rust command 调用 `openclaw skill install <name>`
- 安装前展示 skill 说明/权限
- 安装后自动刷新列表

**阶段 C (P2)：连接到 ClawHub/skillhub**
- 通过 HTTP API 查询可用 skill 列表
- 不直接安装远程代码
- 安装前需要用户确认

**安全约束**：
- 不允许任意执行危险 shell 命令
- 安装来源要可信
- 安装前展示权限/说明
- 不输出 Token
- 不读取 .env
- Skill 运行日志不能包含敏感信息
- 区分"内置安全 skill"和"外部 skill"

---

## 四、真实 Skill Center 产品化设计

### 4.1 信息架构

```
Skill Center
├── 已安装 (本地真实 OpenClaw Skills)
│   ├── 名称 / 描述 / 状态 / 操作
│   └── 操作：运行 / 管理 / 卸载
├── 内置工作流 (prompt 模板)
│   ├── 文件处理
│   ├── 数据处理
│   ├── 写作办公
│   ├── 自媒体
│   └── 开发调试
├── 推荐 (future: ClawHub/skillhub)
└── 娱乐 (轻量)
```

### 4.2 Skill 卡片字段

```
{
  id, name, description, icon,
  category, source: "builtin" | "openclaw" | "local" | "remote",
  status: "not_installed" | "installed" | "running" | "disabled",
  actions: "安装" | "运行" | "管理" | "卸载"
}
```

### 4.3 分类建议

| 分类 | 来源 | 示例 |
|---|---|---|
| 文件处理 | 内置+OpenClaw | 文件总结、文档问答、批量整理 |
| 数据处理 | 内置+OpenClaw | 表格分析、数据清洗、图表生成 |
| 写作办公 | 内置 | 邮件润色、周报、会议纪要 |
| 自媒体 | 内置 | 小红书文案、短视频脚本 |
| 开发调试 | 内置+OpenClaw | 报错解释、代码审查 |
| 学习辅导 | 内置 | 资料总结、考点提取 |
| 娱乐摸鱼 | 内置 | 随机知识、下班倒计时、每日任务 |

---

## 五、文件/数据处理 Skills 建议

产品定位：桌面 AI Agent 工作台，文件/数据是必须能力。

### 文件处理系列

| Skill | 来源 | 优先级 |
|---|---|---|
| 文件总结 | 内置 prompt | P0 |
| 文档问答 | 内置 prompt | P0 |
| 批量整理 | 内置 prompt | P1 |
| 格式转换说明 | 内置 prompt | P1 |

### 数据处理系列

| Skill | 来源 | 优先级 |
|---|---|---|
| 表格分析 | 内置 prompt | P0 |
| CSV/Excel 数据清洗 | 内置 prompt | P1 |
| 关键字段提取 | 内置 prompt | P1 |
| 图表生成建议 | 内置 prompt | P2 |

注意：文件/数据处理是必须能力，但不作为首页唯一主心智。

---

## 六、娱乐/养成/摸鱼功能建议

轻量增强，不抢主线，不变成小游戏大厅。

| 功能 | 形态 | 优先级 |
|---|---|---|
| 随机冷知识 | 内置 prompt Skill | P2 |
| 下班倒计时 | 首页小卡片 | P2 |
| 每日任务 | 内置 prompt Skill | P2 |
| AI 助手等级 | 首页小徽章 | P3 |
| 成就系统 | 首页/个人页 | P3 |

---

## 七、安全边界

如果未来支持安装/运行真实 skill：

| 规则 | 说明 |
|---|---|
| 安装来源可信 | 仅允许 OpenClaw 官方 registry 或经过验证的来源 |
| 安装前展示 | 展示 skill 名称、描述、权限、风险等级 |
| 用户确认 | 安装前需要明确用户确认 |
| 安全沙箱 | 不允许 skill 执行任意 shell 命令 |
| Token 隔离 | skill 运行不暴露 Token/provider/baseUrl |
| 日志过滤 | skill 运行日志不包含敏感信息 |
| 内置 vs 外部 | 内置 skill 与外部 skill 明确标注，UI 区分 |

---

## 八、后续任务拆分

| Task ID | 内容 | 优先级 | 改动范围 |
|---|---|---|---|
| TASK-027B | Skill Center 信息架构重设计 | P1 | UI 重构：内置工作流 + 分类 + 已安装区域 |
| TASK-027C | 本地已安装 OpenClaw Skills 读取 | P0 | Rust command `openclaw skills list --json` + UI 展示 |
| TASK-027D | Skill 安装/启用/运行最小闭环 | P1 | Rust `openclaw skill install` + UI 交互 |
| TASK-027E | 文件/数据处理首批内置 Skills | P1 | 新增 prompt 模板 |
| TASK-027F | 娱乐/养成轻量功能 | P2 | 设计与方案 |
