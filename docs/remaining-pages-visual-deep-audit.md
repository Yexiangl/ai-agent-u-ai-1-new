# 剩余页面 UI 深度审计与高要求视觉打磨计划

TASK-044A | 日期：2026-05-30 | 只做审计，不改业务代码。

用户要求：不以"能内测"为收口标准，继续高标准打磨全项目视觉，不漏每个页面和细节。

---

## 1. 总体结论

043 系列把 6 个页面接入了 StatusHero/SettingGroup 体系，但 TASK-043G 对**文件库/教程/摸鱼/对话**只做了"轻量对齐/保留现状"——以"功能没坏"为标准，没有按"高要求产品视觉"打磨。

深度审计后，按"草台班子感"从重到轻排序：

1. **文件库**：最需要升级。纯 Card 标题 + 原始 HTML 表格，像文件调试页，不像产品页。
2. **教程**：第二需要。一行式 Card 堆叠，无 Hero、无结构、无主路径。
3. **能力中心卡片**：顶部已升级（043F），但卡片本身 badge 偏多、层级偏平。
4. **摸鱼中心**：已较精致，但圆角令牌不统一（rounded-xl vs 体系 2xl/3xl），顶部非 Hero。
5. **AI 对话页**：最成熟，空状态/输入区已不错，仅需微 polish。

结论：**用户判断准确**，文件库和教程确实还停留在旧版水平，应继续打磨。

---

## 2. 已完成 vs 仍需深度打磨

| 状态 | 页面 |
|---|---|
| 已达高级感（043 升级） | AI 助手、关于、用量概览、助手记忆、首页 |
| 顶部升级但卡片待打磨 | 能力中心 |
| 较精致但需一致性 polish | 摸鱼中心 |
| 成熟仅需微调 | AI 对话 |
| **仍像旧版，需深度升级** | **文件库、教程** |

---

## 3. 全页面评分表

评分 1-5（5 最佳）。"达标"= 是否已达用户高要求。

| 页面 | 视觉高级感 | 信息层级 | 交互反馈 | 一致性 | 达标 | 建议任务 | 风险 |
|---|---|---|---|---|---|---|---|
| 首页 | 4 | 4 | 4 | 5 | ✅ | — | — |
| AI 助手 | 5 | 5 | 5 | 5 | ✅ | — | — |
| 关于 | 4 | 4 | 4 | 5 | ✅ | — | — |
| 用量概览 | 4 | 4 | 4 | 5 | ✅ | — | — |
| 助手记忆 | 4 | 4 | 4 | 5 | ✅ | — | — |
| AI 对话 | 4 | 4 | 4 | 4 | 基本 | 044E 微 polish | 中 |
| 能力中心 | 3 | 3 | 4 | 3 | ⚠️ | 044F 卡片 polish | 中 |
| 摸鱼中心 | 3 | 4 | 4 | 3 | ⚠️ | 044D widget 化 | 低 |
| 教程 | 2 | 2 | 2 | 2 | ❌ | 044C 深度升级 | 低 |
| 文件库 | 2 | 3 | 3 | 2 | ❌ | 044B 深度升级 | 中 |

---

## 4. 文件库深度审计

当前（L3847-3937）：纯 `<Card>` 标题 + 5 个 Metric tiles + 分类按钮 + 原始 HTML `<Table>`。

| 维度 | 现状 | 问题 |
|---|---|---|
| 顶部 | 普通 Card 标题 | 无 StatusHero，无状态总览 |
| 统计 | 5 个 Metric tile | 尚可，但与新 tile 风格（rounded-xl bg-muted/20）不统一 |
| 文件列表 | HTML 表格 tr/Td | 像调试页，移动端易炸，无 hover 高级感 |
| 空状态 | 基本文字 | 无插画/图标，偏简陋 |
| 路径复制 | ghost 按钮仅图标 | 反馈弱（只一个 Copy 图标，"已复制"几乎不可见） |
| 文件类型 | extension Badge | 可视化弱，无类型图标 |

建议方向（TASK-044B）：
- 顶部 StatusHero："文件库" + 总数 badge + 上传/刷新 action
- 统计 tiles 改用体系 rounded-xl tile
- 文件列表：桌面保留紧凑表格但加 row hover，移动端转卡片；或统一文件卡片 grid
- 文件类型 badge 配类型图标（图片/文档/视频/表格）
- 空状态升级：图标 + 引导上传按钮
- 路径复制反馈强化（toast 或明确"已复制"态）
- 操作按钮区视觉统一

