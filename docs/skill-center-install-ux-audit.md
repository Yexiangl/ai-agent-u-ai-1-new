# 能力中心安装体验与排行可信度审计

TASK-035A | TASK-035B | TASK-035C ✅ 已完成 | 日期：2026-05-29

---

## 1. 当前问题总结

能力中心安装功能"能用但不够可信/不够流畅"：

| 问题 | 严重度 | 说明 |
|---|---|---|
| 卡片无原生名称 | P0 | 用户不知道实际安装的是 `clawhub:file-summary` 还是别的 |
| 卡片无安装口令 | P0 | 用户无法验证安装的是什么 |
| 确认弹窗信息不完整 | P1 | 只有显示名/来源/风险/权限，缺原生名称和安装命令 |
| 安装 loading 只有按钮状态 | P1 | 无分阶段文案，用户不知道进度 |
| 卸载无确认弹窗 | P1 | 直接卸载，无二次确认 |
| 安装失败反馈不够清楚 | P2 | 只显示"安装失败：..."，无修复建议 |
| 已安装状态不够完整 | P2 | 只有"卸载"按钮，无安装时间/版本 |
| 排行可能误导安全 | P2 | 虽有免责，但排名 badge 仍可能暗示推荐 |

---

## 2. 能力卡片信息结构建议

### 2.1 当前数据结构

```typescript
{
  id: "ext-file-summary",
  name: "文件总结",           // 显示名称
  desc: "...",
  source: "clawhub",         // 来源标识
  kind: "skill",             // 类型
  category: "文件处理",
  risk: "medium",
  perms: ["file_read"],
  publisher: "ClawHub",      // 发布者
  rank: 1,
  rankGroup: "hot"
}
```

**缺失字段**：
- `nativeName`：原生名称（如 `clawhub:file-summary`）
- `installCommand`：安装命令（如 `openclaw skills install clawhub:file-summary`）

### 2.2 建议数据结构

```typescript
{
  id: "ext-file-summary",
  name: "文件总结",                          // 显示名称
  nativeName: "clawhub:file-summary",       // 原生名称 / slug
  installCommand: "openclaw skills install clawhub:file-summary",  // 完整安装命令
  desc: "...",
  source: "clawhub",
  kind: "skill",
  category: "文件处理",
  risk: "medium",
  perms: ["file_read"],
  publisher: "ClawHub",
  rank: 1,
  rankGroup: "hot"
}
```

### 2.3 卡片轻量显示

| 字段 | 显示 |
|---|---|
| 显示名称 | 标题 |
| 原生名称 | 副标题（灰色小字） |
| 来源 | Badge |
| 类型 | Badge（工作流/插件） |
| 风险 | Badge |
| 权限 | 一行摘要 |
| 排行标签 | Badge |
| 安装状态 | 按钮 |

### 2.4 安装确认弹窗完整显示

| 字段 | 显示 |
|---|---|
| 显示名称 | 标题 |
| 原生名称 | 副标题 |
| 安装命令 | 代码块（只读） |
| 来源 | Badge |
| 类型 | Badge |
| 风险等级 | Badge |
| 权限 | 列表 |
| 免责声明 | 警告框 |
| 二次确认 | checkbox（高风险/未验证） |

---

## 3. 安装确认弹窗方案

### 3.1 当前弹窗内容

```
[名称 Badge] [来源 Badge] [风险 Badge]
权限：文件读取、网络访问
免责声明：第三方能力可能访问文件...
□ 我已了解...
[确认安装] [取消]
```

### 3.2 建议弹窗内容

```
安装能力

文件总结
clawhub:file-summary

┌─────────────────────────────────┐
│ openclaw skills install         │
│ clawhub:file-summary            │
└─────────────────────────────────┘

来源：ClawHub    类型：工作流    风险：需注意

权限：文件读取

⚠️ 安装须知
第三方能力可能访问文件、联网或执行命令。
请仅安装你信任的来源。

□ 我已了解该能力的权限范围（高风险/未验证时）

[确认安装] [取消]
```

---

## 4. 安装 loading 方案

### 4.1 状态机

```
idle → confirming → installing → refreshing → installed
                                            → failed
```

### 4.2 文案

| 状态 | 按钮文案 | 弹窗/卡片文案 |
|---|---|---|
| idle | 安装 | — |
| confirming | — | 安装确认弹窗 |
| installing | 安装中... | 正在调用 OpenClaw 安装... |
| refreshing | 更新中... | 正在更新安装状态... |
| installed | 已安装 ✓ → 卸载 | 安装完成 |
| failed | 重试 | 安装失败，请检查本地服务状态 |

### 4.3 安装失败修复建议

| 失败原因 | 建议 |
|---|---|
| CLI 不可用 | 请确认 OpenClaw 已安装 |
| Gateway 未运行 | 请先启动本地服务 |
| 网络问题 | 请检查网络连接 |
| 未知错误 | 请前往 AI 助手页诊断 |

---

## 5. 卸载体验方案

### 5.1 当前

点击"卸载"→ 直接执行 → 成功/失败

### 5.2 建议

点击"卸载"→ 确认弹窗 → 执行 → 成功/失败

确认弹窗：
```
确认卸载

确定要卸载"文件总结"（clawhub:file-summary）吗？

卸载后：
- 该能力将不再可用
- 不会删除你的对话和项目数据
- 可以随时重新安装

[确认卸载] [取消]
```

### 5.3 卸载状态

| 状态 | 按钮文案 |
|---|---|
| idle | 卸载 |
| confirming | 确认卸载弹窗 |
| uninstalling | 卸载中... |
| uninstalled | 安装（恢复） |
| failed | 卸载失败，重试 |

---

## 6. 安全边界

### 必须保留

| 项 | 说明 |
|---|---|
| Rust allowlist | 只能安装 9 项硬编码能力 |
| 不拼接用户输入 | installRef 来自 allowlist |
| 不暴露 stderr | 错误信息使用 fixed message |
| 不输出 Token | 安装记录不含 Token/provider/baseUrl |
| 高风险二次确认 | checkbox 必须勾选 |
| 排行免责 | "排行仅用于浏览参考，不代表安全性" |
| 脱敏 | 安装失败信息不暴露内部路径 |

### 新增安全要求

| 项 | 说明 |
|---|---|
| 安装命令只读展示 | 用户不能编辑安装命令 |
| 原生名称不可修改 | 前端展示，不参与安装逻辑 |
| 卸载确认 | 防止误操作 |

---

## 7. 后续任务拆分

| Task ID | 优先级 | 内容 | 预估 |
|---|---|---|---|
| TASK-035B | P0 | 能力卡片信息结构优化（加 nativeName/installCommand） | 1h |
| TASK-035C | P1 | 安装确认弹窗重构（展示原生名称+安装命令+完整信息） | 1.5h |
| TASK-035D | P1 | 安装/卸载 loading 与反馈优化（状态机+分阶段文案） | 1h |
| TASK-035E | P2 | 已安装状态 polish（安装时间/版本/来源） | 0.5h |
| TASK-035F | P2 | 能力中心安装体验回归测试 | 0.5h |

### 推荐执行顺序

1. TASK-035B ✅ — 数据结构先行，card + dialog 均显示 nativeName/installCommand
2. TASK-035C ✅ — 安装确认弹窗重构，source 不一致修复
3. TASK-035D — loading 与反馈
4. TASK-035E — 已安装状态
5. TASK-035F — 回归测试
