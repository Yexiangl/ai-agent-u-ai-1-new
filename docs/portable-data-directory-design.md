# Portable Data 目录设计与路径检测

TASK-028B：Portable Data 目录设计与路径检测策略。

日期：2026-06-01 | 本轮为设计文档，不改数据路径，不迁移数据。

---

## 一、Portable Data 目录结构

### 1.1 推荐目录布局

```
AI-Workspace/                    ← U 盘根目录 或 本地安装目录
├── app/                         ← App 可执行文件 (安装/便携)
│   ├── AI-Workspace.exe         (Windows)
│   ├── AI-Workspace.app/        (macOS bundle)
│   └── resources/               (Tauri 资源)
│
├── data/                        ← ★ 便携数据根目录
│   ├── portable.json            ← portable 标志文件 (空文件或 {version:1})
│   │
│   ├── app/                     ← App 自身数据
│   │   ├── chat-sessions.json   ← 会话历史
│   │   ├── chat-projects.json   ← 项目分组 (从 localStorage 迁移)
│   │   ├── preferences.json     ← App 配置 (替代 config.json)
│   │   ├── device-identity.json ← WebSocket 设备身份
│   │   └── skill-center.json    ← 已启用 skill 列表 (from AppConfig)
│   │
│   ├── openclaw/                ← OpenClaw 数据 (B 模式)
│   │   ├── config-summary.json  ← 安全摘要 (无 token)
│   │   ├── workspace/           ← OpenClaw workspace
│   │   ├── memory/              ← OpenClaw 记忆
│   │   ├── skills/              ← 已安装 skill
│   │   └── logs/                ← Gateway 日志
│   │
│   ├── workspace/               ← 用户工作区文件
│   │   ├── files/               ← AI 文件库上传
│   │   ├── exports/             ← 保存的回复 (generated/)
│   │   └── temp/                ← 临时文件
│   │
│   ├── logs/                    ← App 日志
│   │   ├── app.log
│   │   └── gateway.log
│   │
│   └── backup/                  ← 数据备份
│       └── chat-sessions.json.bak.*
│
├── runtime/                     ← (B 模式) 便携 runtime
│   ├── node/                    ← Node.js portable
│   └── openclaw/                ← OpenClaw binary
│
└── scripts/                     ← 启动/停止脚本
    ├── start-windows.bat
    ├── start-macos.command
    ├── stop-windows.bat
    └── stop-macos.command
```

### 1.2 目录用途说明

| 目录 | 用途 | 优先级 |
|---|---|---|
| `data/` | portable data 根，包含 `portable.json` 标志文件 | P0 |
| `data/app/` | App 自身的持久化数据 (会话/项目/配置) | P0 |
| `data/workspace/` | 用户工作区文件 (AI 文件库/导出) | P1 |
| `data/openclaw/` | OpenClaw B 模式数据 (摘要/workspace/skills) | P2 |
| `data/logs/` | App 和 Gateway 日志 | P2 |
| `data/backup/` | 数据备份轮转 | P1 |
| `runtime/` | Node.js + OpenClaw portable binary | P2 |
| `scripts/` | 启动/停止脚本 | P2 |

### 1.3 Token 安全边界

- `data/openclaw/config-summary.json` — 只存安全摘要（模型名/状态），**不存 token/provider/baseUrl/API URL**
- Token 仍由 `~/.openclaw/openclaw.json` (OpenClaw runtime 管理) 存储
- `data/app/preferences.json` — 不存 apiKey、model token、gateway token
- Skill 安装的第三方技能须经安全审查，不默认安装

---

## 二、路径模式设计

### 2.1 system mode (默认)

```
特征: data/portable.json 不存在
数据根: Tauri app_data_dir()  (OS 系统数据目录)
示例:
  macOS:   ~/Library/Application Support/ai-agent-workspace/
  Windows: C:\Users\<User>\AppData\Roaming\ai-agent-workspace\
```

适用场景：普通安装运行，数据固定在系统目录。

