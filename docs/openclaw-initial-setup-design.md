# OpenClaw 初始化配置向导方案

TASK-038A | 日期：2026-05-29 | 本轮只做方案，不改业务代码。

---

## 1. 当前问题

| 问题 | 影响 |
|---|---|
| 用户首次使用不知道如何配置 | 无法开始 AI 对话 |
| 当前 AI 助手页只能保存 token + 选档位 | 缺少完整初始化引导 |
| token 以明文写入 openclaw.json | 无 SecretRef，无文件权限限制 |
| 写入后无 schema 验证 | 可能产生 Invalid input 错误 |
| 无 config validate 调用 | 写入错误无法提前发现 |
| Gateway 需要手动启动或点按钮 | 用户可能不知道下一步 |

---

## 2. 现有配置链路

### 2.1 写入链路

```
用户输入 token + 选择档位
  → 前端 applyOpenClawProviderConfig(token, preset)
  → Rust apply_openclaw_model_provider_config
  → 备份 openclaw.json.bak-{timestamp}
  → 读取/创建 openclaw.json
  → 写入 models.providers["ai-agent-proxy"]
  → 写入 agents.defaults.model.primary
  → 写入 gateway.http.endpoints.chatCompletions.enabled
  → 保存文件
  → 前端清除 tokenDraft
```

### 2.2 已写入的字段

| 路径 | 值 |
|---|---|
| models.providers.ai-agent-proxy.baseUrl | 中转站地址 |
| models.providers.ai-agent-proxy.apiKey | token 明文 |
| models.providers.ai-agent-proxy.api | openai-completions |
| models.providers.ai-agent-proxy.models | [deepseek-v4-flash, deepseek-v4-pro] |
| agents.defaults.model.primary | ai-agent-proxy/{model_id} |
| gateway.http.endpoints.chatCompletions.enabled | true |

### 2.3 安全措施（已有）

- 写入前备份 ✅
- 备份失败则取消写入 ✅
- 前端写入后清除 tokenDraft ✅
- 不存入 localStorage ✅
- read_openclaw_config_summary 不返回 token 值 ✅
- read_openclaw_model_provider_summary 只返回 tokenPresent 布尔 ✅

### 2.4 安全缺失

- token 明文写入 JSON，无文件权限限制（不像 hermes .env 的 0o600）
- 无 SecretRef 支持
- 无 config validate 调用
- 无写入后自动检查

---

## 3. OpenClaw 配置写入方式比较

| 方式 | 优点 | 缺点 | 推荐 |
|---|---|---|---|
| 直接写 JSON 文件（当前） | 简单、可控、已实现 | 可能破坏 schema、无验证 | ✅ 内部测试阶段 |
| openclaw config set | 官方 CLI、schema 安全 | 需要 CLI 可用、多次调用 | ⚠️ 后续可选 |
| openclaw secrets configure | 安全存储 token | 未确认 CLI 是否支持 | ❌ 当前不可用 |

### 推荐策略

**内部测试阶段**：继续直接写 JSON（已有实现），但增加：
1. 写入后调用 `openclaw config validate`（如果 CLI 支持）
2. 设置文件权限 0o600
3. 写入后自动 probe 验证

**商业分发阶段**：迁移到 `openclaw config set` 或 SecretRef。

---

## 4. 初始化向导产品设计

### 4.1 触发条件

| 条件 | 行为 |
|---|---|
| OpenClaw 未安装 | 提示安装，不进入向导 |
| 配置文件不存在 | 进入向导 Step 1 |
| 配置存在但 provider 未配置 | 进入向导 Step 2 |
| 配置存在且 provider 已配置 | 不触发向导 |

### 4.2 Step 1：环境检测

自动检测并展示：
- OpenClaw CLI 是否可用
- 配置文件是否存在
- Gateway 是否运行
- Provider 是否已配置
- 模型访问密钥是否存在

### 4.3 Step 2：输入密钥

| 字段 | 说明 |
|---|---|
| 模型访问密钥 | 用户粘贴，password 输入框 |
| 模型档位 | 速度优先 / 质量优先 |

不展示：
- 中转站地址（内置，不需要用户知道）
- provider ID（内部标识）

### 4.4 Step 3：确认写入

展示：
- 模型档位名称
- 默认模型名称
- 写入位置：~/.openclaw/openclaw.json
- "写入前会自动备份原配置"

