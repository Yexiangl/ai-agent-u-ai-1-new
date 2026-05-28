# macOS Portable Startup Design

TASK-028G：macOS Portable 启动方案。

日期：2026-06-01 | 本轮为方案设计 + example 脚本草案，不执行启动/停止/安装。

---

## 一、Portable 目录结构

```
/Volumes/AI-Workspace/              ← U盘或本地安装根
├── AI-Workspace.app                 ← Tauri .app (macOS bundle)
├── data\
│   ├── portable.json                ← portable mode 标志
│   ├── app\
│   │   ├── chat-sessions.json
│   │   └── chat-projects.json
│   └── openclaw\                    ← future B mode data
├── runtime\
│   ├── node\
│   │   └── bin\
│   │       └── node                 ← Node.js portable
│   └── openclaw\
│       └── bin\
│           └── openclaw             ← OpenClaw runtime (future)
└── scripts\
    ├── start-macos.example.command  ← 启动脚本草案
    └── stop-macos.example.command   ← 停止脚本草案
```

---

## 二、macOS .app 层级风险分析

### 2.1 当前 Rust 代码中的路径推导

```rust
std::env::current_exe()
    .parent()       // Contents/MacOS/
    .parent()       // Contents/
    .parent()       // AI-Workspace.app/
    .join("data")   // AI-Workspace.app/data/ ❌ WRONG!
```

**问题**：macOS `.app` 是一个目录（bundle），内部结构为：
```
AI-Workspace.app/
└── Contents/
    └── MacOS/
        └── <binary>
```

从 `<binary>` 往上 3 级到达的是 `.app/` 而不是 `.app/../`。所以：
```
exe/../../data/ = AI-Workspace.app/data/ ❌

期望：AI-Workspace/data/  ← 与 .app 同级
```

### 2.2 修正方案

```rust
fn portable_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // Step 1: go up from binary
    let mut current = exe.parent()?;

    // macOS: check if we're inside a .app bundle
    if current.to_str().map(|s| s.contains(".app/Contents/MacOS")).unwrap_or(false)
        || current.to_str().map(|s| s.contains(".app/Contents/MacOS")).unwrap_or(false)
    {
        // Go up: MacOS → Contents → .app → parent
        current = current.parent()  // Contents
            .and_then(|p| p.parent())  // .app
            .and_then(|p| p.parent())?; // root dir
    }
    // On Windows/Linux: just go up from exe dir
    let data_dir = current.join("data");
    if data_dir.join("portable.json").exists() {
        return Some(data_dir);
    }
    None
}
```

### 2.3 风险总结

| 场景 | 当前行为 | 风险 | 建议 |
|---|---|---|---|
| Windows exe | `exe/../../data/` → correct | 低 | OK |
| macOS .app bundle | `exe/../../data/` → `AI-Workspace.app/data/` | **P1** — 永远不匹配 | TASK-028G-1 修正 |
| macOS dev mode | `cargo tauri dev` → `target/debug/` | 不需要 portable | skip |
| Linux 安装 | `/usr/bin/` → 异常 | 低 | 不适用 |

---

## 三、启动脚本草案

### `start-macos.example.command`

```bash
#!/bin/bash
set -euo pipefail

# ── Locate project root (script's parent directory) ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

# ── Paths ──
APP_PATH="$ROOT/AI-Workspace.app"
DATA_DIR="$ROOT/data"
APP_DATA_DIR="$DATA_DIR/app"
RUNTIME_DIR="$ROOT/runtime"
NODE_DIR="$RUNTIME_DIR/node"
NODE_BIN="$NODE_DIR/bin/node"
OPENCLAW_DIR="$RUNTIME_DIR/openclaw"
OPENCLAW_BIN="$OPENCLAW_DIR/bin/openclaw"

echo "=== AI Agent Workspace - Portable Launcher (macOS) ==="

# ── Check portable mode ──
if [ ! -f "$DATA_DIR/portable.json" ]; then
    echo "[INFO] portable mode not enabled. Running in standard mode."
    echo "[INFO] Create \"$DATA_DIR/portable.json\" to enable portable mode."
fi

# ── Check runtime ──
if [ ! -x "$NODE_BIN" ]; then
    echo "[WARN] Node.js runtime not found at $NODE_BIN"
    echo "[INFO] Node.js portable runtime is optional for B-mode."
    echo "[INFO] Download from https://nodejs.org/dist/ and extract to runtime/node/"
else
    echo "[OK] Node.js runtime found: $("$NODE_BIN" --version 2>/dev/null || echo 'unknown')"
fi

if [ ! -d "$OPENCLAW_DIR" ]; then
    echo "[INFO] OpenClaw runtime directory not found."
    echo "[INFO] OpenClaw runtime will be available in a future version."
else
    echo "[OK] OpenClaw runtime directory found."
fi

# ── Set environment variables ──
export AI_WORKSPACE_ROOT="$ROOT"
export AI_WORKSPACE_DATA="$APP_DATA_DIR"
export AI_WORKSPACE_PORTABLE=1
if [ -d "$NODE_DIR/bin" ]; then
    export PATH="$NODE_DIR/bin:$PATH"
fi

# ── Gateway check ──
if nc -z 127.0.0.1 18789 2>/dev/null; then
    echo "[OK] Gateway port 18789 is already in use (may reuse existing Gateway)"
else
    echo "[INFO] Gateway port 18789 is free."
fi

# ── Launch App ──
if [ ! -d "$APP_PATH" ]; then
    echo "[ERROR] Application not found at $APP_PATH"
    read -p "Press Enter to exit..."
    exit 1
fi

echo "[INFO] Starting AI-Workspace desktop app..."
open "$APP_PATH"

echo "[DONE] AI Agent Workspace launched."
echo "[INFO] Close this terminal window or press Ctrl+C to stop."

# Keep terminal open for a moment so user can see output
sleep 2
exit 0
```

