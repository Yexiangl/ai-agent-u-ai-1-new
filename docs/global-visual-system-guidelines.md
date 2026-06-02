# 全项目视觉系统规范与推广计划

TASK-043A | 基于 TASK-042 AI 助手页视觉升级验证成果

---

## 1. 总体设计目标

- **简单、易用、易看懂**：面向无技术客户，页面一眼就懂
- **高级但不技术感**：macOS Settings + Dashboard 风格
- **状态自解释**：用户无需理解底层就能知道发生了什么
- **操作闭环**：关键操作在首屏可见，次操作不抢主视觉

---

## 2. 页面级信息架构原则

| 原则 | 说明 |
|---|---|
| Hero 优先 | 页面顶部用 StatusHero 说明当前状态和主操作 |
| 分组清晰 | 相关内容用 SettingGroup 聚合 |
| 行一致性 | 每行左说明右状态/操作（SettingRow） |
| 操作聚合 | 多按钮用 ActionCluster 统一排列 |
| 高级折叠 | 技术细节放高级诊断或折叠区 |
| 空状态引导 | 数据为空时告诉用户下一步做什么 |
| 主操作首屏可见 | 不要让用户滚动才能找到关键按钮 |

---

## 3. StatusHero 使用规范

**适用场景**：需要向用户展示核心状态和主操作的页面

**Props**：

| Prop | 类型 | 说明 |
|---|---|---|
| `title` | string | 主标题，描述当前状态 |
| `subtitle` | string | 副标题/状态说明 |
| `statusLabel` | string | 状态 badge 文字 |
| `statusTone` | "success"\|"warning"\|"danger"\|"muted" | 状态颜色 |
| `modelLabel` | string | 当前模型名（可选） |
| `primaryAction` | ReactNode | 主操作区（建议用 ActionCluster） |
| `secondaryAction` | ReactNode | 次操作 |
| `children` | ReactNode | 额外内容（如异常提示） |

**使用模板**：

```tsx
<StatusHero
  title="AI 助手已连接"
  subtitle="可以开始对话和处理任务。"
  statusLabel="已连接"
  statusTone="success"
  modelLabel="DeepSeek V4 Pro"
  primaryAction={<ActionCluster>...</ActionCluster>}
>
  {/* amber warning children when applicable */}
</StatusHero>
```

**状态自适应规则**：参考 TASK-042F — 不同状态（已连接/需要启动/需要检查/检测中）使用不同 title/subtitle/主按钮组合。

**视觉**：`rounded-3xl`，`shadow-sm`，`bg-gradient-to-br from-card via-card to-muted/20`，`p-6`

---

## 4. SettingGroup 使用规范

**适用场景**：任何需要分组展示设置项/状态项的页面

**Props**：

| Prop | 类型 | 说明 |
|---|---|---|
| `title` | string | 组标题 |
| `description` | string | 组描述（可选） |
| `action` | ReactNode | 组级操作（右上角）（可选） |
| `children` | ReactNode | SettingRow 列表 |

**使用模板**：

```tsx
<SettingGroup title="模型配置" description="填写密钥并选择档位。"
  action={<Button size="sm">保存</Button>}>
  <SettingRow ... />
  <SettingRow ... />
</SettingGroup>
```

**视觉**：`rounded-2xl`，`border border-border/60`，`bg-card`，`p-4`，内部 `divide-y divide-border/50`

---

## 5. SettingRow 使用规范

**适用场景**：设置组内的每一个配置/状态行

**Props**：

| Prop | 类型 | 说明 |
|---|---|---|
| `label` | string | 左侧标签 |
| `description` | string | 左侧说明（可选，可作错误/状态文字） |
| `value` | ReactNode | 右侧值显示 |
| `action` | ReactNode | 右侧操作按钮 |
| `tone` | "default"\|"success"\|"warning"\|"danger"\|"muted" | 状态色调 |

**使用模板**：

