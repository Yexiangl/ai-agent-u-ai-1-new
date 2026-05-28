# Workspace Clean UI 重设计方案

TASK-025A：UI 重设计方案文档。

日期：2026-05-27 | 本轮只做方案设计，不改业务代码。

---

## 一、当前问题诊断

### 1.1 首页问题

当前首页像"工程后台状态面板"：
- Agent 状态 / Token 状态 / Skills 数量等 Metric 卡片作为首屏主视觉
- 连接状态 (OpenClaw Gateway running / Token present) 占据大面积
- 模型列表、检测按钮等调试级信息呈现在首屏
- "快速开始"区域在视觉权重上弱于状态信息
- 没有"最近会话"入口，缺少产品连续性

**核心问题**：首页在回答"系统状态是什么"而非"我能做什么"。

### 1.2 Agent 对话页问题

当前布局：`lg:grid-cols-[300px_minmax(0,1fr)]`

- 300px 侧栏在大屏上视觉权重过高（尤其含项目列表 + 搜索 + 会话列表 + 底部清空按钮）
- 会话列表项使用 rounded-xl 大圆角 + 预览文本 + 操作菜单，每项高度较大
- 项目区 + 新建项目 + 搜索框 + 会话列表 = 侧栏内容过多，信息密度偏高
- 聊天区顶部显示 HTTP / model / elapsedTime / 连接状态等调试信息
- 消息 footer 显示 source / modelName / elapsed，工程感偏重
- 用户消息气泡宽度和颜色（品牌紫大色块）视觉压迫感强

**用户特别反馈**：历史/最近会话区域占比太大，希望缩小。

### 1.3 状态展示过重

- "OpenClaw Agent · openclaw/default · HTTP-first" 等标签在聊天页常驻
- Gateway 连接状态、Token 检测等技术细节暴露在主界面
- running 状态已正确显示，但与调试标签混在一起

---

## 二、新设计原则

命名：**Workspace Clean UI**

| 原则 | 说明 |
|---|---|
| Chat first | 聊天区是主角，其他区域为辅助 |
| Context light | 会话/项目侧栏轻量、窄小、辅助 |
| Status quiet | 状态信息低噪音，成功时不抢视线 |
| Action clear | 主操作（发送/新建）一眼可见 |
| Progressive detail | 技术状态放 Agent 引擎页，不放聊天主页 |
| Desktop calm | 桌面宽屏留白而非填满 |

---

## 三、页面整体布局建议

### 当前

```
| 主导航 56px | 会话侧栏 300px | 聊天区 1fr |
```

### 建议

```
| 主导航 220px | 上下文侧栏 260px | 聊天主区域 1fr |
```

尺寸建议：
- 主导航：220-240px（含页面入口 + 品牌 + 当前 run indicator）
- 会话/项目侧栏：260px，最多 300px（**明显缩窄**）
- 聊天区：自适应，占主视觉权重

**用户特别要求**：历史/最近会话区域占比缩小。本设计建议把它从 300px 降到 260px，并降低每个会话项的高度和视觉权重，使其成为辅助上下文侧栏而非主面板。

未来考虑：会话侧栏可折叠。

---

## 四、首页新版信息架构

从"状态面板"改为"工作台入口"：

### 4.1 Hero 区

```
AI Agent 工作台
一句话描述（智能工作伙伴）
[开始对话]  [配置 Agent 引擎]
```

- "开始对话"为主按钮（primary）
- "配置 Agent 引擎"为次级按钮

### 4.2 快速入口

```
开始对话  |  分析文件  |  Skill Center  |  Agent 记忆
```

4 个图标入口卡片，低高度。

### 4.3 最近会话

最近 3-5 条会话，点击直接进入。

### 4.4 轻量 Agent 状态

降级为一行：
```
已就绪 · openclaw/default  [查看详情 →]
```

"查看详情"链接到 Agent 引擎页。

**降级策略**：
- Token 状态不作首页主卡片
- HTTP/Gateway 细节不作首屏主视觉
- Skills 数量保留但降低为辅助标签

---

## 五、Agent 对话页新版信息架构

### 5.1 顶部简化

当前：`AI Agent · OpenClaw Agent · openclaw/default · HTTP-first · 5s`

建议：`AI Agent · 已就绪`（小绿点 + 模型名可悬浮显示）

降级：
- HTTP 标签移除出主视觉
- Gateway/Token 细节放 Agent 引擎页
- 连接状态只用小绿点 + "已就绪"

### 5.2 会话/项目侧栏缩窄

宽度：260px（当前 300px）

内部结构：
```
项目（紧凑筛选器）
最近会话（紧凑列表）
```

- 项目区：只有项目名 + 计数，不需要大间距
- 会话项：标题 + 时间或一行预览，减少 padding
- 高亮：轻量背景色，不要重边框
- 操作按钮：hover 显示
- 新建对话按钮：侧栏顶部右侧

### 5.3 聊天区增强

- 最大宽度容器（700-800px）居中
- 空状态显示引导
- 输入区固定底部，轻量设计

---

## 六、会话/项目侧栏尺寸与布局

