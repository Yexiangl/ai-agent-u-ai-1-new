# OpenClaw 本地服务自助诊断方案

TASK-034A：设计 AI 助手页内的本地服务诊断能力，让用户自查 AI 对话不可用的原因。

---

## 1. 目标

- 用户无需离开 App 即可了解 AI 助手是否可用
- 不可用时提供明确原因和操作建议
- 支持一键打开 OpenClaw 官方控制台
- 安全：不自动执行修改命令，不暴露敏感信息

---

## 2. 官方原生能力

### 2.1 本地控制台

| 项目 | 说明 |
|---|---|
| 地址 | `http://127.0.0.1:18789/` |
| CLI | `openclaw dashboard` |
| 功能 | 聊天、概览、实例、会话、使用情况、定时任务、代理、技能、节点、梦境、设置、文档 |

### 2.2 HTTP API

| 端点 | 用途 | 当前状态 |
|---|---|---|
| `GET /v1/models` | 模型列表，验证接入层可达 | ✅ probe 已有 |
| `POST /v1/chat/completions` | 对话接口，验证 AI 可用 | ✅ probe 已有 |
| `GET /v1/responses` | 响应接口（部分实现） | ⚠️ 可选 |

### 2.3 CLI 命令

| 命令 | 用途 | 安全级别 |
|---|---|---|
| `openclaw gateway status` | 查看 Gateway 运行状态 | ✅ 只读 |
| `openclaw status` | 查看整体状态 | ✅ 只读 |
| `openclaw config validate` | 验证配置文件合法性 | ✅ 只读 |
| `openclaw logs` | 查看日志 | ⚠️ 只读，但体积大 |
| `openclaw doctor` | 诊断健康状态 | ⚠️ 信息量较大 |
| `openclaw doctor --fix` | 自动修复配置 | ❌ 写入操作 |
| `openclaw gateway start/stop/restart` | 启停 Gateway | ❌ 启停操作 |

---

## 3. 当前已有检测能力

### 3.1 前端检测

| 功能 | 文件 | 说明 |
|---|---|---|
| App mount 状态预加载 | `App.tsx:710-729` | `checkOpenClawHttpStatus()` → `openclawConnected` |
| 周期性刷新 | `App.tsx:732` | 30 秒间隔 `setInterval` |
| AI 助手页重新检查 | `App.tsx:1373` | "重新检查"按钮 |
| 高级诊断弹窗 | `App.tsx:1529-1548` | 配置文件/Gateway/HTTP/模型/CLI 提示 |
| ChatPage 状态栏 | `App.tsx:2868-2873` | "已就绪" / "需要配置" / "检测中" |

### 3.2 Rust 命令

| 命令 | 用途 |
|---|---|
| `openclaw_http_status` | `/v1/models` + Gateway 可达性 |
| `openclaw_http_chat_completion` | 实际对话请求（含 token） |
| `read_openclaw_config_summary` | 配置文件 + token 存在性（安全摘要） |
| `read_openclaw_model_provider_summary` | 模型供应配置摘要 |

### 3.3 脚本

| 脚本 | 用途 |
|---|---|
| `scripts/openclaw-http-api-probe.mjs` | 完整的 4 步诊断（token/models/chat/config） |

---

## 4. 诊断项设计

### 4.1 状态枚举

| 状态 | 含义 | 触发条件 |
|---|---|---|
| 运行中 | 一切正常，AI 可用 | probe 全通过 |
| 未运行 | Gateway 未启动 | `GET /v1/models` 连接失败 |
| 配置异常 | 配置文件问题 | 配置文件存在但有错误 |
| 密钥未配置 | gateway.auth.token 未设置 | `openclaw.json` 中无 token |
| 接口未启用 | HTTP endpoints 未开启 | `chatCompletions.enabled !== true` |
| 请求异常 | Gateway 可达但对话失败 | models 通过但 chat 失败 |

### 4.2 检测项

| # | 检测项 | 数据来源 | 显示方式 |
|---|---|---|---|
| 1 | 本地服务可达 | `openclaw_http_status` → `gatewayReachable` | ✅/❌ 图标 |
| 2 | 控制台可访问 | `GET http://127.0.0.1:18789/`（head request） | 链接按钮 |
| 3 | 模型接口 | `GET /v1/models` | ✅/❌ + 模型数量 |
| 4 | 对话接口 | `POST /v1/chat/completions`（hi→hi） | ✅/❌ |
| 5 | 配置有效性 | `read_openclaw_config_summary` | ✅/⚠️/❌ |
| 6 | 密钥已配置 | `gatewayTokenPresent` | ✅/❌ |
| 7 | HTTP 接口启用 | `httpChatCompletionsEnabled` | ✅/❌ |
| 8 | 默认模型 | `ocPrimaryModel`（通过 `read_openclaw_config_summary`） | 模型名 |
| 9 | 最近错误 | 错误信息数组（脱敏） | 错误摘要 |