边界：不改 listAiFiles/extractAiFileText/upload/preview 逻辑。

---

## 5. 教程深度审计

当前（L4505-4506）：单行 JSX，`tutorials.map` → 每个一个 Card（标题+步骤 1/2/3）+ 售后 QQ Card。

| 维度 | 现状 | 问题 |
|---|---|---|
| 顶部 | 无 | 无 Hero，无页面定位 |
| 结构 | 平铺 Card | 无新手/常见问题/进阶分区 |
| 步骤卡 | 数字徽章+文字 | 基础，无 timeline 感、无主路径引导 |
| 主路径 | 无 | 没有"第一步该做什么"的引导 |
| 售后 | 纯文字 QQ | 偏简陋 |
| 视觉 | 像说明文本堆叠 | 不像正式教程页 |

建议方向（TASK-044C）：
- 顶部 TutorialHero："使用教程" + 简介 + "新手必看"主路径按钮
- 新手路径用 timeline / 步骤进度视觉
- 分区：新手必看 / 常见问题(FAQ) / 进阶说明
- 步骤卡升级（连接线/编号圆点 timeline）
- "下一步"按钮聚合（跳到 AI 助手页/对话页）
- 售后联系卡片化（图标 + 复制 QQ）

边界：纯展示页，无业务逻辑，风险最低。tutorials 数据结构可保留或小幅扩展。

---

## 6. 摸鱼中心深度审计

当前（L3999-4093）：居中 h1 + 渐变 Hero（摸鱼指数 72% 等 3 tile）+ 桌宠/休息任务卡 + 3 个紧凑卡。

| 维度 | 现状 | 问题 |
|---|---|---|
| 氛围 | 轻松渐变，文案有趣 | ✅ 已不错，保留 |
| 顶部 | 居中 h1 + 自定义渐变块 | 与体系 Hero 不统一（非 StatusHero，合理但可更精致） |
| 卡片圆角 | rounded-xl/lg | 与体系 rounded-2xl 不统一 |
| hover | 已有 hover:border-primary | ✅ 基本到位 |
| 小组件感 | 部分 tile 化 | 可更像 iOS 控制中心 widget |

建议方向（TASK-044D，轻度）：
- 不套 SettingGroup（正确）
- 圆角/阴影令牌向体系靠拢（rounded-2xl）
- 摸鱼指数等做成更精致的 iOS widget 卡（进度环/柔和底色）
- 卡片 hover/active 微动效统一
- 情绪化文案保留，避免幼稚

边界：保留轻松定位，不过度系统化。风险最低。

### TASK-044D 执行结果（2026-05-31）

已升级为 iOS widget / 控制中心风格：

- **顶部轻量 Hero**：Sparkles 图标 + 标题 + emerald"轻量休息"badge + 副标题 +"随机来一个"/"去 AI 对话"双操作
- **Widget Grid**：
  - 大 widget（col-span-2）：桌宠陪伴（violet 渐变 + Bot 图标 + 引用 bubble）
  - 中 widget：快速放松（amber 渐变 + Coffee 图标 + 3 条任务）
  - 小 widget×3：今日状态（sky）、随机冷知识（emerald）、今日成就（rose）
- **视觉统一**：全部 rounded-3xl、柔和渐变、shadow-sm→hover:shadow-md、hover:-translate-y-0.5、图标容器 rounded-2xl bg-xxx-500/10
- **文案优化**："桌宠陪伴"/"快速放松"/"今日状态"/"随机冷知识"/"今日成就"
- **交互保留**：5 个 widget 全部 onClick→jumpToChat、随机 prompt、安全提示 intact
- **未套 SettingGroup/SettingRow**：保持轻松氛围
- **044F P3 修复**：high_risk 不渲染空排行 badge

评分更新：视觉 3→4、一致性 3→4、信息层级 4→4、交互 4→4。

---

## 7. AI 对话页深度审计

当前：空状态（L3057-3077）已有图标+标题+建议 chips；输入区（L3209-3219）auto-resize Textarea + 附件 + disabled 态成熟。