| 属性 | 当前 | 建议 |
|---|---|---|
| 侧栏宽度 | 300px | 260px |
| 会话项高度 | ~64px（含预览） | ~44px（单行标题 + 时间） |
| 圆角 | rounded-xl (12px) | rounded-lg (8px) |
| padding | p-2 per item | py-1.5 px-2 |
| 项目区高度 | ~140px+ | ~80px（紧凑筛选） |
| 搜索框 | full-size input | compact input |

关键要求：
- 超过 320px 会削弱聊天主区域
- 项目区压缩为紧凑筛选器
- 会话项减少内边距和大卡片感
- 当前会话高亮清晰但不过重
- 新建按钮小巧放侧栏标题行

---

## 七、消息区设计

### 用户消息

- 保留品牌紫，但降低饱和度或使用渐变边缘
- 最大宽度 65-70%（当前偏宽）
- 圆角统一 rounded-xl
- 不要大色块满宽

### AI 回复

- 背景更轻（transparent 或 muted/5）
- footer 弱化：source/model 用 10px 灰字
- 操作按钮 hover 显示，非 hover 隐藏
- 代码块保持深色

### 输入区

- 固定底部
- 轻边框（border-muted）
- shadow-sm，不重
- 发送按钮突出但不刺眼
- 附件入口保留

---

## 八、状态展示策略

分级：

| 级别 | 内容 | 位置 |
|---|---|---|
| 一级 | 是否可用（已就绪/需配置）| 聊天页顶部小绿点 |
| 二级 | 当前模型 | tooltip 或小字 |
| 三级 | HTTP/Gateway/Token/Provider | Agent 引擎页 |

---

## 九、移动端 / 窄屏策略

- 主导航：保持或窄屏折叠为图标
- 会话/项目侧栏：抽屉化（点击打开/关闭）
- 项目筛选：横向滚动 pill
- 聊天区：全宽
- 输入区：永远优先
- 中间会话区域：窄屏不应长期占据主视觉

---

## 十、视觉规范建议

| 属性 | 建议 |
|---|---|
| 背景色 | hsl(0 0% 100%) / dark: hsl(0 0% 7%) |
| 卡片边框 | 1px border-muted |
| 圆角 | 8px (md) / 12px (lg) / 16px (xl) |
| 间距 | 4/8/12/16/24px 梯度 |
| 字号 | 11px label / 13px body / 16px title |
| 状态点 | 绿(就绪) / 黄(处理中) / 红(异常) |
| hover | bg-muted/50 |
| 选中态 | bg-primary/10 + text-primary |
| shadow | shadow-sm 仅输入区/浮层 |

原则：
- 不用强渐变
- 不用重阴影
- 不要工程后台感
- 品牌紫保留但不大面积铺陈

---

## 十一、分阶段实现计划

| Task ID | 内容 | 改动范围 | 风险 |
|---|---|---|---|
| TASK-025B | 首页 Workspace UI | DashboardPage | 低 |
| TASK-025C | Agent 对话页布局 | ChatPage grid + 侧栏宽度 + 顶部简化 | 中 |
| TASK-025D | 消息区视觉 | 气泡 + footer + 操作按钮 | 低 |
| TASK-025E | 移动端/窄屏回归 | responsive + sidebar drawer | 中 |
| TASK-025F | UI 回归测试 | 全页面 | 低 |

依赖关系：B → C → D → E → F（顺序执行）

---

## 十二、风险与边界

| 风险 | 缓解 |
|---|---|
| UI 改动破坏功能 | 每个子任务必须 build + probe + 审计 |
| 侧栏缩窄导致内容溢出 | 使用 truncate + overflow-hidden |
| 首页改动丢失连接入口 | 保留"配置 Agent 引擎"按钮 |
| 移动端布局崩溃 | 独立 TASK-025E 处理 |

安全边界：
- 不改 OpenClaw HTTP 主链路
- 不改 run store
- 不改 session/project 数据结构
- 不改 Token 安全策略
- 不暴露 provider/baseUrl/API URL/token
- 不删除 Hermes legacy
- UI 实现分任务做，不一次大改

---

## 八、TASK-025F UI 总回归结果（2026-05-28）

### 阶段性完成状态

| 子任务 | 状态 |
|---|---|
| TASK-025A | 已完成：设计方案文档 |
| TASK-025B | 已完成：首页 Workspace UI 重设计 |
| TASK-025C | 已完成：Agent 对话页布局重设计 |
| TASK-025D | 已完成：消息区与操作按钮视觉优化 |
| TASK-025E | 已完成：桌面窄窗口 UI 回归 |
| TASK-025F | 已完成：UI 总回归测试 |

### 桌面窄窗口策略

- ChatPage：260px 固定 sidebar + flex-1 聊天区，项目列表 min-w-0 防溢出
- EnginesPage：按钮行 overflow-x-auto 允许横向滚动
- SkillsPage：分类按钮 flex-wrap 换行
- HomePage：max-w-[1120px] + min-w-0 约束
- 全局：无 iPhone/Android/触屏优先适配

### 代码审计结论

- npm run build：通过
- cargo check：通过
- OpenClaw HTTP probe：通过
- 消息操作 hasRunningRun guard：完整
- Portable workspace_root：macOS early-return 修复合格
- 敏感信息：无新增暴露
- ReasoningEffortControl：已从普通 UI 移除（组件定义保留但未渲染）
- chatProjects：主路径为 chat-projects.json，localStorage 仅 legacy fallback