### 2.2 portable mode

```
特征: data/portable.json 存在于 App 同级目录
数据根: <AppDir>/../data/
检测方法: 向上查找 data/portable.json
```

适用场景：U 盘便携运行，数据跟随 App 目录移动。

### 2.3 模式检测逻辑 (TypeScript 层面)

```ts
type PortableMode = "system" | "portable";

interface PortableDataStatus {
  mode: PortableMode;
  appDataDir: string;            // 实际数据根目录
  portableDataDir?: string;      // portable data dir (如果检测到)
  portableDataExists: boolean;   // data/portable.json 是否存在
  writable: boolean;            // 数据目录是否可写
  reason?: string;               // 附加说明
}

async function detectPortableMode(): Promise<PortableDataStatus> {
  // 1. 获取 App 所在目录 (通过 Tauri __TAURI__ API 或 Rust command)
  // 2. 向上查找 data/portable.json
  // 3. 如果存在：portable mode → data dir = appDir/../data/
  // 4. 如果不存在：system mode → data dir = app_data_dir()
  // 5. 检查 writable (创建临时 probe 文件)
  // 6. 返回 PortableDataStatus
}
```

### 2.4 模式选择规则

| 条件 | 模式 | 说明 |
|---|---|---|
| `data/portable.json` 存在且可写 | portable | 正常便携运行 |
| `data/portable.json` 存在但不可写 | portable (readonly) | 提示用户检查 U 盘权限 |
| `data/portable.json` 不存在 | system | 使用系统数据目录 |
| 首次创建 `data/portable.json` | 需用户确认 | "是否启用便携数据模式？" |

### 2.5 模式切换策略

- 默认：system mode
- 首次检测到 portable：提示用户 "检测到便携数据目录，是否启用？"
- 启用后：数据路径切换到 portable dir
- system mode 旧数据 **不自动迁移** — 用户可选择手动复制
- 用户确认后才创建 data/ 目录中缺失的子目录

### 2.6 路径显示策略

- 用户 UI：不显示完整绝对路径（隐私保护）
- 显示："系统默认位置" 或 "U 盘数据目录"
- 高级诊断：可显示安全摘要路径（如 `data/app/chat-sessions.json`）

---

## 三、chatProjects 迁移前置设计

### 3.1 当前状态

- 存储位置：`localStorage` (key: `ai-agent-workspace-chat-projects`)
- 数据类型：`ChatProject[]` (只包含 custom 项目，system 项目运行时生成)

### 3.2 目标状态

- 存储位置：
  - system mode: `app_data_dir()/chat-projects.json`
  - portable mode: `data/app/chat-projects.json`
- 格式：`ChatProject[]` JSON 数组

### 3.3 迁移策略 (TASK-028C 实现)

```
Phase 1: 检测
  - 检查 localStorage 是否有 projects 数据
  - 检查目标 chat-projects.json 是否存在

Phase 2: 迁移
  - 如果 localStorage 有数据 + JSON 文件不存在：
    → 写入 chat-projects.json
    → 保留 localStorage 数据作为 fallback (1 个版本周期)
  - 如果 JSON 文件存在：
    → 优先读取 JSON 文件
    → localStorage 作为 secondary source (merge 策略)

Phase 3: 清理 (后续版本)
  - 移除 localStorage fallback
  - 只从 JSON 文件读写
```

### 3.4 Orphan projectId 处理

- 如果 session.projectId 指向不存在的项目 → fallback 到 `"default"`
- 首次运行确保 `"default"` 项目存在

---

## 四、chatSessions 路径抽象

### 4.1 当前

```
sessions_path = app_data_dir() + "/chat-sessions.json"
```

### 4.2 目标