不展示：
- token 明文
- 中转站完整 URL
- provider 内部 ID

### 4.5 Step 4：写入 + 验证

执行顺序：
1. 备份 openclaw.json
2. 写入配置
3. 设置文件权限 0o600
4. 调用 config validate（如可用）
5. 启动 Gateway（如未运行）
6. 运行 probe 验证

### 4.6 Step 5：完成

- "AI 助手已连接，可以开始对话"
- 按钮：开始对话 / 留在 AI 助手页

---

## 5. Token 分发与安全策略

### 5.1 三种方案比较

| 方案 | 适用阶段 | 安全性 | 用户体验 |
|---|---|---|---|
| 用户手动粘贴 | 内部测试 | 高（token 不入仓库） | 中（需要额外步骤） |
| App 内置默认 token | 不推荐 | 极低（token 入仓库） | 高 |
| 激活码换 token | 商业分发 | 高 | 高 |

### 5.2 推荐

**内部测试阶段**：用户手动粘贴 token。
- Token 通过安全渠道（微信/邮件）分发
- App 不内置任何 token
- 仓库/安装包不含 token

**商业分发阶段**：激活码换 token。
- 用户输入激活码
- App 调用后端 API 换取专属 token
- Token 写入本地配置
- 激活码一次性使用

### 5.3 绝对禁止

- 不把 token 写入 git 仓库
- 不把 token 写入 docs/AGENT_BOARD
- 不把 token 硬编码进前端 JS
- 不在 console.log 输出 token
- 不在 UI 展示 token 明文（输入框 type=password）
- 不在错误信息中包含 token

---

## 6. 配置写入与回滚策略

### 6.1 写入流程

```
1. 检查 ~/.openclaw/ 目录存在
2. 如果 openclaw.json 存在 → 备份为 openclaw.json.bak-{timestamp}
3. 读取现有配置（或创建空对象）
4. 合并 provider/model/gateway 配置
5. 序列化为 pretty JSON
6. 写入文件
7. 设置权限 chmod 0o600
8. 调用 config validate（如可用）
9. 如果 validate 失败 → 回滚（恢复备份）
```

### 6.2 回滚策略

| 失败点 | 行为 |
|---|---|
| 备份失败 | 取消写入（已实现） |
| 写入失败 | 提示用户，备份仍在 |
| validate 失败 | 恢复备份，提示用户 |
| Gateway 启动失败 | 配置已写入，提示用户手动启动 |

### 6.3 当前已实现 vs 需要新增

| 项 | 状态 |
|---|---|
| 备份 | ✅ 已实现 |
| 备份失败取消 | ✅ 已实现 |
| 文件权限 0o600 | ❌ 需新增 |
| config validate | ❌ 需新增（依赖 CLI） |
| validate 失败回滚 | ❌ 需新增 |
| Gateway 自动启动 | ✅ 已实现（TASK-037C） |

---

## 7. 验证流程

写入完成后自动执行：

```
1. openclaw config validate（如可用）
2. openclaw gateway start（如未运行）
3. GET /v1/models → 验证接入层可达
4. POST /v1/chat/completions (hi) → 验证对话可用
5. 全部通过 → 显示"AI 助手已连接"
```

---

## 8. 后续任务拆分

| Task ID | 优先级 | 内容 | 预估 |
|---|---|---|---|
| TASK-038B | P1 | OpenClaw 配置 schema 审计 + 样例 JSON 生成 | 1h |
| TASK-038C | P1 | 初始化向导 UI（5 步） | 2h |
| TASK-038D | P0 | 安全写入 command 增强（chmod 0o600 + validate + 回滚） | 1.5h |
| TASK-038E | P2 | token/SecretRef 处理（商业分发阶段） | 2h |
| TASK-038F | P1 | 配置 validate + Gateway start + probe 自动化 | 1h |
| TASK-038G | P2 | 回归测试 | 0.5h |

### 推荐执行顺序

1. **TASK-038D** — 安全写入增强（chmod + validate），最高优先
2. **TASK-038B** — schema 审计，确保写入格式正确
3. **TASK-038C** — 向导 UI
4. **TASK-038F** — 验证自动化
5. **TASK-038E** — SecretRef（商业阶段）
6. **TASK-038G** — 回归