| 维度 | 现状 | 问题 |
|---|---|---|
| 空状态 | 图标 badge + 标题 + 4 chips | ✅ 已较高级 |
| 输入区 | auto-resize + 附件 + 占位 | ✅ 成熟 |
| 消息气泡 | （需逐条核验统一度） | 可能 user/assistant 间距/圆角微调 |
| 操作按钮 | 复制/详情/重试（DetailsEntry 等） | 基本到位，复制反馈可更自然 |
| chips | rounded-xl border hover | ✅ 不错，可微调 |

建议方向（TASK-044E，微 polish）：
- 消息气泡圆角/间距统一巡检
- 复制反馈更自然（图标→对勾过渡）
- chips 视觉微调（hover 态）
- 输入区聚焦态/发送按钮 polish
- 严格不改 send/stop/retry/regenerate/stream 逻辑

边界：聊天专注优先，**绝不套设置组件**，只做局部视觉。风险中（对话区敏感）。

### TASK-044E 执行结果（2026-05-31）

AI 对话页精致化 polish 已完成，只改视觉不改逻辑：

- **空状态 polish**：
  - 图标容器改为 rounded-3xl + shadow-sm，更立体
  - 标题加 tracking-tight，更稳
  - 副标题更自然："直接提问，或选一个快捷提示填入输入框。"
  - chips 升级：加 icon（FileText/ListChecks/Bug/Wrench）+ 图标容器 rounded-xl bg-muted/60 hover:bg-primary/10 + hover shadow-sm + active scale-[0.99]
  - 底部轻提示："点击后只填入输入框，不会自动发送。"

- **消息气泡 polish**：
  - 用户消息：max-w-[65%]→70%，rounded-2xl rounded-br-md（对话感更强），bg-primary/85→bg-primary（更纯粹）
  - AI 消息：rounded-2xl rounded-bl-md，加 subtle border border-border/50，bg-muted/30→bg-card（更清晰）
  - 阴影：加 shadow-sm 让气泡有轻微浮起感

- **操作区 polish**：
  - 默认 opacity-0，group-hover 时才 opacity-100（更干净，不干扰阅读）
  - 所有操作按钮从 Button 组件改为原生 button（更轻，无 Button 默认 padding/margin）
  - 统一 rounded-lg + hover:bg-muted + hover:text-foreground
  - "已复制"反馈改为 font-medium text-emerald-600（更明显）
  - AI 消息元信息（来源/模型/耗时）加 "·" 分隔符，更清晰

- **输入区 polish**：
  - 外层容器加 focus-within:border-primary/30 focus-within:shadow-md（聚焦时更明显）
  - textarea disabled 态加 opacity-50
  - 发送/停止按钮加 shadow-sm（更统一）

- **044D P3 修复**：摸鱼中心大 widget 内嵌 Button→span（避免 interactive 嵌套）

评分更新：视觉 4→4（已达高要求）、交互 4→4、一致性 4→4。无需二次升级。

---

## 8. 能力中心卡片深度审计

当前（L3484-3514 排行卡 / L3628+ 已安装卡）：顶部已是 StatusHero（043F），但卡片本身。

| 维度 | 现状 | 问题 |
|---|---|---|
| 排行卡 | Card + 3+ Badge（分类/类型/风险） | badge 偏多，视觉噪音 |
| 已安装卡 | Card grid | 尚可，与排行卡风格略散 |
| details 折叠 | 原生 details/summary | 功能可用，但样式朴素 |
| 权限/风险 | Badge + 文字 | 可用更清楚的视觉语言（图标/色阶） |
| 安装按钮区 | Button + loading 文案 | 可更像应用市场 |

建议方向（TASK-044F，卡片 polish）：
- 卡片视觉层级：标题/描述/元信息分层更清楚
- badge 降噪：合并或弱化次要 badge，风险 badge 突出
- 权限/风险用图标 + 色阶语言
- details 折叠美化（自定义箭头/过渡）
- 安装按钮区统一成"应用市场"式
- **严格不改** install/uninstall/确认弹窗/高风险二次确认/Rust invoke/allowlist

边界：只动卡片展示层，风险中（紧邻安装逻辑，需 043D 式交互完整性核验）。

---

## 9. 高要求视觉打磨任务拆分

| Task | 优先级 | 内容 | 风险 | 可直接改 |
|---|---|---|---|---|
| TASK-044B | P1 | 文件库深度视觉升级 | 中 | 是（不碰文件逻辑） |
| TASK-044C | P1 | 教程页深度视觉升级 | 低 | 是 |
| TASK-044D | P2 | 摸鱼中心 widget 风格升级 | 低 | 是 |
| TASK-044E | P2 | AI 对话页精致化 polish | 中 | 谨慎 |
| TASK-044F | P2 | 能力中心卡片深度 polish | 中 | 谨慎 |
| TASK-044G | P1 | 全页面高要求视觉回归 | 低 | 验证 |