```ts
// 抽象路径获取
function getSessionsPath(): string {
  return join(getAppDataRoot(), "chat-sessions.json");
}

function getProjectsPath(): string {
  return join(getAppDataRoot(), "chat-projects.json");
}

function getPreferencesPath(): string {
  return join(getAppDataRoot(), "preferences.json");
}

// system mode:   app_data_dir()
// portable mode: data/app/
function getAppDataRoot(): string {
  if (isPortableMode()) return portableDataRoot;
  return appDataDir;
}
```

### 4.3 实现步骤 (分阶段)

| 阶段 | 任务 | 任务 ID |
|---|---|---|
| 引入抽象 | 定义 getSessionsPath / getProjectsPath | TASK-028D |
| system mode | 保持现有 app_data_dir() 行为 | TASK-028D |
| portable mode | 切换到 data/app/ | TASK-028D |
| chat-sessions 不变 | 暂时不改路径 | TASK-028D |

---

## 五、OpenClaw config / runtime 后置策略

### 5.1 A 模式阶段 (本阶段)

- **不迁移** `~/.openclaw/` 配置
- App 自身数据可 portable，OpenClaw config 仍由 runtime 管理
- 用户需要在每台电脑上单独安装和配置 OpenClaw

### 5.2 B 模式阶段 (后续)

- 通过 `OPENCLAW_HOME` 环境变量指定 OpenClaw 工作目录
- `data/openclaw/` 作为 OpenClaw 的替代 `~/.openclaw/`
- 检测：B 模式启动时设置 `OPENCLAW_HOME=$APPDIR/../data/openclaw`
- Token 仍由 OpenClaw runtime 管理，不单独存 app data

### 5.3 与 Skill Center 的关系

- 已安装 skill 路径：`data/openclaw/skills/` (B 模式) 或 `~/.openclaw/skills/` (A 模式)
- Skill Center 显示 `openclaw skills list` 输出
- 安装 skill 时用 `openclaw skill install --home <data/openclaw>` (B 模式)

---

## 六、Windows/macOS 风险说明

### 6.1 Windows 盘符变化

- U 盘盘符 (D:/E:/F:) 每次插入可能变化
- 解决：使用相对路径，从 App 所在目录向上查找 `data/`
- `tauri.conf.json` 的 `bundle` 配置中 resource 路径不能使用绝对盘符

### 6.2 路径空格/中文

- Rust `PathBuf` 已处理特殊字符
- Tauri fs API 使用 UTF-8 路径
- CLI 命令参数需要加引号（`openclaw "--home" "path with spaces"`）

### 6.3 U 盘权限

- 只读 U 盘：检测 writable → 提示用户 "数据目录不可写，请检查 U 盘写保护开关"
- 写入失败：捕获 IOException → 提示 + fallback 到 system mode memory buffer

### 6.4 macOS 外置盘

- 路径：`/Volumes/<DISK_NAME>/AI-Workspace/data/`
- 盘名变化不影响（相对路径检测）
- macOS 外置盘默认可读可写
- `com.apple.quarantine` 只在 app bundle 层面，不在数据文件

### 6.5 Gatekeeper/签名

- 只在 B 模式 app bundle 启动时相关
- A 模式（已安装 app + U 盘数据）不受影响

---

## 七、后续任务建议

| Task ID | 内容 | 优先级 | 依赖 |
|---|---|---|---|
| TASK-028C | chatProjects localStorage → chat-projects.json 迁移 | P0 | TASK-028B |
| TASK-028D | Portable data mode 最小实现 (detect + getAppDataRoot) | P0 | TASK-028B |
| TASK-028E | OPENCLAW_HOME / portable runtime 探针 | P1 | TASK-028D |
| TASK-028F | Windows portable 启动脚本 | P2 | TASK-028E |
| TASK-028G | macOS portable 启动方案 | P2 | TASK-028E |
| TASK-028H | Portable 安全策略与数据脱敏 | P2 | TASK-028D |

---

## 八、本轮不做

- 不迁移 chatProjects
- 不改 chat-sessions.json 读写
- 不改 OpenClaw config
- 不打包 runtime
- 不执行外部命令
- 不写入 portable 数据
- 不创建 data/ 目录
