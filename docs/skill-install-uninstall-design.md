# Skill Center 一键安装与卸载能力设计

TASK-027C-A：SkillHub / ClawHub 一键安装与卸载能力调研。

日期：2026-05-28 | 本轮只做调研和方案设计，不执行安装/卸载。

---

## 1. 结论摘要

| 问题 | 结论 |
|---|---|
| 能否做一键安装 | ✅ 可以。OpenClaw 原生支持 `openclaw skills install <slug>` 和 `openclaw plugins install <package>` |
| 能否做卸载 | ⚠️ 部分支持。Skills 可通过删除 `~/.openclaw/skills/<slug>` 卸载；Plugins 可通过 `openclaw plugins uninstall <name>` 或删除目录 |
| 推荐数据源 | **ClawHub** 作为主数据源（官方 registry，有分类/排序/版本），SkillHub 作为中文补充源 |
| 最大风险 | 第三方 plugin 可执行任意代码（Code Plugin）；安装前必须展示权限和风险等级 |

### 关键发现

1. **ClawHub** (clawhub.ai) 是 OpenClaw 官方 registry，当前有 100+ plugins 和 skills
2. **OpenClaw CLI** 原生支持：`openclaw skills search/install/update` 和 `openclaw plugins install/uninstall`
3. **SkillHub** (skillhub.cn) 是中国用户优化的社区，内容较少，可能是 SPA 需要 API
4. **本地目录**：`~/.openclaw/skills/` 存放已安装 skills，plugins 通过 config 管理
5. **Plugin 类型**：Code Plugin（可执行代码）和 Bundle Plugin（打包资源）
6. **安装命令格式**：`openclaw plugins install clawhub:<publisher>/<name>` 或 `npm:<package>`

---

## 2. 数据源方案

| 来源 | 优点 | 缺点 | 是否适合一键安装 |
|---|---|---|---|
| ClawHub (clawhub.ai) | 官方 registry；有分类/排序/版本；100+ plugins；支持 CLI install | 需要网络；无公开 REST API 文档（需探测） | ✅ 首选 |
| SkillHub (skillhub.cn) | 中文优化；面向国内用户 | 内容少；SPA 渲染；无明确 API | ⚠️ 补充源 |
| OpenClaw CLI | 原生支持 search/install/update；本地执行 | 依赖 OpenClaw 已安装；命令行输出需解析 | ✅ 安装执行层 |
| 本地 curated catalog | 可控；无网络依赖；可预审安全 | 需要维护；覆盖面有限 | ✅ 推荐白名单 |
| 本地已安装目录 | 真实状态；无网络 | 只能读取已安装，不能发现新 skill | ✅ 状态读取 |

### 推荐架构

```
┌─────────────────────────────────────────────┐
│ Skill Center UI                             │
├─────────────────────────────────────────────┤
│ 内置工作流 │ 已安装 Skills │ 可安装 Skills │
│ (本地 prompt)│ (本地目录)    │ (ClawHub)     │
└──────┬──────┴──────┬────────┴──────┬────────┘
       │             │               │
  src/data/     openclaw skills   ClawHub API
  skills.ts     list --json       或 CLI search
```

---

## 3. 一键安装流程

### Skills 安装

```
1. 用户在 Skill Center 点击"安装"
2. 前端调用 Rust command → `openclaw skills install <slug>`
3. Rust command 执行 CLI，捕获 stdout/stderr
4. 安装成功 → 写入本地安装记录 (installed-skills.json)
5. 刷新已安装列表
6. 安装日志通过 redactSensitive 脱敏后展示
```

### Plugins 安装

```
1. 用户在 Skill Center 点击"安装"
2. 展示权限摘要和风险等级
3. 高风险 plugin 需要二次确认
4. 前端调用 Rust command → `openclaw plugins install clawhub:<publisher>/<name>`
5. Rust command 执行 CLI，捕获 stdout/stderr
6. 安装成功 → 写入安装记录
7. 提示用户重启 Gateway 以加载新 plugin
8. 安装日志脱敏
```

### 安装状态记录

存储位置：`app_data_root()/installed-skills.json`

```json
{
  "skills": [
    { "slug": "example-skill", "version": "1.0.0", "installedAt": 1716900000, "source": "clawhub" }
  ],
  "plugins": [
    { "name": "@publisher/plugin", "version": "2.0.0", "installedAt": 1716900000, "source": "clawhub" }
  ]
}
```

---

## 4. 卸载流程

### Skills 卸载

