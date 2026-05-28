# Windows Portable Startup Design

TASK-028F：Windows Portable 启动脚本方案。

日期：2026-06-01 | 本轮为方案设计 + example 脚本草案，不执行启动/停止/安装。

---

## 一、Portable 目录结构

```
D:\AI-Workspace\              ← U盘根或本地安装根
├── app\
│   └── AI-Workspace.exe      ← Tauri 桌面应用
├── data\
│   ├── portable.json          ← portable mode 标志
│   └── app\
│       ├── chat-sessions.json
│       └── chat-projects.json
├── runtime\
│   ├── node\
│   │   └── node.exe           ← Node.js portable
│   └── openclaw\              ← OpenClaw runtime (future)
├── scripts\
│   ├── start-windows.example.bat   ← 启动脚本草案
│   └── stop-windows.example.bat    ← 停止脚本草案
└── README-portable.txt        ← 使用说明
```

---

## 二、启动脚本草案

### `start-windows.example.bat`

```bat
@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title AI Agent Workspace - Portable Launcher

:: ── Locate project root (script's parent directory) ──
set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR%.."

:: ── Paths ──
set "APP_DIR=%ROOT%\app"
set "DATA_DIR=%ROOT%\data"
set "APP_DATA_DIR=%DATA_DIR%\app"
set "RUNTIME_DIR=%ROOT%\runtime"
set "NODE_DIR=%RUNTIME_DIR%\node"
set "OPENCLAW_DIR=%RUNTIME_DIR%\openclaw"
set "SCRIPTS_DIR=%ROOT%\scripts"

:: ── Check portable mode ──
if not exist "%DATA_DIR%\portable.json" (
    echo [INFO] portable mode not enabled. Running in standard mode.
    echo [INFO] Create "%DATA_DIR%\portable.json" to enable portable mode.
)

:: ── Check runtime ──
if not exist "%NODE_DIR%\node.exe" (
    echo [WARN] Node.js runtime not found at %NODE_DIR%\node.exe
    echo [INFO] Node.js portable runtime is optional for B-mode.
    echo [INFO] Download from https://nodejs.org/dist/ and extract to runtime\node\
) else (
    echo [OK] Node.js runtime found.
)

if not exist "%OPENCLAW_DIR%" (
    echo [INFO] OpenClaw runtime directory not found.
    echo [INFO] OpenClaw runtime will be available in a future version.
) else (
    echo [OK] OpenClaw runtime directory found.
)

:: ── Set environment variables ──
set "AI_WORKSPACE_ROOT=%ROOT%"
set "AI_WORKSPACE_DATA=%APP_DATA_DIR%"
set "AI_WORKSPACE_PORTABLE=1"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

:: ── Port check ──
echo [INFO] Checking port 18789...
netstat -ano 2>nul | findstr ":18789" >nul
if %errorlevel% equ 0 (
    echo [OK] Gateway port 18789 is already in use (may reuse existing Gateway)
) else (
    echo [INFO] Gateway port 18789 is free.
)

:: ── Launch App ──
if not exist "%APP_DIR%\AI-Workspace.exe" (
    echo [ERROR] Application not found at %APP_DIR%\AI-Workspace.exe
    pause
    exit /b 1
)

echo [INFO] Starting AI-Workspace desktop app...
start "" "%APP_DIR%\AI-Workspace.exe"

echo [DONE] AI Agent Workspace launched.
echo [INFO] Close this window or press Ctrl+C to stop.
exit /b 0
```

### `stop-windows.example.bat`

