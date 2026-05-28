# Portable 跨平台安全策略与数据脱敏

TASK-028H：跨平台安全策略与数据脱敏方案。

日期：2026-06-01 | 本轮只做安全策略文档，不改业务代码。

---

## 一、Token / 密钥存储边界

### 允许

| 数据 | 存储位置 | 说明 |
|---|---|---|
| 模型名 (deepseek-v4-pro) | portable data / UI / 安全摘要 | ✅ 安全 |
| "模型供应已配置" / "需检查" | portable data / UI | ✅ 安全 |
| Gateway 状态 (running/not running) | UI / 安全摘要 | ✅ 安全 |
| HTTP API 可达性 | 内存 / 探针返回 | ✅ 安全 |

### 禁止

portable data 中 **不允许** 明文存储：

| 禁止项 | 原因 |
|---|---|
| Token / API key | 敏感凭证 |
| `gateway.auth.token` | OpenClaw 认证 |
| `Authorization: Bearer xxx` | HTTP 凭证 |
| `provider` / `baseUrl` / `API URL` | 内部技术配置 |
| 完整 OpenClaw config | 含 Token + provider + baseUrl |
| `.env` 全文 | 含全部敏感环境变量 |
| 模型供应密钥 | 用户专属额度凭证 |

### 加密路线（后续）

如果未来需要 portable 模式携带 Token：

| 级别 | 方案 |
|---|---|
| 最低（不推荐） | 明文 config 文件 |
| 中等 | macOS Keychain / Windows Credential Manager |
| 推荐（后续） | 加密文件 + 用户口令 | 
| 最高 | 硬件密钥 |

当前阶段：Token 仍由 `~/.openclaw/openclaw.json`（OpenClaw runtime）管理，不进入 App portable data。

---

## 二、portable data 目录允许/禁止清单

### `data/app/`

| 允许 | 禁止 |
|---|---|
| `chat-sessions.json` | Token / API key |
| `chat-projects.json` | provider / baseUrl / API URL |
| `preferences.json` | OpenClaw config 全量 |
| `device-identity.json` | Authorization / Bearer |
| 安全摘要状态 | .env |

### `data/openclaw/`（当前阶段：规划，未启用）

| 允许 | 禁止 |
|---|---|
| config-summary.json（仅安全摘要） | 完整 OpenClaw config |
| workspace / memory / skills 规划 | 复制 ~/.openclaw 目录 |
| logs（脱敏后） | 第三方 plugin 安装 |

### `data/logs/`

| 允许 | 禁止 |
|---|---|
| App 运行日志 | Authorization header |
| Gateway 状态摘要 | Token |
| 错误码 | 完整请求/响应正文 |
| 脱敏路径 | 用户文件内容 |

### `data/backup/`

| 允许 | 禁止 |
|---|---|
| 会话/项目 JSON 备份 | Token / provider / baseUrl / API URL |
| 脱敏后的配置摘要 | 完整 config dump |

---

## 三、日志脱敏策略

### 脱敏规则

| 原字符 | 脱敏后 |
|---|---|
| `sk-abc123xyz` | `sk-********` |
| `Bearer abcd1234` | `Bearer ****` |
| `Authorization: Bearer xyz` | `Authorization: [REDACTED]` |
| `/Users/john/Documents/file.txt` | `/Users/***/file.txt` |
| `C:\Users\john\Documents\file.txt` | `C:\Users\***\file.txt` |
| `{ "apiKey": "secret" }` | `{ "apiKey": "[REDACTED]" }` |
| `http://127.0.0.1:8642/v1` | `[LOCAL_API_URL]` |
| `https://ai.f1class.icu/v1` | `[MODEL_PROXY_URL]` |

### 伪代码

```
function redactSensitive(input: string): string
  1. 替换匹配 /Bearer\s+\S+/ → "Bearer [REDACTED]"
  2. 替换匹配 /Authorization:\s*\S+/ → "Authorization: [REDACTED]"
  3. 替换匹配 /"apiKey"\s*:\s*"[^"]*"/ → '"apiKey":"[REDACTED]"'
  4. 替换匹配 /gateway\.auth\.token\s*[=:]\s*"[^"]*"/ → 'gateway.auth.token=[REDACTED]'
  5. 替换匹配 /https?:\/\/ai\.\w+\.\w+\/\w+/ → "[MODEL_PROXY_URL]"
  6. 替换匹配 /\bhttps?:\/\/127\.0\.0\.1:\d+\/v\d+\b/ → "[LOCAL_API_URL]"
  7. 替换本地路径：/\/Users\/[^/]+\// → "/Users/***/"
  8. 替换 Windows 路径：/C:\\Users\\[^\\]+\\/ → "C:\Users\***\
  9. 保持安全文本不变
```

---

## 四、诊断信息脱敏策略

### `portable_data_status` 安全返回

