# Agent 引擎页真实配置审计

TASK-026A：审计 Agent 引擎页所有状态、按钮、配置项的真实来源和作用。

日期：2026-05-27 | 本轮只做审计和方案，不改业务代码。

---

## 一、当前 Agent 引擎页区块清单

| # | 区块 | 代码位置 | 建议用户可见性 | 建议 |
|---|---|---|---|---|
| 1 | **引擎状态总览** | `Card accent="#6366F1"` | 普通用户 | 保留，但简化字段（见下表） |
| 2 | **模型供应配置** | `Card` with Token + 档位 | 普通用户 | 保留，是核心功能 |
| 3 | **思考强度** | `Card` with ReasoningEffortControl | 应移除或标注未接入 | **假配置** — 写 Hermes config，不影响 OpenClaw |
| 4 | **Legacy 应用预览弹窗** | Modal with `showApplyPreview` | 高级诊断 | 保留，Legacy fallback |
| 5 | **售后诊断入口** | `button "售后诊断"` | 默认隐藏 | 保留，已是默认隐藏 |
| 6 | **售后诊断弹窗** | `showAdvanced && modal` | 默认隐藏 | 保留 |

---

## 二、UI 字段来源表

| UI 字段 | 当前显示值 | 数据来源 (代码) | 是否真实 | 是否安全 | 建议 |
|---|---|---|---|---|---|
| **配置文件** | 已找到/未找到 | `readOpenClawConfigSummary().configExists` (Rust `cfg` file check) | ✅ 真实 | ✅ 安全 (不返回内容) | 保留但降级到高级诊断 |
| **Gateway** | 运行中/未运行 | `checkOpenClawHttpStatus().ready` (HTTP `/v1/models` 探测) | ✅ 真实 | ✅ 安全 | 降级到高级诊断 |
| **HTTP 对话接口** | 已启用/未启用 | `readOpenClawConfigSummary().httpChatCompletionsEnabled` | ✅ 真实 | ✅ 安全 | 降级到高级诊断 |
| **模型 Token** | 已配置/未配置 | `readOpenClawConfigSummary().gatewayTokenPresent` | ✅ 真实 | ✅ 安全 (不返值) | 降级到高级诊断 |
| **默认模型** | `openclaw/default` | `checkOpenClawHttpStatus().defaultModel` | ⚠️ 显示路由别名 | ✅ 安全 | **应改为真实 primary model** |
| **可用模型数** | N 个 | `checkOpenClawHttpStatus().models.length` | ✅ 真实 | ✅ 安全 | 降级到高级诊断 |
| **可用模型列表** | openclaw, openclaw/default, openclaw/main | `checkOpenClawHttpStatus().models` | ✅ 真实 (HTTP 路由模型) | ✅ 安全 | 降级到高级诊断 |
| **模型供应已配置** | 提示文字 | `ocConfig?.gatewayTokenPresent` 判断 | ✅ 真实 | ✅ 安全 | 保留 |
| **当前模型 (供应配置卡片)** | 速度优先/质量优先 | `ocModelPreset` (前端 state) | ✅ 真实 (用户选择) | ✅ 安全 | 保留 |
| **思考强度** | 关闭/轻量/标准/深度/极深 | `hermesModelConfig?.reasoningEffort` → Hermes CLI `config set` | ❌ **假配置** | ✅ 安全 (但误导) | **移除或标注"未接入 OpenClaw"** |
| **显示思考过程** | toggle | `config.showReasoning` (前端 state only) | ❌ **假配置** | ✅ 安全 (但无实际效果) | **移除** |
| **Token 输入框** | 密码框 | `tokenDraft` (前端 state) | ✅ 真实 | ✅ 安全 (不存 AppConfig) | 保留 |
| **应用到 OpenClaw 配置** | 按钮 | `applyOpenClawProviderConfig` → Rust `apply_openclaw_model_provider_config` | ✅ 真实写 OpenClaw config | ✅ 安全 | 保留 |

---

## 三、假配置判断

### 3.1 思考强度 (ReasoningEffortControl)

**判断：假配置。**

代码路径：
1. `ReasoningEffortControl` 调用 `applyHermesReasoningConfig(effort)`
2. Rust `apply_hermes_reasoning_config` 执行 `hermes config set agent.reasoning_effort`
3. 写入的是 **Hermes 配置文件** (`~/.hermes/config.yaml`)，不是 OpenClaw 配置
4. OpenClaw HTTP-first 聊天请求 (`openclaw_http_chat_completion`) **不读取** 这个字段
5. 对 OpenClaw 模型调用 **没有任何影响**

当前 UI 描述："控制 AI Agent 的推理深度。是否生效取决于当前模型能力。" — 这是误导性描述。

### 3.2 显示思考过程 (showReasoning)

**判断：假配置。**

代码路径：
1. Toggle 设置 `config.showReasoning` (前端 AppConfig)
2. `ReasoningBlock` 组件在渲染时 **不检查** `config.showReasoning`
3. 它总是渲染 `message.reasoningContent`（如果有内容）
4. 对 OpenClaw 请求 **没有任何影响**

