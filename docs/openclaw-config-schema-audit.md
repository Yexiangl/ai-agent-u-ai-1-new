# OpenClaw Config Schema 审计

TASK-038B：确认 `apply_openclaw_model_provider_config` 生成的 JSON 是否符合当前 OpenClaw schema。

---

## 1. 当前写入 schema

`apply_openclaw_model_provider_config` (main.rs:2604-2617) 生成如下 provider 配置：

```json
{
  "models": {
    "providers": {
      "ai-agent-proxy": {
        "baseUrl": "https://ai.f1class.icu/v1",
        "apiKey": "<user token>",
        "api": "openai-completions",
        "models": ["deepseek-v4-flash", "deepseek-v4-pro"]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "ai-agent-proxy/deepseek-v4-pro"
      }
    }
  },
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

### 1.1 models.providers.ai-agent-proxy.models 格式

**当前格式**：字符串数组 `["deepseek-v4-flash", "deepseek-v4-pro"]`

### 1.2 已验证历史写入

通过本地备份文件 `openclaw.json.bak-1780024983` 确认：
- 上次成功写入后该配置存在
- 但当前 `openclaw.json` 中 `models.providers` 为空
- 说明 config validate 失败 → TASK-038D 回滚被触发

### 1.3 风险

**P0 风险：`models` 字段格式可能不符合当前 OpenClaw schema**

用户报告错误：
```
models.providers.ai-agent-proxy.models.0: Invalid input
models.providers.ai-agent-proxy.models.1: Invalid input
```

这表明 `openclaw config validate` 不接受包含简单字符串的 `models` 数组。

可能的修复方向：
- Option A：`models` 改为对象数组 `[{ "id": "deepseek-v4-flash" }, { "id": "deepseek-v4-pro" }]`
- Option B：`models` 中的每个 model 需要带 provider 前缀 `["ai-agent-proxy/deepseek-v4-flash", ...]`

---

## 2. Model 对象格式（推荐修复）

### 2.1 Option A：model 对象格式

```json
"models": [
  { "id": "deepseek-v4-flash" },
  { "id": "deepseek-v4-pro" }
]
```

### 2.2 当前常量

| 常量 | 值 |
|---|---|
| `MODEL_PROXY_PROVIDER_ID` | `"ai-agent-proxy"` |
| `MODEL_PROXY_BASE_URL` | `"https://ai.f1class.icu/v1"` |
| 速度优先 model_id | `"deepseek-v4-flash"` |
| 质量优先 model_id | `"deepseek-v4-pro"` |

### 2.3 默认模型字段

位置：`agents.defaults.model.primary`
值：`"ai-agent-proxy/deepseek-v4-pro"` (质量优先默认)

格式：`{provider}/{model}` — 符合 `provider/model` 的 OpenClaw 模型引用规范。

---

## 3. Token/API 配置

| 字段 | 位置 | 说明 |
|---|---|---|
| `apiKey` | `models.providers.ai-agent-proxy.apiKey` | 用户 token |
| `baseUrl` | `models.providers.ai-agent-proxy.baseUrl` | 中转站地址 |
| `api` | `models.providers.ai-agent-proxy.api` | `"openai-completions"` |
| Gateway token | `gateway.auth.token` | 不从此函数写入 |

---

## 4. Gateway HTTP API 启用

已通过以下配置启用：
```json
"gateway": {
  "http": {
    "endpoints": {
      "chatCompletions": {
        "enabled": true
      }
    }
  }
}
```

---

## 5. validate 与回滚

TASK-038D 已在写入后执行 validate。如果 validate 失败，自动回滚到备份。

当前状态：备份中曾有 `ai-agent-proxy` provider 配置，但主配置中不存在，说明 validate 失败触发了回滚。结合用户错误 "models.0: Invalid input"，**根因指向 models 字段格式**。

---

## 6. read_openclaw_model_provider_summary 兼容性

当前 `read_openclaw_model_provider_summary` (main.rs:2569) 假设 `models` 是字符串数组：

```rust
let models = proxy.and_then(|p| p.get("models"))
    .and_then(|m| m.as_array())
    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
```

**如果改为对象数组，此段也需要同步修改。**

---

## 7. 审计结论

| 项目 | 结论 |
|---|---|
| 当前 `models` 格式 | 字符串数组 — **有 schema 风险** |
| 根因 | `openclaw config validate` 可能不接受字符串数组 model entries |
| 修复性质 | P0 — 必须修才能让配置写入成功 |
| 修复方案 | 将 `models` 改为对象数组 `[{ "id": "..." }, ...]` |
| 影响范围 | `apply_openclaw_model_provider_config` + `read_openclaw_model_provider_summary` |
| 是否建议进入 038C | ❌ 必须先修复 schema 才能做 UI |

---

## 8. 建议修复

### TASK-038B-P1：修复 models 字段格式

将 `apply_openclaw_model_provider_config` 中的：

```rust
"models": ["deepseek-v4-flash", "deepseek-v4-pro"],
```

改为：

```rust
"models": [
    serde_json::json!({ "id": "deepseek-v4-flash" }),
    serde_json::json!({ "id": "deepseek-v4-pro" }),
],
```

同时修改 `read_openclaw_model_provider_summary` 中的 models 读取：

```rust
let models = proxy.and_then(|p| p.get("models"))
    .and_then(|m| m.as_array())
    .map(|arr| arr.iter().filter_map(|v| 
        v.as_object()
            .and_then(|o| o.get("id"))
            .and_then(|id| id.as_str())
            .map(|s| s.to_string())
    ).collect::<Vec<_>>())
    .unwrap_or_default();
```