```
1. 用户点击"卸载"
2. 显示将删除的文件：~/.openclaw/skills/<slug>/
3. 用户确认
4. Rust command 删除目录（或调用 openclaw skills uninstall 如果可用）
5. 从安装记录移除
6. 刷新状态
7. 卸载日志脱敏
```

### Plugins 卸载

```
1. 用户点击"卸载"
2. 显示 plugin 名称和影响
3. 用户确认
4. Rust command → `openclaw plugins uninstall <name>`
5. 从安装记录移除
6. 提示重启 Gateway
7. 卸载日志脱敏
```

### 安全约束

- 卸载只能删除已知安装路径，不能盲目 rm -rf
- 卸载前检查 plugin 是否正在使用
- 保留用户数据（如 plugin 生成的配置/记忆），可选删除
- 不能卸载内置工作流（它们是本地 prompt 模板）

---

## 5. 权限模型

| 权限 | 说明 | 风险 |
|---|---|---|
| file_read | 读取本地文件 | 中 |
| file_write | 写入本地文件 | 中 |
| web_access | 访问网络 | 中 |
| code_execution | 执行代码/shell | 高 |
| env_access | 读取环境变量 | 高 |
| api_key | 需要 API key | 中 |
| config_write | 写入 OpenClaw 配置 | 高 |
| config_read | 读取 OpenClaw 配置 | 中 |
| user_dir | 访问用户目录 | 中 |
| docker_api | 访问 Docker | 高 |
| github_api | 访问 GitHub | 中 |
| shell | 执行 shell 命令 | 高 |

### 权限展示格式

```
┌─────────────────────────────────────┐
│ 安装确认                            │
├─────────────────────────────────────┤
│ 名称：Data Analyst                  │
│ 来源：ClawHub @publisher            │
│ 版本：1.0.0                         │
│ 风险：中等                          │
│                                     │
│ 需要权限：                          │
│ ⚠️ 文件读取                         │
│ ⚠️ 代码执行                         │
│ ⚠️ 网络访问                         │
│                                     │
│ [取消]  [确认安装]                   │
└─────────────────────────────────────┘
```

---

## 6. 风险等级

| 等级 | 条件 | UI 表现 |
|---|---|---|
| 低 | 纯 prompt / 只读 workflow / 无权限 | 绿色 badge，一键安装 |
| 中 | 联网 / 读文件 / 需要 API key | 黄色 badge，展示权限后安装 |
| 高 | shell / 环境变量 / 写配置 / Docker / 代码执行 | 红色 badge，二次确认 |
| 未审计 | 第三方未验证 / 无官方认证 | 灰色 badge，默认不推荐 |

### 风险计算规则

```typescript
function calculateRisk(permissions: string[]): "low" | "medium" | "high" | "unaudited" {
  const highRisk = ["code_execution", "shell", "env_access", "config_write", "docker_api"];
  const mediumRisk = ["web_access", "file_read", "file_write", "api_key", "github_api"];
  if (permissions.some(p => highRisk.includes(p))) return "high";
  if (permissions.some(p => mediumRisk.includes(p))) return "medium";
  return "low";
}
```

---

## 7. UI 设计

### Skill 卡片字段

| 字段 | 来源 | 说明 |
|---|---|---|
| 名称 | ClawHub / 本地 | 显示名 |
| 来源 | ClawHub publisher / 内置 | @publisher 或"内置" |
| 作者 | ClawHub | publisher ID |
| 版本 | ClawHub / 本地 | semver |
| 类型 | metadata | Code Plugin / Bundle Plugin / Skill / Workflow |
| 风险等级 | 权限计算 | 低/中/高/未审计 |
| 权限摘要 | metadata | 简短权限列表 |
| 状态 | 本地 | 未安装/已安装/可更新/安装失败 |
| 按钮 | 状态决定 | 安装/卸载/更新/查看详情 |

### 分类 Tab

```
[内置工作流] [已安装] [推荐] [全部] [搜索...]
```

### 状态流转

```
未安装 → [安装] → 安装中 → 已安装
已安装 → [卸载] → 卸载中 → 未安装
已安装 → [更新] → 更新中 → 已安装(新版本)
安装中 → 安装失败 → [重试]
```

---

## 8. 安全边界

### 必须遵守