### `stop-macos.example.command`

```bash
#!/bin/bash
set -euo pipefail

echo "============================================"
echo " AI Agent Workspace - Stop Script (DRAFT)"
echo "============================================"
echo ""
echo "This is a script DRAFT for the portable version."
echo "It does NOT stop any processes in the current version."
echo ""
echo "In a future version, this script will:"
echo "  1. Read the Gateway PID from data/openclaw/gateway.pid"
echo "  2. Verify the process belongs to this portable workspace"
echo "  3. Gracefully stop only the portable Gateway"
echo ""
echo "It will NOT:"
echo "  - Stop user-installed OpenClaw instances"
echo "  - Kill unrelated node / openclaw processes"
echo "  - Use 'pkill' or 'killall' blindly"
echo "  - Terminate the desktop app (AI-Workspace.app)"
echo ""
echo "Current version: manual stop in the AI-Workspace app settings."
echo "============================================"
read -p "Press Enter to continue..."
exit 0
```

---

## 四、环境变量设计

| 变量 | 用途 | 状态 |
|---|---|---|
| `AI_WORKSPACE_ROOT` | 项目根目录 | 草案 |
| `AI_WORKSPACE_DATA` | portable data dir | 草案 |
| `AI_WORKSPACE_PORTABLE=1` | 便携模式标志 | 草案 |
| `OPENCLAW_HOME` | OpenClaw 工作目录 | 待验证 |
| `OPENCLAW_WORKSPACE` | OpenClaw workspace | 待验证 |
| `DYLD_LIBRARY_PATH` | 不设置（安全） | — |
| `PATH` | 追加 Node binary | 草案 |

---

## 五、Gateway / 端口检测

| 方法 | 说明 |
|---|---|
| `nc -z 127.0.0.1 18789` | 快速 TCP 端口检测 |
| `lsof -i :18789` | 查看占用进程 |
| App 内 Rust TCP connect | 已有探针 |

策略：
- 端口被占用 → 提示复用，不抢端口
- 不 `pkill`、不 `killall`
- 后续通过 PID file 精确停止

---

## 六、Gatekeeper / quarantine / 签名

### 6.1 风险矩阵

| 风险 | 影响 | 缓解 |
|---|---|---|
| **Gatekeeper** | 未签名 .app 被阻止运行 | 签名 + 公证 |
| **quarantine** | 下载后 `com.apple.quarantine` 导致无法打开 | 签名可避免；外置盘签名仍可能需要 |
| **外置盘运行** | macOS 可能提示权限 | 用户批准后可运行 |
| **.command 首次运行** | Terminal 需要权限 | 需用户批准一次 |
| **企业限制** | MDM 可能禁止外置盘执行 | 不承诺 |
| **Apple Silicon** | arm64 binary | Universal binary 构建 |
| **Intel Mac** | x64 binary | Universal binary 构建 |

### 6.2 签名建议

- 正式发布使用 Apple Developer 签名 + 公证
- 不建议让用户手动执行 `xattr -dr com.apple.quarantine`（降低安全）
- 不建议让用户执行 `spctl --master-disable`（极度危险）
- 不建议让用户执行 `codesign --force --deep`（不是常态操作）

---

## 七、权限与文件访问

| 场景 | 预期 | 处理 |
|---|---|---|
| 外置盘读取 data/ | 默认允许 | 正常 |
| 外置盘写入 data/app/ | 默认允许 | portable mode 检测 |
| AI 文件库上传 | 用户显式选择 | 通过 Tauri dialog |
| 文档/桌面访问 | 需要用户授权 | 首次提示授权 |
| 完全磁盘访问 | 不需要 | 不申请 |
| App Sandbox | 暂时不启用 | 否则外置盘受限 |

---

## 八、PID 文件隔离（后续）

```
data/openclaw/gateway.pid

格式: <PID>\n<process_name>\n<start_time>

启动时:
  - 写入 PID + process name + start time
  - 用于 stop 脚本精确识别

停止时:
  - 读取 PID file
  - 校验进程命令行包含本 portable runtime 路径
  - 使用 kill <PID>（不是 pkill/killall）
  - 作业失败：不 touch 其他进程
```

---

## 九、安全边界

- 不存 Token 到脚本/环境变量
- 不写 provider/baseUrl/API URL/Authorization/Bearer
- 不读取 .env
- 不盲目执行外部命令
- 不盲目 pkill/killall
- 不复制 OpenClaw config 到 U 盘

---

## 十、后续任务拆分建议

| Task ID | 内容 |
|---|---|
| TASK-028G-1 | macOS .app bundle root 路径推导修正 |
| TASK-028G-2 | macOS startup script template → 可执行版 |
| TASK-028G-3 | 签名 / 公证 / quarantine 处理方案 |
| TASK-028G-4 | Apple Silicon / Intel Universal binary |
| TASK-028G-5 | 外置盘权限与文件访问回归 |
