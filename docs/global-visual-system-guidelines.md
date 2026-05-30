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