| 规则 | 说明 |
|---|---|
| 不默认安装第三方 | 用户必须主动点击安装 |
| 安装前展示权限 | 所有安装必须先展示权限摘要 |
| 高风险二次确认 | 高风险 plugin 需要额外确认弹窗 |
| 日志脱敏 | 安装/卸载日志必须通过 redactSensitive |
| 不输出 Token | 安装过程不暴露 gateway.auth.token |
| 不读取 .env | 安装命令不读取或传递 .env |
| 不暴露 provider/baseUrl | 安装 UI 不显示内部 API 配置 |
| 卸载不盲删 | 只删除已知安装路径 |
| 不执行未知脚本 | 不运行 plugin 的 postinstall 脚本（由 OpenClaw CLI 管理） |
| 不自动启用 | 安装后不自动启用，除非用户确认 |
| 来源标注 | 区分官方/社区/第三方 |
| 版本锁定 | 安装记录版本，更新需用户确认 |

### 禁止

- 不允许从任意 URL 安装
- 不允许绕过 OpenClaw CLI 直接解压 plugin
- 不允许 plugin 安装时修改 gateway.auth.token
- 不允许安装过程访问用户 Token
- 不允许卸载时删除用户数据（除非用户选择）

---

## 9. 后续任务拆分

| 任务 | 优先级 | 说明 |
|---|---|---|
| TASK-027C-B | P1 | Skill Center 外部目录 UI：展示 ClawHub skills/plugins 列表 |
| TASK-027C-C | P1 | 本地已安装 Skill/Plugin 读取：`openclaw skills list --json` |
| TASK-027C-D | P1 | 一键安装最小闭环：Rust command + CLI + 安装记录 |
| TASK-027C-E | P1 | 卸载最小闭环：Rust command + 确认 + 记录清理 |
| TASK-027C-F | P1 | 权限提示/风险等级/日志脱敏 |
| TASK-027C-G | P2 | 推荐白名单 Skill：curated 安全列表 |

### 推荐执行顺序

1. TASK-027C-C（读取本地已安装）→ 最低风险，验证 CLI 可用性
2. TASK-027C-B（外部目录 UI）→ 展示可安装列表
3. TASK-027C-F（权限/风险）→ 安装前必须有权限展示
4. TASK-027C-D（一键安装）→ 核心能力
5. TASK-027C-E（卸载）→ 安装后必须能卸载
6. TASK-027C-G（白名单）→ 推荐安全 skill

---

## 10. OpenClaw CLI 命令参考

### Skills

```bash
openclaw skills list --json          # 列出已安装 skills
openclaw skills search <query>       # 搜索 ClawHub skills
openclaw skills install <slug>       # 安装 skill
openclaw skills update --all         # 更新所有 skills
```

### Plugins

```bash
openclaw plugins install clawhub:<publisher>/<name>   # 从 ClawHub 安装
openclaw plugins install npm:<package>                # 从 npm 安装
openclaw plugins uninstall <name>                     # 卸载 plugin
openclaw plugins list                                 # 列出已安装 plugins
```

### 本地目录

```
~/.openclaw/skills/          # 已安装 skills
~/.openclaw/plugins/         # 已安装 plugins (部分)
~/.openclaw/openclaw.json    # 配置文件（含 plugins 列表）
```

---

## 11. ClawHub 数据源分析

### 已确认信息

- URL: https://clawhub.ai/skills 和 https://clawhub.ai/plugins
- 当前 plugins 数量：100+
- 分类：Channels & Communication / MCP & Tooling / Data & APIs / Security / Observability / Automation / Deployment / Developer Tools
- 排序：Featured / Recently updated
- 官方 publisher：@openclaw（WhatsApp/Slack/Discord/Line/Feishu/Matrix 等 channel plugins）
- 社区 publisher：@lanshanpi / @tangleclaw / @apify / @devinchen2014 等
- Plugin 类型：Code Plugin（可执行）/ Bundle Plugin（资源包）
- 版本格式：semver 或日期格式（2026.5.26）

### 待探测

- ClawHub 是否有公开 REST API（/api/skills, /api/plugins）
- 是否需要认证才能查询列表
- 是否有 JSON 格式的 skill/plugin metadata endpoint
- SkillHub 是否有可用 API

---

## 12. SkillHub 数据源分析

### 已确认信息

- URL: https://skillhub.cn/
- 定位：专为中国用户优化的 Skills 社区
- 页面内容：SPA 渲染，静态抓取内容极少
- 可能有 trending 分类

### 待探测

- 是否有公开 API
- 是否与 ClawHub 数据同步
- 是否有独立的 skill 格式
- 是否支持 `openclaw skills install` 直接安装

### 建议

SkillHub 作为补充数据源，优先级低于 ClawHub。如果 SkillHub 有独立 API，可以作为中文用户的推荐入口。
