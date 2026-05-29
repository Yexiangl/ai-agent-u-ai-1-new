# 客户 Token 一键初始化 AI 助手方案

TASK-038A（修订版）| 日期：2026-05-29 | 本轮只做方案，不改业务代码。

---

## 1. 产品人群与商业模式

### 目标用户

无技术基础的普通客户。不理解也不应该接触：
- OpenClaw / Gateway / provider / baseUrl
- openclaw.json / config validate / SecretRef
- 终端命令

### 商业模式

- 我们卖"中转站 token"
- 每个客户一个独立 token
- 客户使用 AI 时消耗该 token 对应额度
- 额度和用量由中转站后台控制
- App 的目标：客户粘贴 token → AI 助手可用

### 不采用

- 激活码/授权码换 token（太麻烦、不灵活、增加操作成本）
- 登录账号体系
- App 内置公共 token

---

## 2. 客户 Token 模式

| 维度 | 说明 |
|---|---|
| 分发方式 | 人工或后台发给客户（微信/邮件/购买页） |
| 格式 | 字符串，由中转站生成 |
| 生命周期 | 长期有效，额度用完可续费 |
| 安全 | 每客户独立，泄露只影响该客户 |
| 存储 | 写入本地 OpenClaw 配置，不上传 |

---

## 3. 默认内置配置（非密钥）

App 可安全内置以下配置（已在 Rust 常量中）：

| 配置 | 值 | 说明 |
|---|---|---|
| 中转站地址 | 已内置于 Rust 常量 | 不暴露给客户 |
| provider ID | ai-agent-proxy | 内部标识 |
| 模型列表 | deepseek-v4-flash, deepseek-v4-pro | 可扩展 |
| 默认模型 | 按档位选择 | 速度/质量 |
| HTTP API 开关 | chatCompletions.enabled = true | 必须 |

**不内置**：token（每客户不同）

---

## 4. 初始化流程

### 客户视角（5 步）

```
打开 App → 粘贴密钥 → 点击"一键启用" → 等待 → 开始对话
```

### Step 1：环境检测（自动，无需客户操作）

后台检测：
- OpenClaw CLI 是否可用
- 配置文件是否存在
- provider 是否已配置
- Gateway 是否运行

客户看到的文案：
- "正在检查本地 AI 助手环境..."
- "未完成配置" / "已完成配置" / "需要重新启用"

**不显示**：OpenClaw / Gateway / provider / config 等技术词

### Step 2：输入 Token

UI：
- 标题："启用 AI 助手"
- 说明："请输入购买后获得的模型访问密钥"
- 输入框：type=password，placeholder="请粘贴密钥"
- 档位选择：速度优先 / 质量优先（可选，默认速度）
- 按钮："一键启用 AI 助手"

**不显示**：provider / baseUrl / OpenClaw / Gateway / API URL

### Step 3：自动配置（客户只看到进度）

客户看到：
- "正在配置 AI 助手..."
- "正在启动本地服务..."
- "正在验证连接..."

后台执行：
1. 备份 openclaw.json（如存在）
2. 写入 provider 配置（baseUrl + apiKey + models）
3. 写入默认模型
4. 写入 HTTP API 开关
5. chmod 0o600
6. 启动 Gateway（如未运行）
7. probe /v1/models
8. probe /v1/chat/completions

### Step 4：完成

成功：
- "AI 助手已启用，可以开始对话"
- 按钮："开始 AI 对话"

失败：
- "配置未完成，请检查密钥是否正确"
- 按钮："重试" / "查看本地服务状态"
- 不显示 stderr / 技术错误

---

## 5. OpenClaw 配置写入方案

### 5.1 方案比较

| 方式 | 稳定性 | Schema 安全 | 实现成本 | 推荐 |
|---|---|---|---|---|
| 直接写 JSON（当前） | 高 | 中（需自己保证格式） | 已实现 | ✅ 第一版 |
| openclaw config set | 高 | 高（CLI 验证） | 需多次调用 | ⚠️ 后续升级 |
| SecretRef | 最高 | 最高 | 未确认可用 | ❌ 当前不可用 |