```tsx
<SettingRow label="本地服务" value={<span className="font-medium text-emerald-600">运行中</span>} tone="success" />
<SettingRow label="模型访问密钥" description="输入密钥后保存。"
  value={<Input type="password" className="w-44" />} />
<SettingRow label="" action={<Button size="sm">保存配置</Button>} />
```

**视觉**：`flex justify-between gap-3 py-2.5`，左侧带可选 `h-1.5` dot

---

## 6. ActionCluster 使用规范

**适用场景**：多处按钮需要统一排列时

**Props**：

| Prop | 类型 | 说明 |
|---|---|---|
| `children` | ReactNode | 按钮列表 |
| `align` | "left"\|"right" | 靠左还是靠右 |

**使用模板**：

```tsx
<ActionCluster>
  <Button size="sm">主操作</Button>
  <Button size="sm" variant="outline">次操作</Button>
  <button className="text-xs text-muted-foreground underline">弱操作</button>
</ActionCluster>
```

**视觉**：`flex flex-wrap gap-2`，`align === "right"` 时 `justify-end`

---

## 7. 卡片 / 圆角 / 阴影 / 边框规范

| 元素 | 规范 |
|---|---|
| Hero 卡片 | `rounded-3xl`，`shadow-sm`，`border-border/60` |
| 设置分组 | `rounded-2xl`，`border-border/60`，无阴影 |
| 信息卡片（排行等） | `rounded-2xl`，`border-border/50`，hover 时 `border-primary/30` |
| toast 容器 | `rounded-lg`，`shadow-lg` |
| 操作按钮 | `rounded-full`（主操作）/ `rounded-lg`（卡片内按钮） |

---

## 8. 状态 badge / dot 规范

| 状态 | tone | dot 颜色 | badge 样式 |
|---|---|---|---|
| 成功/已连接/已配置 | success | `bg-emerald-500` | `border-emerald-500/30 bg-emerald-500/10 text-emerald-700` |
| 警告/需要检查 | warning | `bg-amber-500` | `border-amber-500/30 bg-amber-500/10 text-amber-700` |
| 错误/未运行 | danger | `bg-rose-500` | `border-rose-500/30 bg-rose-500/10 text-rose-700` |
| 中性/未知 | muted | `bg-slate-400` | `border-border bg-muted/40 text-muted-foreground` |

---

## 9. 按钮层级规范

| 层级 | 样式 | 使用场景 |
|---|---|---|
| 主操作 | `variant="default"` / `className` primary | 关键操作：一键启用、启动、开始对话 |
| 次操作 | `variant="outline"` | 辅助操作：重新检查、打开控制台 |
| 弱操作 | `variant="ghost"` / link | 高级诊断、取消 |
| 危险操作 | `variant="destructive"` | 停止生成、删除 |

---

## 10. Toast / inline error 规范

| 反馈 | 方式 | 示例 |
|---|---|---|
| 操作成功（轻） | Toast success | "配置已保存" |
| 操作失败（轻） | Toast error | "无法打开控制台" |
| 关键失败 | Inline red + Toast error | 启动失败、写入失败 |
| 信息提示 | Toast info | "正在检查..." |

---

## 11. 空状态规范

- 有明确标题（如"暂未安装能力"）
- 有行动引导（如"从能力排行中选择能力安装"）
- 不曝露技术词

---

## 12. loading / disabled 规范

- loading 状态统一 `Loader2 className="h-4 w-4 animate-spin"`
- 小按钮可用 `h-3.5 w-3.5`
- loading 时按钮 `disabled`，防止重复点击
- 阶段文案清楚（保存中.../启动中.../检查中...）

---

## 13. 移动端 / 小屏响应式规范

- SettingRow 窄屏时内容可纵向堆叠
- Hero 按钮可换行（ActionCluster `flex-wrap`）
- 卡片不设固定宽度（用 max-w 代替）
- 小屏不丢失关键信息

---

## 14. 不适合强行统一的页面

| 页面 | 原因 |
|---|---|
| AI 对话页 | 聊天优先，不套 SettingGroup |
| 摸鱼中心 | 保持轻松氛围，不做系统设置化 |
| 能力排行列表 | 保留卡片浏览，不改成设置行 |

