# Portable / U 盘 A+B 模式可行性审计

TASK-028A：Portable USB A+B 模式审计与方案。

日期：2026-06-01 | 本轮只做审计和方案，不改业务代码。

---

## 一、结论摘要

### A 模式（便携数据模式）— 可行，需要中等改造

当前会话、项目、配置分散在 4 个不同位置：
1. `chat-sessions.json` — Tauri `app_data_dir()` ✅ 可迁移
2. `config.json` — Tauri `app_data_dir()` ✅ 可迁移
3. `chatProjects` — `localStorage` ❌ 必须迁移到 JSON 文件
4. OpenClaw config — `~/.openclaw/` ❌ 无法迁移（属 OpenClaw runtime 管理）

**A 模式核心工作**：将所有 App 数据统一到一个 portable data 目录，支持从 U 盘读取/写入。

### B 模式（内置 runtime）— 可行但高风险，建议分阶段

需要打包 Node.js portable runtime + OpenClaw binary + Gateway 启动脚本。涉及：
- Windows WebView2 依赖
- macOS Gatekeeper 签名
- 端口管理
- 杀毒软件误报

### 推荐路线

1. **Phase 1 (P0)**：A 模式 — 便携数据目录（TASK-028B/C/D）
2. **Phase 2 (P1)**：OpenClaw config 路径环境变量探针（TASK-028E）
3. **Phase 3 (P2)**：B 模式 — 便携 runtime（TASK-028F/G）

### 最大风险

- 当前的 `chatProjects` 在 `localStorage` — 项目分组在换电脑后丢失
- OpenClaw config 在 `~/.openclaw/` — 无法跟随 U 盘
- Windows WebView2 不是系统内置 — 需要单独安装或嵌入

---

## 二、当前数据路径审计

| 数据类型 | 当前路径/机制 | 是否随 U 盘走 | 风险 | 建议 |
|---|---|---|---|---|
| **chat-sessions.json** | `app.data_dir() + /chat-sessions.json` (Tauri) | ❌ 固定在 OS 数据目录 | 换电脑后历史丢失 | 迁移到 portable data dir |
| **config.json** (AppConfig) | `app.data_dir() + /config.json` (Tauri) | ❌ | 换电脑后配置丢失 | 迁移 |
| **chatProjects** | `localStorage` (key: `ai-agent-workspace-chat-projects`) | ❌ 浏览器本地存储 | **P0 风险** — 换电脑项目全部丢失 | 必须迁移到 portable JSON |
| **OpenClaw config** | `~/.openclaw/openclaw.json` (硬编码, `home_dir()`) | ❌ 固定在家目录 | Gateway token/model/providers 都在这 | 无法迁移（runtime 管理） |
| **model token** | 写入 `~/.openclaw/openclaw.json` (Rust `apply_openclaw`) | ❌ | token 跟随 raw runtime | 不在 App 内独立存 |
| **Hermes config** | `~/.hermes/config.yaml` (legacy) | ❌ | legacy，不阻 B 模式 | 不迁移 |
| **memory/skills** | `~/.hermes/memory/`, `~/.hermes/skills/` (legacy) | ❌ | legacy | 不迁移 |
| **App 日志** | 控制台输出 + Tauri dev 模式日志 | N/A | 无持久化日志 | 可后置 |
| **Skill Center 安装** | 无（当前无安装） | N/A | 未来需要规划 | 见 §7 |
| **device identity** | `app.data_dir() + /openclaw-device-identity.json` (Rust) | ❌ | WebSocket 配对用 | 移到 portable dir |

### 路径来源代码

| 路径 | 代码位置 |
|---|---|
| `app_data_dir()` | `main.rs:44`, `main.rs:50` |
| `home_dir()` | `main.rs:172` (标准 `dirs::home_dir`) |
| `~/.openclaw/openclaw.json` | `main.rs:2308` (硬编码) |
| `~/.hermes/` | `main.rs:395` (legacy) |
| `localStorage` | `storage.ts:25` (config fallback) + `chatProjects.ts:25` |

---

## 三、A 模式：便携数据模式方案

### 3.1 USB/data 目录结构草案

```
D:/AI-Workspace/              (U 盘根)
├── app/                       (App 程序)
│   └── ai-agent-workspace.exe (或 .app)
├── data/                      (便携数据)
│   ├── chat-sessions.json     (会话历史)
│   ├── chat-projects.json     (项目分组 — 从 localStorage 迁移)
│   ├── app-config.json        (App 配置)
│   ├── device-identity.json   (WebSocket 设备身份)
│   ├── workspace/             (工作区文件)
│   ├── logs/                  (日志 — 后续)
│   └── skills/                (已安装 skill — 后续)
├── runtime/                   (B 模式 — 后续)
└── start.bat / start.command  (启动脚本)
```

### 3.2 必须迁移项 (Phase 1)

| 数据 | 当前位置 | 迁移到 |
|---|---|---|
| chat-sessions.json | `app_data_dir()` | `data/chat-sessions.json` |
| chatProjects | `localStorage` | `data/chat-projects.json` |
| AppConfig | `app_data_dir() + config.json` | `data/app-config.json` |
| device identity | `app_data_dir() + openclaw-device-identity.json` | `data/device-identity.json` |

### 3.3 迁移关键挑战

1. **localStorage → JSON 文件**：当前 `chatProjects.ts` 直接操作 `localStorage`。需要改为读写 JSON 文件（通过 Tauri Rust command 或 `__TAURI__` fs API）。