是否还有其他页面需二次 polish：
- 首页/用量/记忆/关于/AI 助手已达标，无需二次。
- 若 044B-F 引入新 tile/卡片样式，建议同步更新 043A 规范文档（可并入 044G 或单列 044H 文档更新）。

---

## 10. 风险与边界

| 边界 | 要求 |
|---|---|
| AI 对话发送逻辑 | 不改（044E 仅视觉） |
| token/config 写入 | 不改 |
| 能力安装/卸载 + allowlist | 不改（044F 仅卡片展示） |
| usage 统计 | 不改 |
| memory 读取/脱敏 | 不改 |
| 文件 listAiFiles/extract/upload | 不改（044B 仅展示） |
| .env | 不读 |
| token | 不输出 |
| 新 UI 库 | 不引入（除非单独论证） |
| 强行统一 | 禁止（摸鱼/对话保持各自定位） |
| 交互完整性 | 重构组件时必查可点击元素（吸取 043D P1 教训） |

---

## 11. 推荐执行顺序

按"草台班子感最重 + 风险可控"优先：

1. **TASK-044C 教程**（风险最低，纯展示，收益高，先验证升级模式）
2. **TASK-044B 文件库**（收益最高，需小心表格→卡片转换的交互完整性）
3. **TASK-044F 能力中心卡片**（紧邻安装逻辑，按 043D 教训核验交互）
4. **TASK-044D 摸鱼中心**（轻度，一致性 polish）
5. **TASK-044E AI 对话**（最敏感，最后做，最小改动）
6. **TASK-044G 全页面高要求视觉回归**（收口）

每个子任务完成后：build + cargo check + redaction 21/21 + 该页交互冒烟 + 技术词扫描。

特别提醒：044B（表格→卡片）和 044F（卡片重排）有 043D 式"重构丢交互"风险，复审时务必逐一核验可点击元素（上传/预览/打开位置/用于分析/安装/卸载）行为保留。

---

## 12. TASK-044G 全页面回归结果（2026-05-31）

### 044E P3 清理

- **P3-1**：删除 unused `PenLine` import（src/App.tsx:27）
- **P3-2**：8 个 Chat 消息操作区原生 button 补 `type="button"`

### 10 页回归逐一核验

| 页面 | 044 改造 | 核心交互核验 | 结果 |
|---|---|---|---|
| 首页 | 043B StatusHero | 9 入口 route 匹配 nav，最近会话 → chat | ✅ |
| AI 对话 | 044E polish | send/stop/retry/regen/stream/usage 未改，chips 只 setInput，P3 已清 | ✅ |
| AI 助手 | 043A 规范 | handleStartGateway/saveConfig/一键启用完整，StatusHero 四态 | ✅ |
| 能力中心 | 044F 卡片 | install/uninstall/二次确认/details 全 intact，044F P3 badge 仍修复 | ✅ |
| 本地用量 | 043C StatusHero | usage 统计未改，无余额误导 | ✅ |
| 助手记忆 | 043D StatusHero | 文件列表 onClick，只读预览，脱敏 | ✅ |
| 文件库 | 044B 深度 | 上传/预览/打开位置/复制/用于分析/删除 intact | ✅ |
| 教程 | 044C 深度 | 3 SettingGroup + FAQ 准确，无自动动作 | ✅ |
| 关于 | 043E 规范 | clearConfig 确认弹窗，无技术词 | ✅ |
| 摸鱼中心 | 044D widget | 5 widget onClick→jumpToChat，不自动发送，044D P3 已修 | ✅ |

### 全局检查

- **技术词**：普通 UI 无 OpenClaw/Gateway/provider/baseUrl/API URL 暴露 ✅
- **敏感信息**：无 token/URL/密钥泄露到 UI ✅
- **P0/P1**：无 ✅

### 验证

- `npm run build` ✅
- `cargo check` ✅
- `node scripts/test-redaction.mjs` 21/21 ✅
- `node scripts/openclaw-http-api-probe.mjs` ✅

### 结论

TASK-044 阶段性收口，10 页视觉升级达标，无 P0/P1，建议进入内测准备。