---

## 15. 后续页面升级顺序

| 批次 | 优先级 | 任务 | 页面 | 风险评估 |
|---|---|---|---|---|
| 1 | P2 | TASK-043E | 关于页 | 最低风险，验证 SettingGroup 在非配置页的效果 |
| 2 | P2 | TASK-043C | 本地用量概览 | 高收益，统计区改 dashboard |
| 2 | P2 | TASK-043D | 助手记忆 | 修复 P2 残留"本地助手记忆记忆" |
| 2 | P2 | TASK-043B | 首页 | 高收益，顶部 Hero 升级 |
| 3 | P3 | TASK-043F | 能力中心顶部 | 谨慎，只改顶部不改卡片 |
| 3 | P3 | TASK-043G | 文件库/教程 | 轻量对齐 |

**推荐第一步**：TASK-043E 关于页低风险试点

---

## 16. 摸鱼中心 iOS widget 风格实践（TASK-044D）

摸鱼中心不套 SettingGroup/SettingRow，采用独立的 widget 风格：

### 结构

```
轻量 Hero（rounded-3xl gradient）
  └─ 图标 + 标题 + badge + 副标题
  └─ 主操作（随机 / 去对话）

Widget Grid（grid-cols-1 sm:grid-cols-3 gap-3）
  ├─ 大 widget（sm:col-span-2）
  │   └─ 图标容器 + 标题 + 描述 + 内部元素 + 按钮
  ├─ 中 widget
  │   └─ 图标容器 + 标题 + 描述 + 列表
  └─ 小 widget ×3
      └─ 图标容器 + 标题 + 描述 + 轻标签

安全提示（rounded-2xl muted）
```

### 视觉令牌

| 元素 | 规范 |
|---|---|
| Hero | `rounded-3xl` `shadow-sm` `bg-gradient-to-br from-sky-50/60 via-background to-amber-50/40` `p-6` |
| 大 widget | `rounded-3xl` `shadow-sm` `bg-gradient-to-br from-violet-50/70 via-background to-background` `p-5` |
| 中 widget | `rounded-3xl` `shadow-sm` `bg-gradient-to-br from-amber-50/60 via-background to-background` `p-5` |
| 小 widget | `rounded-3xl` `shadow-sm` `bg-gradient-to-br from-xxx-50/60 via-background to-background` `p-4` |
| 图标容器 | `h-9/10 w-9/10` `rounded-2xl` `bg-xxx-500/10` |
| hover | `transition-all hover:shadow-md hover:-translate-y-0.5` |
| 轻标签 | `rounded-lg bg-xxx-500/10 px-2 py-1 text-[11px] font-medium text-xxx-600` |

### 原则

- 轻松但不幼稚：文案自然，不用 sticker 风
- 精致但不花哨：柔和渐变 + 轻阴影，不用强毛玻璃/复杂动画
- 整体可点击：widget div 带 `cursor-pointer` + `onClick`，内部按钮同行为不冲突
- 不引入新 UI 库：纯 Tailwind + lucide-react

---

## 17. AI 对话页 polish 经验（TASK-044E）

AI 对话页保持聊天专注，不套 SettingGroup/StatusHero，只做局部视觉 polish：

### 空状态

| 元素 | 规范 |
|---|---|
| 图标容器 | `rounded-3xl` `shadow-sm` `bg-primary/10` `h-14 w-14` |
| 标题 | `text-lg font-semibold tracking-tight` |
| chips | `rounded-2xl border border-border/60 bg-card` + icon 容器 `rounded-xl bg-muted/60` |
| chip hover | `hover:border-primary/30 hover:bg-primary/[0.03] hover:shadow-sm active:scale-[0.99]` |
| 轻提示 | `text-[11px] text-muted-foreground/50` "不会自动发送" |

### 消息气泡