```json
{
  "mode": "system",           // ✅ 安全
  "portableRequested": true,  // ✅ 
  "portableAvailable": false, // ✅
  "writable": false,          // ✅
  "reason": "portable 数据不可写" // ✅ 不含路径
}
```

### `portable_runtime_status` 安全返回

```json
{
  "nodeFound": true,           // ✅
  "nodeVersion": "v20.11.0",   // ✅ 版本号安全
  "openclawFound": true,       // ✅
  "openclawVersion": "2026.5.22", // ✅
  "gatewayReachable": true,    // ✅
  "scripts": { "startWindows": true }, // ✅
  "warnings": []               // ✅ 通用文本
}
```

禁止返回：
- 完整路径
- Token / API key
- provider / baseUrl / API URL
- 完整 command output

---

## 五、runtime / Gateway 启停安全策略

### 启动策略

```
1. 检查是否已有 Gateway（可通过端口/进程检测）
2. 如有：提示复用，不启动第二个
3. 如无：启动 runtime/openclaw
4. 环境变量：不写 Token
5. 启动后写 PID file → data/openclaw/gateway.pid
```

### 停止策略

```
1. 读取 data/openclaw/gateway.pid
2. 验证进程存在 + 命令行包含本 workspace 路径
3. 使用 kill <PID>（非 taskkill /f, pkill, killall）
4. 删除 PID file
5. 错误时：记录日志，不 kill 其他进程
```

### 禁止

| 禁止操作 | 原因 |
|---|---|
| `taskkill /f /im node.exe` | 会杀无关进程 |
| `taskkill /f /im openclaw.exe` | 同上 |
| `pkill node` | 同上 |
| `pkill openclaw` | 同上 |
| `killall node` | 同上 |
| `killall openclaw` | 同上 |

---

## 六、Skill / Plugin 安全策略

### 默认原则

1. **不默认安装**第三方 plugin
2. **不一键安装**未知来源 plugin
3. **首批仅允许**：内置工作流 + 白名单 OpenClaw 官方 plugin + 经审查的本地 plugin

### 安装前必须展示

| 信息 | 要求 |
|---|---|
| 来源 | 内置/官方/第三方 |
| 权限 | 文件/网络/shell/环境变量 |
| 风险级别 | 低/中/高 |
| 说明 | 安装后不可自动执行 |

### Plugin 运行约束

- 不自动读取 .env
- 不自动读取 OpenClaw config 全量
- 不读取 Token
- 日志脱敏
- 安装到 data/openclaw/skills/

### 后续接入原则

- TASK-027C 必须先做只读列表 + 安全摘要
- 一键安装必须在权限模型之后
- ClawHub 远程 skill 必须经过安全审查

---

## 七、Windows 安全策略

| 场景 | 策略 |
|---|---|
| SmartScreen | 签名 exe + 积累下载量 |
| Windows Defender | 提交代码签名 + 白名单申请 |
| bat 脚本 | 不要求管理员权限；不绕过执行策略 |
| 企业禁脚本 | 提供 App 内启动器替代 |
| 盘符变化 | 相对路径 `%~dp0..` |
| 路径空格/中文 | 全部加引号 |
| WebView2 | 检测 + 提示安装（不强制下载） |
| 不写注册表 | 除非后续明确需要 |

---

## 八、macOS 安全策略

| 场景 | 策略 |
|---|---|
| Gatekeeper | 签名 + 公证 |
| quarantine | 签名后自动清除 |
| .app 路径 | 修正 TASK-028G-1 的 bundle 层级推导 |
| .command 脚本 | 签名 + 用户一次批准 |
| Apple Silicon | Universal binary |
| 外置盘权限 | 默认 ok；不申请完全磁盘访问 |
| 不建议 | `xattr -dr` / `spctl --master-disable` 作为正式方案 |

---

## 九、备份 / 导出 / 迁移安全策略

| 场景 | 规则 |
|---|---|
| 备份 portable data | 可备份 JSON 数据，不包含 Token |
| 导出诊断包 | 默认脱敏；用户确认后再导出 |
| 迁移到 U 盘 | 展示将复制的数据列表；不包含 Token / OpenClaw config |
| system → portable 迁移 | 明确提示；不自动复制 |
| 删除 portable data | 不影响 system data |

---

## 十、后续任务拆分

| Task ID | 内容 | 优先级 |
|---|---|---|
| TASK-028H-1 | redactSensitive 统一脱敏 helper | P1 |
| TASK-028H-2 | 诊断包脱敏导出 | P2 |
| TASK-028H-3 | Gateway PID file 机制 | P2 |
| TASK-028H-4 | Plugin 权限模型 | P1 |
| TASK-028H-5 | Portable 安全 UI 文案 | P2 |
| TASK-028G-1 | macOS bundle root 路径修正 | P1 |
| TASK-028F-1 | Windows startup script 落地 | P2 |