```bat
@echo off
setlocal enabledelayedexpansion
title AI Agent Workspace - Portable Stop

echo ============================================
echo  AI Agent Workspace - Stop Script (DRAFT)
echo ============================================
echo.
echo This is a script DRAFT for the portable version.
echo It does NOT stop any processes in the current version.
echo.
echo In a future version, this script will:
echo   1. Read the Gateway PID from data\openclaw\gateway.pid
echo   2. Verify the process belongs to this portable workspace
echo   3. Gracefully stop only the portable Gateway
echo.
echo It will NOT:
echo   - Stop user-installed OpenClaw instances
echo   - Kill unrelated node.exe / openclaw.exe processes
echo   - Use taskkill /f blindly
echo   - Terminate the desktop app (AI-Workspace.exe)
echo.
echo Current version: manual stop in the AI-Workspace app settings.
echo ============================================
pause
exit /b 0
```

---

## 三、环境变量设计

| 变量 | 用途 | 状态 |
|---|---|---|
| `AI_WORKSPACE_ROOT` | 项目根目录 | 草案 |
| `AI_WORKSPACE_DATA` | portable data 目录 | 草案 |
| `AI_WORKSPACE_PORTABLE=1` | 便携模式标志 | 草案 |
| `OPENCLAW_HOME` | OpenClaw 工作目录 (future) | 待验证 |
| `OPENCLAW_WORKSPACE` | OpenClaw workspace (future) | 待验证 |
| `PATH` | 追加 Node binary | 草案 |

注意：
- 不在环境变量中写 Token
- 不写 provider/baseUrl/API URL
- 不写 Authorization/Bearer

---

## 四、端口检测策略

| 方法 | 说明 |
|---|---|
| `netstat -ano \| findstr ":18789"` | 快速检测端口占用 |
| `PowerShell Test-NetConnection` | 更精确但需要 PowerShell |
| App 内 Rust TCP connect | 已有 `portable_runtime_status` 探针 |

策略：
- 端口被占用 → 提示复用已有 Gateway，不抢端口
- 后续正式 portable Gateway 考虑独立端口（如 18790）或提示用户
- 不盲目杀进程

---

## 五、PID 文件设计（后续）

```
data/openclaw/gateway.pid

格式: <PID>
       <command_line_hash>

启动时:
  - 写入 PID + command line hash
  - 用于 stop 脚本校验

停止时:
  - 读取 PID file
  - 校验进程命令行包含本 portable runtime 路径
  - 仅停止本 workspace 启动的 Gateway
  - 不 touch 用户已有的 openclaw 进程
```

---

## 六、WebView2 说明

| 场景 | 处理 |
|---|---|
| Win11 | WebView2 系统自带 |
| Win10 新版 | 通常已安装 |
| Win10 旧版 / 无 WebView2 | 提示用户安装 Evergreen Runtime |
| 完全离线 | 随包附带 Standalone Installer |
| Tauri fixed WebView2 | 可评估嵌入方案 (增大体积) |

本任务不下载、不安装 WebView2。

---

## 七、安全风险与缓解

| 风险 | 缓解 |
|---|---|
| U 盘盘符变化 | 使用相对路径 `%~dp0..` |
| 中文/空格路径 | 路径全部加引号 `"%PATH%"` |
| 只读 U 盘 | `data/portable.json` 检测 + 提示 |
| Windows Defender | 正式 exe 签名 + 提交 Microsoft 审查 |
| SmartScreen | 代码签名证书 + 积累下载量 |
| 未签名 bat 拦截 | 改用 App 内启动器 或 签名 PowerShell |
| 执行策略限制 | 不依赖 `powershell -ExecutionPolicy` 绕过 |
| 企业禁用脚本 | 提供 App 内替代启动方式 |
| 盲目 taskkill | 严格禁止；只通过 PID file 校验后停止 |
| Token 泄露 | 不写入脚本、环境变量、日志 |

---

## 八、后续任务拆分建议

| Task ID | 内容 |
|---|---|
| TASK-028F-1 | 将 example.bat 改为可执行启动脚本 + 测试 |
| TASK-028F-2 | PID file 设计实现 |
| TASK-028F-3 | portable gateway 启动 command 验证 |
| TASK-028F-4 | WebView2 检测与提示 |
| TASK-028F-5 | Windows 签名 / SmartScreen 风险处理 |