当前这个开关完全没有实际效果 — UI 本身的 reasoning 内容是否显示只取决于数据是否存在。

---

## 四、真实配置判断

### 4.1 模型供应配置 (Token + 档位)

**判断：真实配置。**

- `applyOpenClawProviderConfig(token, preset)` → Rust `apply_openclaw_model_provider_config`
- 写入 `~/.openclaw/openclaw.json`：
  - `models.providers.ai-agent-proxy` (baseUrl, apiKey, api, models)
  - `agents.defaults.model.primary` (速度/质量切换)
  - `gateway.http.endpoints.chatCompletions.enabled = true`
- Token 不写 `AppConfig.apiKey` / localStorage / sessionStorage ✅
- 应用后清空输入框 ✅

### 4.2 引擎状态检测

**判断：真实配置。**

- `readOpenClawConfigSummary` → 读取 `~/.openclaw/openclaw.json` 摘要（不返回 token）✅
- `checkOpenClawHttpStatus` → `reqwest` GET `/v1/models` 探测 ✅
- 30s 周期性刷新 ✅

---

## 五、默认模型来源问题

**当前 Engine 页 "默认模型" 显示：`openclaw/default`**

来源：`checkOpenClawHttpStatus().defaultModel` → 这是 OpenClaw Gateway 的 HTTP 路由别名。

**问题**：`openclaw/default` 不是真实的大模型名称。真实模型是：
```
agents.defaults.model.primary = ai-agent-proxy/deepseek-v4-flash
```

或：
```
agents.defaults.model.primary = ai-agent-proxy/deepseek-v4-pro
```

**修复建议**：
- TASK-025B 已为首页和对话页实现了 `ocPrimaryModel` → `formatDisplayModel`
- EnginesPage 应该同样使用 `ocPrimaryModel`
- 普通用户 UI 显示 `deepseek-v4-flash`，高级诊断显示完整路由名

---

## 六、普通用户视图建议

### 保留在普通视图

| 字段 | 显示 |
|---|---|
| AI 助手状态 | 已就绪 / 需要检查 |
| 当前真实模型 | 从 `ocPrimaryModel` 读取，`formatDisplayModel` 显示 |
| 模型档位 | 速度优先 / 质量优先 |
| Token 输入 | 密码框 + 应用到 OpenClaw 配置 |
| 刷新检测 | 按钮 |
| 查看高级诊断 | 入口（默认隐藏） |

### 移至高级诊断

| 字段 | 原因 |
|---|---|
| 配置文件 | 技术细节 |
| Gateway | 技术细节 |
| HTTP 对话接口 | 技术细节 |
| 模型 Token (gateway) | 技术细节 |
| 可用模型列表 | 技术细节 (openclaw/default/main 是路由别名) |
| openclaw_http_status 错误 | 调试信息 |
| CLI 修复命令 | 开发/售后 |

### 移除/标注

| 字段 | 原因 |
|---|---|
| 思考强度 (推理深度) | 假配置 — 写 Hermes 不影响 OpenClaw |
| 显示思考过程 | 假配置 — 无实际效果 |
| Legacy 应用预览弹窗 | 已折叠，保留在高级诊断 |

---

## 七、高级诊断区建议

折叠区 (默认隐藏) 显示：

```
文件：~/.openclaw/openclaw.json
Gateway：运行中 / 未运行
HTTP 对话接口：已启用 / 未启用
可用模型：openclaw, openclaw/default, openclaw/main
CLI 修复：openclaw gateway restart
          openclaw config set gateway.http.endpoints.chatCompletions.enabled true
Legacy Hermes 诊断（默认隐藏）
```

不显示：
- token 值
- provider
- baseUrl
- API URL
- gateway.auth.token
- 完整 config 内容

---

## 八、TASK-026B 重构建议

### 目标

将 Agent 引擎页从"技术仪表盘"改为"用户友好配置页"。

### 区块重组

| 新位置 | 内容 |
|---|---|
| **普通视图** | AI 助手状态 + 当前模型 + 模型档位 + Token 配置 + 刷新 |
| **高级诊断 (折叠)** | 技术状态 + 可用模型 + CLI 命令 |
| **移除** | 思考强度 (假配置) |

### 改动范围

- `src/App.tsx` — EnginesPage 组件
- 不改 Rust command
- 不改 OpenClaw config 写入
- 不改 Token 安全

---

## 九、安全与风险

| 项目 | 状态 |
|---|---|
| Token 不写 AppConfig/localStorage/sessionStorage | ✅ |
| gateway.auth.token 不显示值 | ✅ |
| provider/baseUrl/API URL 不暴露普通 UI | ✅ |
| Authorization/Bearer 仅在 Rust 内部 | ✅ |
| 假配置不影响 OpenClaw 请求 | 安全但误导 — 应移除 |
| Hermes reasoning config 写入独立于 OpenClaw | 安全但无用 — 应移除 |