| 元素 | 规范 |
|---|---|
| 用户消息 | `rounded-2xl rounded-br-md bg-primary text-primary-foreground shadow-sm max-w-[70%]` |
| AI 消息 | `rounded-2xl rounded-bl-md border border-border/50 bg-card text-foreground shadow-sm max-w-[720px]` |
| 对话感圆角 | 用户右下角收紧 `rounded-br-md`，AI 左下角收紧 `rounded-bl-md` |

### 消息操作区

| 元素 | 规范 |
|---|---|
| 默认态 | `opacity-0`（不干扰阅读） |
| hover 态 | `group-hover:opacity-100 transition-opacity` |
| 按钮样式 | 原生 `button`（非 Button 组件），`h-7 w-7 rounded-lg text-muted-foreground/60 hover:bg-muted hover:text-foreground` |
| 已复制反馈 | `text-[10px] font-medium text-emerald-600` |
| 元信息分隔 | `text-muted-foreground/30` "·" |

### 输入区

| 元素 | 规范 |
|---|---|
| 容器 | `rounded-2xl border border-border/40 bg-card/90 shadow-sm` |
| focus 态 | `focus-within:border-primary/30 focus-within:shadow-md transition-colors` |
| textarea | `border-0 bg-transparent focus-visible:ring-0 disabled:opacity-50` |
| 发送/停止 | `rounded-full shadow-sm` |

### 原则

- **不改业务逻辑**：send/stop/retry/regen/streaming/usage 全保留
- **只做 className**：不改消息数据结构、不改渲染 key、不改请求流程
- **操作区弱化**：默认隐藏，hover 才显示，保持阅读专注
- **按钮轻量化**：消息操作区用原生 button 替代 Button 组件，避免多余 padding 和默认样式
- **语义正确**：避免 interactive 元素嵌套（如可点击 div 内不再放 Button）

---

## 18. TASK-044 系列最终收口经验

### 10 页高要求视觉升级达成

| 页面 | 改造任务 | 风格 | 风险 |
|---|---|---|---|
| 首页 | 043B | StatusHero + 9 入口 dashboard | 低 |
| AI 助手 | 042 | StatusHero + SettingGroup | 低 |
| 关于 | 043E | StatusHero + SettingGroup | 最低 |
| 用量概览 | 043C | StatusHero + dashboard tile | 低 |
| 助手记忆 | 043D | StatusHero + SettingGroup | 低（曾出 P1：SettingRow onClick） |
| 能力中心 | 044F | StatusHero + 卡片 polish | 中（紧邻 install/uninstall） |
| 文件库 | 044B | StatusHero + 表格容器 | 中（表格交互多） |
| 教程 | 044C | StatusHero + SettingGroup | 最低（纯展示） |
| 摸鱼中心 | 044D | iOS widget grid | 低（轻量休息） |
| AI 对话 | 044E | 消息气泡/输入区 polish | 中（最敏感） |

### 关键教训

1. **043D P1 教训**：SettingRow 从 div 改为支持 onClick 时，必须确保 props 透传完整。重构组件时必查可点击元素。
2. **044F P3 教训**：Badge 条件渲染时，空字符串 fallback 会产生视觉缺陷（空 pill）。应使用条件渲染 `condition && <Badge>` 而非 `""` fallback。
3. **044D P3 教训**：可点击 div 内部不应嵌套真实 `<Button>`（HTML 语义瑕疵）。改用 styled span 或确保 Button 有独立 onClick + stopPropagation。
4. **044E P3 教训**：unused import 及时清理；原生 button 在表单外也应补 `type="button"` 以防未来变动。
5. **保守策略正确**：044B 文件库保留 Table 结构只换顶部，044F 能力中心只改卡片展示层——都成功避开了"重构丢交互"风险。

### 验证清单（每次子任务后必做）

- [ ] `npm run build` 通过
- [ ] `cargo check` 通过
- [ ] `node scripts/test-redaction.mjs` 21/21 通过
- [ ] 该页核心交互冒烟（逐一核验可点击元素）
- [ ] 技术词扫描（普通 UI 无 OpenClaw/Gateway/provider/baseUrl 暴露）
- [ ] 敏感信息扫描（无 token/URL/密钥泄露）
