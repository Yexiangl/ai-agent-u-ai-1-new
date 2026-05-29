# 前端 UI 动效与交互体验审计

TASK-036A | 日期：2026-05-29 | 本轮只做审计，不改业务代码。

---

## 1. 当前整体问题

### 做得好的

| 项 | 说明 |
|---|---|
| Loading spinner | 统一 Loader2 + animate-spin，22 处一致 |
| 按钮体系 | primary/outline/ghost/destructive 分工清楚 |
| 卡片分层 | 静态容器卡片 vs 交互列表卡片区分明确 |
| 内联反馈 | 错误/成功/警告用统一 border+bg 色系 |
| 空状态 | 统一 rounded-xl border bg-muted/30 容器 |

### 需要改进的

| 问题 | 严重度 | 说明 |
|---|---|---|
| 页面切换无动画 | P1 | 路由切换瞬间 mount/unmount，视觉跳动 |
| 无 toast 系统 | P1 | 安装成功/失败只有 inline，容易被忽略 |
| 导航 hover 用硬编码 hex | P2 | `#EEF2FF`/`#4F46E5`/`#F1F5F9` 不跟主题 |
| 卡片 hover 边框不统一 | P2 | /20 /30 /40 混用 |
| animate-fade-in 定义未使用 | P2 | globals.css 有但没用 |
| 能力中心卡片信息过密 | P1 | nativeName+installCommand+badges 拥挤 |

---

## 2. 优先级排序

### P0（影响核心体验）

无 P0 问题。当前 UI 功能完整，不影响使用。

### P1（影响产品质感）

1. 页面切换加轻量 fade（最大感知提升）
2. 能力中心卡片信息密度优化
3. 新增轻量 toast 用于安装/卸载/操作反馈
4. 导航 hover 改用语义 token

### P2（风格 polish）

5. 卡片 hover 边框统一为 /20
6. 使用已定义的 animate-fade-in
7. 摸鱼中心 Hero 加微动效
8. 对话页消息进入动画

---

## 3. 全局交互规范

### 3.1 Transition 规则

```
默认：transition-colors duration-150
卡片 hover：transition-colors（已有，保持）
弹窗/overlay：animate-fade-in（0.15s ease-out，已定义）
页面切换：animate-fade-in（复用）
```

### 3.2 Hover 规则

```
交互卡片：hover:border-primary/20 hover:bg-primary/5
列表项：hover:bg-muted/40
按钮：由 Button 组件内置处理
导航项：hover:bg-muted（改掉硬编码 hex）
```

### 3.3 Loading 规则

```
按钮内：Loader2 h-4 w-4 animate-spin + 文案
全页：Loader2 h-5 w-5 animate-spin + 居中
卡片内：Loader2 h-4 w-4 animate-spin + inline 文案
```

### 3.4 反馈规则

```
操作成功：轻量 toast（右上角，3s 自动消失）
操作失败：inline error banner + toast
危险操作：ConfirmDialog（已有）
状态变化：inline badge 切换
```

### 3.5 Disabled 规则

```
按钮：opacity-50 + cursor-not-allowed（Button 组件内置）
卡片：opacity-60 + pointer-events-none
输入框：bg-muted + cursor-not-allowed
```

---

## 4. 各页面具体优化建议

### 4.1 首页

| 项 | 建议 | 优先级 |
|---|---|---|
| 快速入口卡片 | 加 hover scale(1.01) 微放大 | P2 |
| AI 助手状态卡 | 状态变化时 pulse 一次 | P2 |
| 最近会话列表 | 保持现状，已够好 | — |

### 4.2 AI 对话页

| 项 | 建议 | 优先级 |
|---|---|---|
| 消息进入 | 新消息 fade-in + translateY(4px) | P2 |
| 生成中状态 | animate-pulse 已有，保持 | — |
| 操作按钮 | hover 时 opacity 从 0→1 已有，保持 | — |
| 空状态 | 加引导文案"试试问我一个问题" | P2 |
| 输入框 focus | 加 ring-primary/20 | P2 |

### 4.3 AI 助手页

| 项 | 建议 | 优先级 |
|---|---|---|
| 诊断面板 | 检测项状态变化时 transition-colors | P2 |
| 控制台按钮 | 保持现状 | — |
| 高级诊断折叠 | 加 animate-slide-in 或 max-height transition | P2 |

### 4.4 摸鱼中心

| 项 | 建议 | 优先级 |
|---|---|---|
| Hero 渐变 | 可加微妙 gradient shift 动画 | P2 |
| 卡片进入 | stagger fade-in（每张延迟 50ms） | P2 |
| 按钮 | 保持现状 | — |