---

## 5. UI 信息架构

### 5.1 位置

AI 助手页 → 现状"高级诊断"区域 → 升级为"本地服务诊断"

### 5.2 普通视图区（取代当前"高级诊断"小字链接）

```
┌──────────────────────────────────────┐
│ 本地服务诊断                         │
│ 排查 AI 助手连接问题                 │
├──────────────────────────────────────┤
│ ● 本地服务        已就绪            │
│ ● 模型接口        /v1/models ✅     │
│ ● 对话接口        /v1/chat ✅       │
│ ● 配置有效性      有效              │
│ ● 密钥           已配置            │
│ ● HTTP 接口       已启用            │
├──────────────────────────────────────┤
│ [重新检查] [打开控制台]             │
│ [复制诊断摘要]                      │
├──────────────────────────────────────┤
│ 修复建议（仅异常时显示）             │
│ • 本地服务未运行：openclaw start    │
│ • 密钥未配置：前往模型配置保存密钥   │
│ • 接口未启用：openclaw config set…  │
└──────────────────────────────────────┘
```

### 5.3 高级诊断区（折叠，默认隐藏）

保留当前的高级诊断弹窗内容，增加：
- 原始 Gateway 状态
- Legacy Hermes 引擎状态
- 路由入口 openclaw/default
- CLI 参考命令

### 5.4 与当前设计的差异

| 当前 | 新设计 |
|---|---|
| "高级诊断"小字链接 → 弹窗 | "本地服务诊断"卡片 → 普通可见 |
| 技术诊断（Gateway/HTTP/路由入口） | 用户化 + 技术入口（折叠） |
| 无修复建议 | 异常时显示修复建议 |
| 无控制台入口 | "打开控制台"按钮 |
| 无复制功能 | "复制诊断摘要"（脱敏） |

---

## 6. 命令/API 安全分级

### 6.1 第一版可执行（只读）

| 命令/API | 用途 | 实现方式 |
|---|---|---|
| `GET /v1/models` | 验证模型接口 | 已有 `openclaw_http_status` |
| `POST /v1/chat/completions` (hi) | 验证对话接口 | 已有 `openclaw_http_status` |
| `read_openclaw_config_summary` | 配置文件摘要 | 已有 Rust command |
| `openclaw gateway status --json` | 获取 Gateway 进程状态 | 建议新增 Rust command（TASK-034D） |
| `openclaw config validate` | 验证配置文件 | 建议新增 Rust command（TASK-034D） |
| 打开控制台 `http://127.0.0.1:18789/` | 用户自助排查 | Shell open / Tauri shell 打开 |

### 6.2 第一版不可执行

| 命令 | 原因 |
|---|---|
| `openclaw doctor --fix` | 修改配置 |
| `openclaw gateway start/stop/restart` | 启停服务 |
| `openclaw logs` | 体积大，建议用户自行执行 |
| `openclaw config set ...` | 修改配置 |

### 6.3 诊断摘要脱敏规则

复制诊断摘要时：
- 显示：模型名、接口状态、配置文件是否存在、密钥是否配置（只显示"已配置/未配置"）
- 不显示：Token 明文、Authorization、Bearer、baseUrl、provider、API URL、完整本地路径

---

## 7. 错误原因映射

| 用户看到 | 根因 | 检查项 | 修复建议 |
|---|---|---|---|
| "需要配置" / "AI 助手未连接" | Gateway 未运行 | 本地服务可达 → ❌ | 终端运行 `openclaw gateway start` |
| "密钥未配置" | 模型供应未配置 | gatewayTokenPresent → false | 前往 AI 助手页模型配置保存密钥 |
| "接口未启用" | HTTP endpoints disabled | httpChatCompletionsEnabled → false | `openclaw config set gateway.http.endpoints.chatCompletions.enabled true` |
| "请求异常" | Gateway 运行但模型调用失败 | models ✅ + chat ❌ | 检查模型供应配置/密钥是否正确 |
| "配置文件缺失" | `~/.openclaw/openclaw.json` 不存在 | configExists → false | 重新安装或初始化 OpenClaw |

---

## 8. 后续任务拆分

| Task ID | 优先级 | 内容 | 预估工时 |
|---|---|---|---|
| TASK-034B | P1 | AI 助手页诊断面板 UI（普通视图卡片 + 状态图标 + 修复建议） | 1.5h |
| TASK-034C | P1 | "打开 OpenClaw 控制台"按钮 | 0.5h |
| TASK-034D | P1 | Rust 只读 CLI 诊断命令（`gateway_status`/`config_validate`） | 1h |
| TASK-034E | P2 | "复制诊断摘要"（脱敏 + 格式化） | 0.5h |
| TASK-034F | P2 | 诊断模块回归测试 + probe 集成 | 0.5h |