2. **路径检测**：需要实现 "检测 U 盘 data 目录是否存在" 的逻辑。如不存在，fallback 到默认 `app_data_dir()`。

3. **可写性**：U 盘可能只读/无权限。需要检测并给出友好错误。

---

## 四、B 模式：内置 runtime 方案

### 4.1 Node.js portable runtime

- Windows：可从 `nodejs.org` 下载官方 zip，解压到 `runtime/node/`，通过 `start.bat` 设置 PATH
- macOS：可用 `node` binary 或使用 `nvm` 管理的已安装版本
- 风险：不同架构 (x64/arm64) 需要不同 binary

### 4.2 OpenClaw runtime

- OpenClaw 通常通过 `curl | bash` 安装到 `~/.local/bin/openclaw`
- 可考虑打包预编译 binary 到 `runtime/openclaw/`
- 需要设置 `OPENCLAW_HOME` 环境变量指向 `data/.openclaw` 以隔离配置

### 4.3 Gateway 启动/停止

- 通过 `openclaw gateway start` / `openclaw gateway restart` 管理
- 需要确保端口 18789 不与本地冲突
- 可能需要自定义端口（`openclaw config set gateway.port`）

### 4.4 Tauri sidecar

- Tauri 支持 `externalBin` 字段在 `tauri.conf.json` 中配置 sidecar 进程
- 可用 `Command::new_sidecar("openclaw")` 调用
- 当前 App 没有使用 sidecar — 都是通过 `Command::new()` 系统调用

---

## 五、Windows 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **WebView2 runtime** | Tauri 依赖 WebView2，Windows 默认未安装 | 从 Tauri 分发嵌入版 WebView2 或检测后自动安装 |
| **杀毒软件误报** | 便携 exe 容易被标记 | 签名 + 提交到 Microsoft Defender |
| **U 盘盘符变化** | `D:` → `E:` 导致路径失效 | 使用相对路径 + 环境变量 |
| **路径空格/中文** | 中文用户名/盘符导致 command 失败 | 路径加引号，Rust 使用 `PathBuf` |
| **端口冲突** | 18789 已被占用 | 检测端口 + 提示用户 |
| **普通用户权限** | 无法写入 exe 目录 | 数据目录与 app 目录分离 |
| **Windows native vs WSL2** | OpenClaw 不支持 WSL2 路径 | 不做 WSL2 支持（产品边界） |

---

## 六、macOS 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **Gatekeeper** | 未签名 app 被阻止 | macOS 签名 + 公证 |
| **quarantine** | 下载的 app 被隔离 | `xattr -d com.apple.quarantine` 或正确签名 |
| **外置盘权限** | App 无权访问外部磁盘 | 需要用户授权 "完全磁盘访问" |
| **Apple Silicon** | arm64 和 x64 不兼容 | 构建通用 binary |
| **.app bundle** | 从 U 盘运行 `.app` 需要打包 | 可考虑分发 `.dmg` 安装到 `/Applications`，数据从 U 盘读取 |

---

## 七、Skill Center 与 portable-data 的关系

| 问题 | 答案 |
|---|---|
| 已安装 skill 应放在哪里？ | `data/skills/` 或 `data/.openclaw/skills/` |
| 内置工作流在哪里？ | `src/data/skills.ts` 编译到 app bundle 中（不需要迁移） |
| ClawHub 安装目录如何与 USB/data 对齐？ | 通过 `OPENCLAW_HOME` 控制 OpenClaw 工作目录 |
| 为什么不能先安装再改路径？ | 如果先允许安装到系统路径，后续迁移成本高。应先确定 portable 策略再开放安装 |
| 安全策略 | 不默认安装第三方、需权限说明、安装前确认 |

---

## 八、安全策略

| 规则 | 说明 |
|---|---|
| 不默认安装第三方插件 | 所有安装需要用户明确操作 |
| 不自动执行外部 shell | 所有 CLI 命令需要在用户确认后执行 |
| 插件安装权限说明 | 展示 skill 所需权限 + 用户确认 |
| 日志脱敏 | portable-data 日志不包含 token/baseUrl/provider |
| Token 隔离 | Token 不存 portable-data；由 OpenClaw config 管理 |
| 加密建议 | `data/config.json` 不应明文存 token（如需要，可考虑 macOS Keychain / Windows Credential Manager） |

---

## 九、推荐任务拆分

| Task ID | 内容 | 优先级 |
|---|---|---|
| TASK-028B | Portable data 目录设计与路径检测 | P0 |
| TASK-028C | chat-projects localStorage → chat-projects.json 迁移 | P0 |
| TASK-028D | Portable data mode 最小实现（读取 portable dir，fallback default）| P0 |
| TASK-028E | OPENCLAW_HOME / portable runtime 探针 | P1 |
| TASK-028F | Windows portable 启动脚本 (.bat) | P2 |
| TASK-028G | macOS portable 启动方案 (.command) | P2 |
| TASK-028H | Portable 安全策略与数据脱敏 | P2 |

---

## 十、不建议现在做什么

| 项目 | 原因 |
|---|---|
| 直接打包 Node.js | 架构/签名/杀毒问题未解决 |
| 直接打包 OpenClaw runtime | 需要先稳定 portable OpenClaw 安装流程 |
| 直接改所有数据路径 | 应先做 POC portable data dir |
| 直接安装 ClawHub 插件 | 先确定 portable 存储策略 |
| 承诺完全免安装 | B 模式需要大量准备工作 |
| 处理 WSL2 完整迁移 | 不是产品方向 |