### 5.2 第一版方案：直接写 JSON + 增强

当前 `apply_openclaw_model_provider_config` 已实现核心逻辑，需增强：

| 增强项 | 说明 |
|---|---|
| chmod 0o600 | 写入后设置文件权限 |
| validate | 写入后调用 openclaw config validate（如 CLI 可用） |
| 回滚 | validate 失败时恢复备份 |
| 错误脱敏 | 失败信息不含 token/path |

### 5.3 写入的 JSON 结构

```json
{
  "models": {
    "providers": {
      "ai-agent-proxy": {
        "baseUrl": "[内置中转站地址]",
        "apiKey": "[客户 token]",
        "api": "openai-completions",
        "models": ["deepseek-v4-flash", "deepseek-v4-pro"]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "ai-agent-proxy/deepseek-v4-flash"
      }
    }
  },
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

### 5.4 避免 Invalid input

当前实现使用 `models` 数组格式 `["deepseek-v4-flash"]`。
如果 OpenClaw schema 要求对象格式，需要调整为：
```json
"models": { "deepseek-v4-flash": {}, "deepseek-v4-pro": {} }
```

**建议 TASK-038B 先做 schema 审计确认正确格式。**

---

## 6. Token 保存与脱敏策略

### 6.1 Token 写入位置

写入 `~/.openclaw/openclaw.json` 的 `models.providers.ai-agent-proxy.apiKey`。

### 6.2 脱敏规则

| 场景 | 处理 |
|---|---|
| 写入文件 | 明文（文件权限 0o600 保护） |
| 前端 UI | type=password，写入后清除 state |
| 日志 | 不输出 |
| 错误信息 | 不包含 |
| AGENT_BOARD | 不记录 |
| docs | 不记录 |
| git | 不提交 |
| read_openclaw_config_summary | 只返回 tokenPresent 布尔 |
| read_openclaw_model_provider_summary | 只返回 tokenPresent 布尔 |

### 6.3 当前已有的脱敏措施

- `redact_sensitive_content` 函数（Rust）
- `test-redaction.mjs` 21 项测试
- 前端 `tokenDraft` 写入后清除
- 不存 localStorage

---

## 7. 备份 / Validate / 回滚策略

### 7.1 当前已有

| 项 | 状态 |
|---|---|
| 写入前备份 openclaw.json.bak-{timestamp} | ✅ 已实现 |
| 备份失败取消写入 | ✅ 已实现 |
| 前端清除 tokenDraft | ✅ 已实现 |

### 7.2 需要新增

| 项 | 优先级 |
|---|---|
| chmod 0o600 | P0 |
| 写入后 config validate | P1 |
| validate 失败恢复备份 | P1 |
| 写入后自动 Gateway start | P1（已有 TASK-037C） |
| 写入后自动 probe | P1 |

### 7.3 回滚流程

```
写入 → validate
  ├── 通过 → 继续（start + probe）
  └── 失败 → 恢复备份 → 提示"配置格式异常，已恢复原配置"
```

---

## 8. 后续任务拆分

| Task ID | 优先级 | 内容 | 预估 |
|---|---|---|---|
| TASK-038B | P1 | OpenClaw config schema 审计（确认 models 格式） | 1h |
| TASK-038C | P0 | 初始化 UI：客户只填 token + 一键启用 | 2h |
| TASK-038D | P0 | 安全写入增强：chmod 0o600 + validate + 回滚 | 1.5h |
| TASK-038E | P1 | 写入后自动 Gateway start + probe 验证 | 1h |
| TASK-038F | P2 | 初始化回归测试 | 0.5h |

### 推荐执行顺序

1. **TASK-038D** — 安全写入增强（最高优先，保护客户 token）
2. **TASK-038B** — schema 审计（确保不写坏配置）
3. **TASK-038C** — 初始化 UI（客户体验核心）
4. **TASK-038E** — 自动验证（完成闭环）
5. **TASK-038F** — 回归测试