### 4.5 助手记忆

| 项 | 建议 | 优先级 |
|---|---|---|
| 文件列表选中 | 已有 border-primary/40 高亮，保持 | — |
| 内容区 | 长文本加 max-height + scroll | P2 |

### 4.6 用量概览

| 项 | 建议 | 优先级 |
|---|---|---|
| 数字变化 | 可加 countUp 动画 | P2 |
| "暂未提供" | 保持 muted tone，已够好 | — |

---

## 5. 能力中心专项建议

### 5.1 卡片信息密度

当前每张排行卡片展示：名称 + 描述 + 原生名称 + 安装口令 + 来源 badge + 类型 badge + 风险 badge + 权限 + 排行 badge + 安装按钮。

**问题**：信息过密，视觉拥挤。

**建议**：
- 卡片默认只显示：名称 + 描述 + 来源 + 类型 + 风险 + 安装按钮
- 原生名称/安装口令折叠到"详情"或 hover 展开
- 安装确认弹窗展示完整信息（已做）

### 5.2 已安装区域

- 当前位置合理（排行之前）
- 建议加轻量分隔线或背景色区分
- 空状态已有，保持

### 5.3 安装/卸载反馈

- 当前 inline error 可以保留
- 建议新增 toast：安装成功/卸载成功时右上角轻量提示
- 失败仍用 inline（需要用户操作）

### 5.4 排行 badge 视觉

- 当前 #1~#9 灰色数字 + 热门/趋势/新上架/需谨慎 badge
- 建议：排名数字可以更小或移到角标位置
- badge 数量控制在 3 个以内（来源 + 类型 + 风险）

---

## 6. 动效实现建议

### 6.1 推荐方案：纯 Tailwind + 已有 CSS keyframes

不引入 Framer Motion。理由：
- 当前项目无动画库依赖
- 需要的动画都很轻量（fade/slide）
- Tailwind transition + 2 个已有 keyframe 足够
- 引入 Framer Motion 增加 ~30KB bundle

### 6.2 实现方式

| 动效 | 实现 |
|---|---|
| 页面切换 fade | 包裹 `animate-fade-in` class（已定义） |
| 卡片 hover | `transition-colors hover:border-primary/20`（已有） |
| 弹窗进入 | `animate-fade-in`（已定义） |
| 消息进入 | 新增 `animate-message-in` keyframe（translateY + opacity） |
| Toast | 新增 `animate-toast-in` keyframe（translateX + opacity） |
| Loading | `animate-spin`（已有） |

### 6.3 新增 CSS（约 10 行）

```css
@keyframes messageIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-message-in { animation: messageIn 0.2s ease-out; }

@keyframes toastIn {
  from { opacity: 0; transform: translateX(100%); }
  to { opacity: 1; transform: translateX(0); }
}
.animate-toast-in { animation: toastIn 0.25s ease-out; }
```

---

## 7. 不建议做的动画

| 不做 | 原因 |
|---|---|
| 页面切换 slide | 桌面 App 不是移动端，slide 不自然 |
| 卡片 3D 翻转 | 花哨，影响性能 |
| 粒子/confetti | 不符合产品定位 |
| 全局 page transition 库 | 过度工程 |
| 每个元素 stagger | 首屏加载慢 |
| 骨架屏 | 数据加载快，不需要 |
| 复杂 spring 物理 | 不引入 Framer Motion |

---

## 8. 后续任务拆分

| Task ID | 优先级 | 内容 | 预估 |
|---|---|---|---|
| TASK-036B | P1 | 全局交互基础：页面 fade-in + 导航 hover 修复 + toast 组件 | 2h |
| TASK-036C | P1 | 能力中心视觉 polish：卡片信息折叠 + badge 精简 + 安装 toast | 1.5h |
| TASK-036D | P2 | AI 对话页：消息 fade-in + 空状态引导 + 输入框 focus ring | 1h |
| TASK-036E | P2 | AI 助手页：诊断面板 transition + 高级诊断折叠动画 | 0.5h |
| TASK-036F | P2 | 摸鱼中心/首页：Hero 微动效 + 卡片 stagger | 0.5h |
| TASK-036G | P2 | 回归测试 | 0.5h |

### 推荐执行顺序

1. **TASK-036B** — 全局基础（页面 fade + toast），后续都依赖
2. **TASK-036C** — 能力中心（当前重点模块）
3. **TASK-036D** — 对话页（核心功能）
4. **TASK-036E/F** — 辅助页面 polish
5. **TASK-036G** — 回归
