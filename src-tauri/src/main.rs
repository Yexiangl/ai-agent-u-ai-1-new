#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::collections::HashMap;
use std::io::{Read, BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use futures_util::StreamExt;
use calamine::Reader;
use tauri::{Emitter, Manager};

mod update;

type CancelMap = Mutex<HashMap<String, Arc<AtomicBool>>>;
type TaskMap = Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
fn hide_command_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_command_window(_command: &mut Command) {}

// TASK-068: Resolve the openclaw executable WITHOUT relying on the parent
// process PATH. After a fresh install the official script appends npm's global
// bin to the *user* PATH, but our already-running process keeps its stale PATH
// and would fail to find `openclaw` until restarted. So we probe the known
// install locations directly. The first hit is cached for the session.
fn resolve_openclaw_bin() -> String {
    static CACHE: OnceLock<String> = OnceLock::new();
    if let Some(found) = CACHE.get() {
        // Re-validate the cached non-bare path still exists; bare "openclaw"
        // (PATH lookup) is always considered usable.
        if found == "openclaw" || std::path::Path::new(found).exists() {
            return found.clone();
        }
    }

    // 1) Try a plain PATH lookup first (works when PATH is already fresh).
    //    Skipped on Windows: `Command::new("openclaw")` cannot resolve nor run
    //    the npm `.cmd` shim, so a bare-name hit here would be cached and then
    //    fail at actual invocation. On Windows we rely on the known_paths probe
    //    below, which returns the full `.cmd` path that openclaw_command() runs
    //    through `cmd /c`.
    #[cfg(not(windows))]
    {
        let mut probe = Command::new("openclaw");
        probe.arg("--version");
        hide_command_window(&mut probe);
        if probe.output().map(|o| o.status.success()).unwrap_or(false) {
            return CACHE.get_or_init(|| "openclaw".to_string()).clone();
        }
    }

    // 2) Probe known install locations that the official installer uses.
    for cand in openclaw_known_paths() {
        if cand.exists() {
            let s = cand.to_string_lossy().to_string();
            return CACHE.get_or_init(|| s.clone()).clone();
        }
    }

    // 3) Give up: fall back to the bare name (caller will surface the error).
    "openclaw".to_string()
}

// Candidate absolute paths for the openclaw launcher, per platform.
fn openclaw_known_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        // npm global install: %APPDATA%\npm\openclaw.cmd
        if let Ok(appdata) = std::env::var("APPDATA") {
            out.push(PathBuf::from(&appdata).join("npm").join("openclaw.cmd"));
        }
        // git-checkout wrapper: %USERPROFILE%\.local\bin\openclaw.cmd
        if let Ok(home) = std::env::var("USERPROFILE") {
            out.push(PathBuf::from(&home).join(".local").join("bin").join("openclaw.cmd"));
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = dirs_home() {
            out.push(home.join(".local").join("bin").join("openclaw"));
            out.push(home.join(".openclaw").join("bin").join("openclaw"));
        }
        // Common npm global prefixes on macOS/Linux.
        out.push(PathBuf::from("/opt/homebrew/bin/openclaw"));
        out.push(PathBuf::from("/usr/local/bin/openclaw"));
        out.push(PathBuf::from("/usr/bin/openclaw"));
    }
    out
}

#[cfg(not(windows))]
fn dirs_home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

// Build a Command for the openclaw CLI using the resolved binary path so it
// works even when the process PATH is stale (post-install, before restart).
// On Windows a `.cmd` shim must be launched through `cmd /c` rather than
// executed directly, so handle that case.
//
// Every returned Command has hide_command_window applied so no black console
// window flashes on Windows — this covers all ~18 call sites in one place
// (能力中心 / 技能列表 / clawhub all shell out through here).
fn openclaw_command() -> Command {
    let bin = resolve_openclaw_bin();
    #[cfg(windows)]
    {
        if bin.to_lowercase().ends_with(".cmd") || bin.to_lowercase().ends_with(".bat") {
            // Prefer running node + openclaw.mjs DIRECTLY instead of `cmd /c openclaw.cmd`.
            // The .cmd shim has no console (we set CREATE_NO_WINDOW on cmd), so when it
            // internally spawns node.exe (a console subsystem app) with no flags, Windows
            // allocates a NEW visible console for node → a black window flashes for the
            // duration of the CLI call. Launching node ourselves with CREATE_NO_WINDOW
            // keeps node console-less. Falls back to `cmd /c` if the .mjs can't be found.
            if let Some((node, mjs)) = resolve_openclaw_node_invocation(&bin) {
                let mut c = Command::new(node);
                c.arg(mjs);
                hide_command_window(&mut c);
                return c;
            }
            let mut c = Command::new("cmd");
            c.arg("/c").arg(&bin);
            hide_command_window(&mut c);
            return c;
        }
    }
    let mut c = Command::new(bin);
    hide_command_window(&mut c);
    c
}

// Windows: given the resolved openclaw `.cmd` shim path, derive (node_exe, openclaw.mjs)
// so we can run the CLI directly without the cmd→node console allocation that flashes
// a black window. The npm shim lives next to `node_modules/openclaw/openclaw.mjs`; node
// is either bundled beside the shim (`<dir>\node.exe`) or resolved via `where node`.
#[cfg(windows)]
fn resolve_openclaw_node_invocation(cmd_path: &str) -> Option<(String, String)> {
    let dir = std::path::Path::new(cmd_path).parent()?;
    let mjs = dir.join("node_modules").join("openclaw").join("openclaw.mjs");
    if !mjs.exists() {
        return None;
    }
    // Prefer a node.exe bundled alongside the shim (matches the shim's own IF EXIST check).
    let bundled = dir.join("node.exe");
    let node = if bundled.exists() {
        bundled.to_string_lossy().to_string()
    } else {
        // `node` is a real .exe (not a shim), so Command::new("node") + CREATE_NO_WINDOW
        // launches it window-less. resolve_node_exe() gives a full path when available.
        resolve_node_exe().unwrap_or_else(|_| "node".to_string())
    };
    Some((node, mjs.to_string_lossy().to_string()))
}

fn cancel_map() -> &'static CancelMap {
    static MAP: OnceLock<CancelMap> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn task_map() -> &'static TaskMap {
    static MAP: OnceLock<TaskMap> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_root(app)?;
    Ok(dir.join("config.json"))
}

// TASK-028G-1: Unified workspace root detection (Windows + macOS .app bundle)
pub(crate) fn workspace_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let current = exe.parent()?;

    // macOS: inside .app bundle → go up to .app's parent
    if let Some(s) = current.to_str() {
        if s.contains(".app/Contents/MacOS") {
            // current = .../Contents/MacOS
            // go up: MacOS -> Contents -> .app -> .app parent (workspace root)
            return Some(current.parent()?.parent()?.parent()?.to_path_buf());
        }
    }
    // Windows/Linux: current = .../app/
    // go up: app/ -> workspace root
    Some(current.parent()?.to_path_buf())
}

// TASK-028D: portable data mode — request vs availability
fn portable_requested(_app: &tauri::AppHandle) -> bool {
    if let Some(root) = workspace_root() {
        return root.join("data").join("portable.json").exists();
    }
    false
}

fn portable_available(_app: &tauri::AppHandle) -> bool {
    if let Some(root) = workspace_root() {
        let dir = root.join("data").join("app");
        if let Err(_) = fs::create_dir_all(&dir) { return false; }
        let probe = dir.join(".portable-write-test");
        if fs::write(&probe, b"ok").is_err() { return false; }
        let _ = fs::remove_file(&probe);
        return true;
    }
    false
}

fn effective_portable(app: &tauri::AppHandle) -> bool {
    portable_requested(app) && portable_available(app)
}

fn app_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if effective_portable(app) {
        if let Some(root) = workspace_root() {
            let dir = root.join("data").join("app");
            fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
            return Ok(dir);
        }
    }
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn chat_sessions_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_root(app)?;
    Ok(dir.join("chat-sessions.json"))
}

// Strip a leading UTF-8 BOM (0xEF 0xBB 0xBF) if present. Files written by our
// own app via fs::write never have one, but external files do: openclaw.json is
// written by the OpenClaw CLI, and users may hand-edit configs with editors
// (e.g. Notepad on Chinese Windows) that prepend a BOM. serde_json::from_str
// rejects a BOM, so strip it before parsing.
fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

// Read a UTF-8 file and parse it as JSON, tolerating a leading BOM.
fn read_json_file(path: &std::path::Path) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(strip_bom(&content)).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_config(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = config_path(&app)?;
    if path.exists() {
        match read_json_file(&path) {
            Ok(value) => return Ok(Some(value)),
            Err(_) => {
                // Main file corrupt (e.g. truncated by an old non-atomic write).
                // Fall back to the last good backup written by write_config.
                eprintln!("config.json parse error, trying backup...");
            }
        }
    }
    let bak = path.with_extension("json.bak");
    if bak.exists() {
        if let Ok(value) = read_json_file(&bak) {
            eprintln!("config.json recovered from backup");
            return Ok(Some(value));
        }
    }
    Ok(None)
}

#[tauri::command]
fn write_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = config_path(&app)?;
    let content = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;

    // Atomic write so a crash / power loss / U-disk pull mid-write can't leave a
    // truncated config.json (chat-sessions & usage-log already do this; config
    // was the last unprotected one). Keep one .bak of the previous good copy.
    let dir = path.parent()
        .ok_or_else(|| "无法定位配置目录".to_string())?;
    if path.exists() {
        let bak = path.with_extension("json.bak");
        // Best-effort backup; don't fail the whole write if the copy fails.
        let _ = fs::copy(&path, &bak);
    }
    let tmp_path = dir.join("config.json.tmp");
    fs::write(&tmp_path, &content).map_err(|error| format!("写入临时文件失败：{}", error))?;
    std::fs::rename(&tmp_path, &path).map_err(|error| format!("重命名临时文件失败：{}", error))
}

#[tauri::command]
fn clear_config(app: tauri::AppHandle) -> Result<(), String> {
    let path = config_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn read_chat_sessions(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = chat_sessions_path(&app)?;

    // Try reading main file first
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        if let Ok(value) = serde_json::from_str(strip_bom(&content)) {
            return Ok(value);
        }
        eprintln!("chat-sessions.json parse error, trying backups...");
    }

    // Try recovering from backups (bak.1, bak.2, bak.3)
    for i in 1..=3 {
        let bak = path.parent().unwrap().join(format!("chat-sessions.json.bak.{}", i));
        if bak.exists() {
            if let Ok(content) = fs::read_to_string(&bak) {
                if let Ok(value) = serde_json::from_str(strip_bom(&content)) {
                    eprintln!("chat-sessions.json recovered from bak.{}", i);
                    return Ok(value);
                }
            }
        }
    }

    eprintln!("chat-sessions.json all sources corrupt, returning empty");
    Ok(serde_json::json!([]))
}

#[tauri::command]
fn write_chat_sessions(app: tauri::AppHandle, sessions: serde_json::Value) -> Result<(), String> {
    let path = chat_sessions_path(&app)?;
    let content = serde_json::to_string_pretty(&sessions).map_err(|error| error.to_string())?;

    // Rotate backups before write (keep last 3 copies)
    rotate_chat_sessions_backups(&path)?;

    // Atomic write: write to temp file, then rename
    let dir = path.parent().unwrap();
    let tmp_path = dir.join("chat-sessions.json.tmp");
    fs::write(&tmp_path, &content).map_err(|error| format!("写入临时文件失败：{}", error))?;
    std::fs::rename(&tmp_path, &path).map_err(|error| format!("重命名临时文件失败：{}", error))
}

fn rotate_chat_sessions_backups(path: &PathBuf) -> Result<(), String> {
    let dir = path.parent().unwrap();

    // Remove bak.3 if exists
    let bak3 = dir.join("chat-sessions.json.bak.3");
    if bak3.exists() {
        fs::remove_file(&bak3).map_err(|e| format!("删除旧备份 bak.3 失败：{}", e))?;
    }

    // Rotate: bak.2 -> bak.3
    let bak2 = dir.join("chat-sessions.json.bak.2");
    if bak2.exists() {
        fs::rename(&bak2, &bak3).map_err(|e| format!("备份轮转 bak.2 -> bak.3 失败：{}", e))?;
    }

    // Rotate: bak.1 -> bak.2
    let bak1 = dir.join("chat-sessions.json.bak.1");
    if bak1.exists() {
        fs::rename(&bak1, &bak2).map_err(|e| format!("备份轮转 bak.1 -> bak.2 失败：{}", e))?;
    }

    // Rotate: current -> bak.1 (only if current exists)
    if path.exists() {
        fs::copy(path, &bak1).map_err(|e| format!("创建备份 bak.1 失败：{}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn clear_chat_sessions(app: tauri::AppHandle) -> Result<(), String> {
    let path = chat_sessions_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

// ── Persistent usage ledger (TASK-070) ───────────────────────────────────────
// An append-only record of token usage per completed turn, stored in its OWN
// file independent of chat-sessions.json. Deleting/clearing chats must NOT
// affect this, so usage totals reflect true lifetime consumption. Each record
// carries a unique `id` so the frontend can dedupe and never double-count.
fn usage_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_root(app)?;
    Ok(dir.join("usage-log.json"))
}

#[tauri::command]
fn read_usage_log(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = usage_log_path(&app)?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        if let Ok(value) = serde_json::from_str(strip_bom(&content)) {
            return Ok(value);
        }
        eprintln!("usage-log.json parse error, trying backups...");
    }
    for i in 1..=3 {
        let bak = path.parent().unwrap().join(format!("usage-log.json.bak.{}", i));
        if bak.exists() {
            if let Ok(content) = fs::read_to_string(&bak) {
                if let Ok(value) = serde_json::from_str(strip_bom(&content)) {
                    eprintln!("usage-log.json recovered from bak.{}", i);
                    return Ok(value);
                }
            }
        }
    }
    Ok(serde_json::json!([]))
}

// Append one usage record. Reads current log, pushes, writes atomically with
// rotating backups. Dedupes by `id` so repeated appends of the same turn are
// no-ops (defensive against retries / double done-callbacks).
#[tauri::command]
fn append_usage_log(app: tauri::AppHandle, record: serde_json::Value) -> Result<(), String> {
    let path = usage_log_path(&app)?;
    let mut arr: Vec<serde_json::Value> = match read_usage_log(app.clone())? {
        serde_json::Value::Array(a) => a,
        _ => Vec::new(),
    };
    if let Some(id) = record.get("id").and_then(|v| v.as_str()) {
        if arr.iter().any(|r| r.get("id").and_then(|v| v.as_str()) == Some(id)) {
            return Ok(()); // already recorded
        }
    }
    arr.push(record);
    let content = serde_json::to_string(&serde_json::Value::Array(arr)).map_err(|e| e.to_string())?;
    rotate_usage_log_backups(&path)?;
    let dir = path.parent().unwrap();
    let tmp_path = dir.join("usage-log.json.tmp");
    fs::write(&tmp_path, &content).map_err(|error| format!("写入临时文件失败：{}", error))?;
    std::fs::rename(&tmp_path, &path).map_err(|error| format!("重命名临时文件失败：{}", error))
}

fn rotate_usage_log_backups(path: &PathBuf) -> Result<(), String> {
    let dir = path.parent().unwrap();
    let bak3 = dir.join("usage-log.json.bak.3");
    if bak3.exists() { fs::remove_file(&bak3).map_err(|e| e.to_string())?; }
    let bak2 = dir.join("usage-log.json.bak.2");
    if bak2.exists() { fs::rename(&bak2, &bak3).map_err(|e| e.to_string())?; }
    let bak1 = dir.join("usage-log.json.bak.1");
    if bak1.exists() { fs::rename(&bak1, &bak2).map_err(|e| e.to_string())?; }
    if path.exists() { fs::copy(path, &bak1).map_err(|e| e.to_string())?; }
    Ok(())
}

// Explicit reset only — never called from chat deletion paths.
#[tauri::command]
fn clear_usage_log(app: tauri::AppHandle) -> Result<(), String> {
    let path = usage_log_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

// ── TASK-028C: chat-projects.json read/write ──

fn chat_projects_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_root(app)?;
    Ok(dir.join("chat-projects.json"))
}

#[tauri::command]
fn read_chat_projects(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = chat_projects_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(strip_bom(&content)).map_err(|error| format!("JSON parse error: {}", error))?;
    Ok(parsed)
}

#[tauri::command]
fn write_chat_projects(app: tauri::AppHandle, projects: serde_json::Value) -> Result<(), String> {
    let path = chat_projects_path(&app)?;
    let content = serde_json::to_string(&projects).map_err(|error| error.to_string())?;
    fs::write(&path, &content).map_err(|error| format!("写入失败：{}", error))
}

// TASK-028D: Report portable data mode status (no sensitive paths in output)
#[tauri::command]
fn portable_data_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let requested = portable_requested(&app);
    let available = portable_available(&app);
    let mode = if requested && available { "portable" } else { "system" };
    let root = app_data_root(&app)?;
    let writable = match std::fs::File::create(root.join(".probe_tmp")) {
        Ok(f) => { drop(f); let _ = std::fs::remove_file(root.join(".probe_tmp")); true }
        Err(_) => false,
    };
    let reason = if requested && !available {
        Some("portable data is not writable, fallback to system mode")
    } else {
        None
    };
    Ok(serde_json::json!({
        "mode": mode,
        "portableRequested": requested,
        "portableAvailable": available,
        "writable": writable,
        "reason": reason,
    }))
}

// TASK-028E: Probe portable runtime (read-only, no install/start/stop)
#[tauri::command]
fn portable_runtime_status() -> Result<serde_json::Value, String> {
    let mut warnings: Vec<String> = Vec::new();

    // Determine runtime root
    let runtime_root = workspace_root().unwrap_or_default().join("runtime");
    let runtime_exists = runtime_root.exists();
    if !runtime_exists {
        warnings.push("runtime directory not found".into());
    }

    // Node detection
    let node_paths = if cfg!(target_os = "windows") {
        vec!["node/node.exe", "node/bin/node.exe"]
    } else {
        vec!["node/bin/node"]
    };
    let node_found = node_paths.iter().any(|p| runtime_root.join(p).is_file());
    let node_exe = node_found;
    let mut node_version: Option<String> = None;
    if node_found {
        let node_bin = node_paths.iter().find_map(|p| {
            let path = runtime_root.join(p);
            if path.is_file() { Some(path) } else { None }
        });
        if let Some(bin) = node_bin {
            let mut probe = std::process::Command::new(&bin);
            probe.arg("--version");
            hide_command_window(&mut probe);
            if let Ok(out) = probe.output() {
                if out.status.success() {
                    node_version = String::from_utf8(out.stdout).ok().map(|s| s.trim().to_string());
                }
            }
        }
    }

    // OpenClaw detection
    let oc_paths = if cfg!(target_os = "windows") {
        vec!["openclaw/openclaw.cmd", "openclaw/openclaw.exe", "openclaw/bin/openclaw.cmd"]
    } else {
        vec!["openclaw/bin/openclaw", "openclaw/openclaw"]
    };
    let oc_found = oc_paths.iter().any(|p| runtime_root.join(p).is_file());
    let oc_exe = oc_found;
    let mut oc_version: Option<String> = None;
    if oc_found {
        let oc_bin = oc_paths.iter().find_map(|p| {
            let path = runtime_root.join(p);
            if path.is_file() { Some(path) } else { None }
        });
        if let Some(bin) = oc_bin {
            let mut probe = std::process::Command::new(&bin);
            probe.arg("--version");
            hide_command_window(&mut probe);
            if let Ok(out) = probe.output() {
                if out.status.success() {
                    oc_version = String::from_utf8(out.stdout).ok().map(|s| s.trim().to_string());
                }
            }
        }
    }

    // Scripts detection
    let scripts_root = workspace_root().unwrap_or_default().join("scripts");
    let start_win = scripts_root.join("start-windows.bat").is_file();
    let stop_win = scripts_root.join("stop-windows.bat").is_file();
    let start_mac = scripts_root.join("start-macos.command").is_file();

    // Gateway reachable via TCP probe
    let gw_reachable = match std::net::TcpStream::connect_timeout(
        &"127.0.0.1:18789".parse().unwrap(),
        std::time::Duration::from_millis(500),
    ) {
        Ok(_) => true,
        Err(_) => false,
    };
    let gw_status = if gw_reachable { "reachable" } else { "unreachable" };

    Ok(serde_json::json!({
        "runtimeRootExists": runtime_exists,
        "nodeFound": node_found,
        "nodeExecutable": node_exe,
        "nodeVersion": node_version,
        "openclawFound": oc_found,
        "openclawExecutable": oc_exe,
        "openclawVersion": oc_version,
        "scripts": {
            "startWindows": start_win,
            "stopWindows": stop_win,
            "startMacos": start_mac,
        },
        "gatewayReachable": gw_reachable,
        "gatewayStatus": gw_status,
        "portInUse": serde_json::Value::Null,
        "warnings": warnings,
    }))
}

fn checked_at() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs().to_string(),
        Err(_) => "0".to_string(),
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

fn redact_sensitive_content(content: &str) -> String {
    let mut output = String::new();
    for line in content.lines() {
        let lower = line.to_lowercase();
        if ["token", "api_key", "apikey", "secret", "password", "authorization", "bearer", "sk-"]
            .iter()
            .any(|needle| lower.contains(needle))
        {
            output.push_str("[REDACTED]\n");
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }
    output
}

fn memory_kind(path: &std::path::Path) -> &'static str {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_lowercase();
    if name == "memory.md" { "memory" }
    else if name == "user.md" { "user" }
    else if name == "soul.md" { "soul" }
    else if name == "agents.md" { "agents" }
    else if name == "heartbeat.md" { "heartbeat" }
    else if name == "identity.md" { "identity" }
    else if name == "tools.md" { "tools" }
    else { "unknown" }
}

fn memory_title(path: &std::path::Path, hermes_root: &std::path::Path) -> String {
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("memory");
    let relative = path.strip_prefix(hermes_root).ok().and_then(|p| p.to_str()).unwrap_or(file_name);
    if relative.contains("memories/users/") && file_name.eq_ignore_ascii_case("USER.md") {
        "用户记忆 USER.md".to_string()
    } else {
        file_name.to_string()
    }
}

fn collect_memory_file(files: &mut Vec<serde_json::Value>, hermes_root: &std::path::Path, path: PathBuf) {
    if !path.exists() || !path.is_file() {
        return;
    }
    if path.extension().and_then(|e| e.to_str()).map(|e| !e.eq_ignore_ascii_case("md")).unwrap_or(true) {
        return;
    }
    let Ok(canonical_root) = hermes_root.canonicalize() else { return; };
    let Ok(canonical_path) = path.canonicalize() else { return; };
    if !canonical_path.starts_with(&canonical_root) {
        return;
    }

    let metadata = match fs::metadata(&canonical_path) {
        Ok(metadata) => metadata,
        Err(_) => return,
    };
    let mut file = match fs::File::open(&canonical_path) {
        Ok(file) => file,
        Err(_) => return,
    };
    let mut buffer = vec![0u8; 50 * 1024];
    let bytes_read = match file.read(&mut buffer) {
        Ok(bytes_read) => bytes_read,
        Err(_) => return,
    };
    buffer.truncate(bytes_read);
    let content = redact_sensitive_content(&String::from_utf8_lossy(&buffer));
    let preview: String = content.chars().take(500).collect();
    let relative_path = canonical_path
        .strip_prefix(&canonical_root)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| canonical_path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string());
    let updated_at = metadata.modified().ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string());
    let kind = memory_kind(&canonical_path);
    let id = format!("{}-{}", kind, files.len() + 1);

    files.push(serde_json::json!({
        "id": id,
        "title": memory_title(&canonical_path, &canonical_root),
        "path": canonical_path.to_string_lossy().to_string(),
        "relativePath": relative_path,
        "kind": kind,
        "exists": true,
        "size": metadata.len(),
        "updatedAt": updated_at,
        "contentPreview": preview,
        "content": content,
        "readOnly": true
    }));
}

struct SseEvent {
    event: String,
    data: String,
}

fn parse_sse_line(line: &str, current_event: &mut SseEvent) -> Option<SseEvent> {
    if let Some(data) = line.strip_prefix("data: ") {
        if !current_event.data.is_empty() {
            current_event.data.push('\n');
        }
        current_event.data.push_str(data);
        return None;
    }
    if let Some(evt) = line.strip_prefix("event: ") {
        current_event.event = evt.trim().to_string();
        return None;
    }
    if line.is_empty() || line == "\r" {
        if current_event.data.is_empty() && current_event.event == "message" {
            return None;
        }
        let completed = SseEvent {
            event: std::mem::take(&mut current_event.event),
            data: std::mem::take(&mut current_event.data),
        };
        current_event.event = "message".to_string();
        return Some(completed);
    }
    None
}

#[tauri::command]
fn read_openclaw_workspace_memory() -> Result<serde_json::Value, String> {
    let Some(home) = home_dir() else {
        return Ok(serde_json::json!({
            "available": false,
            "source": "本地助手记忆",
            "files": [],
            "checkedAt": checked_at(),
            "warnings": vec!["无法定位用户主目录"]
        }));
    };
    let workspace_root = home.join(".openclaw").join("workspace");
    if !workspace_root.exists() || !workspace_root.is_dir() {
        return Ok(serde_json::json!({
            "available": false,
            "source": "本地助手记忆",
            "files": [],
            "checkedAt": checked_at(),
            "warnings": vec!["OpenClaw 工作区目录不存在"]
        }));
    }

    let mut files: Vec<serde_json::Value> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for file_name in &["SOUL.md", "USER.md", "AGENTS.md", "HEARTBEAT.md", "IDENTITY.md", "TOOLS.md"] {
        let path = workspace_root.join(file_name);
        if path.exists() {
            collect_memory_file(&mut files, &workspace_root, path);
        } else {
            warnings.push(format!("文件 {} 不存在", file_name));
        }
    }

    files.sort_by(|a, b| {
        let ar = a.get("relativePath").and_then(|v| v.as_str()).unwrap_or_default();
        let br = b.get("relativePath").and_then(|v| v.as_str()).unwrap_or_default();
        ar.cmp(br)
    });

    Ok(serde_json::json!({
        "available": true,
        "source": "本地助手记忆",
        "files": files,
        "checkedAt": checked_at(),
        "warnings": warnings
    }))
}

fn chrono_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", secs)
}

fn ai_files_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("ai-files"))
}

fn safe_resolve(ai_root: &std::path::Path, path: &str) -> Option<PathBuf> {
    let resolved = ai_root.join(path);
    match resolved.canonicalize() {
        Ok(canonical) => {
            let root = ai_root.canonicalize().ok()?;
            if canonical.starts_with(root) { Some(canonical) } else { None }
        }
        Err(_) => {
            // If path doesn't exist yet but is within root, allow it
            let root = ai_root.canonicalize().ok()?;
            let normalized = ai_root.join(path);
            if normalized.starts_with(root) { Some(normalized) } else { None }
        }
    }
}

#[tauri::command]
fn ensure_ai_files_dirs(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let root = ai_files_dir(&app)?;
    for sub in ["uploads", "generated", "videos", "exports", "temp"] {
        let dir = root.join(sub);
        fs::create_dir_all(&dir).map_err(|e| format!("创建 {} 失败: {}", sub, e))?;
    }
    Ok(serde_json::json!({ "ok": true, "root": root.display().to_string() }))
}

#[tauri::command]
fn list_ai_files(app: tauri::AppHandle, category: Option<String>) -> Result<serde_json::Value, String> {
    let root = ai_files_dir(&app)?;
    let mut files: Vec<serde_json::Value> = Vec::new();
    let categories = match category.as_deref() {
        Some("uploads") | Some("generated") | Some("videos") | Some("exports") | Some("temp") | None => {
            category.clone().map(|c| vec![c]).unwrap_or_else(|| vec!["uploads".into(), "generated".into(), "videos".into(), "exports".into(), "temp".into()])
        }
        _ => vec!["uploads".into(), "generated".into(), "videos".into(), "exports".into(), "temp".into()],
    };
    for cat in &categories {
        let dir = root.join(cat);
        if !dir.exists() { continue; }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() { continue; }
                let meta = path.metadata().ok();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = meta.as_ref().and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs().to_string());
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                files.push(serde_json::json!({
                    "name": name,
                    "category": cat,
                    "path": path.display().to_string(),
                    "size": size,
                    "modified": modified,
                    "extension": ext
                }));
            }
        }
    }
    files.sort_by(|a, b| b.get("modified").and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok())).unwrap_or(0)
        .cmp(&a.get("modified").and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok())).unwrap_or(0)));
    Ok(serde_json::json!({ "files": files }))
}

#[tauri::command]
fn delete_ai_file(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let root = ai_files_dir(&app)?;
    let resolved = safe_resolve(&root, &path).ok_or("路径无效或超出范围")?;
    if !resolved.is_file() {
        return Err("只能删除文件".into());
    }
    fs::remove_file(&resolved).map_err(|e| format!("删除失败: {}", e))?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn open_ai_file_location(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let root = ai_files_dir(&app)?;
    let resolved = safe_resolve(&root, &path).ok_or("路径无效或超出范围")?;
    let target = if resolved.is_file() { resolved.parent().unwrap_or(&resolved).to_path_buf() } else { resolved };
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open").arg(&target).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "windows")]
    { std::process::Command::new("explorer").arg(&target).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")]
    { std::process::Command::new("xdg-open").arg(&target).spawn().map_err(|e| e.to_string())?; }
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn pick_and_upload_file(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let files = rfd::FileDialog::new()
        .add_filter("办公文件", &["txt", "md", "csv", "json", "log", "xlsx", "xls", "docx", "pptx"])
        .pick_files();
    if files.is_none() {
        return Ok(serde_json::json!({ "files": [] }));
    }
    let root = ai_files_dir(&app)?;
    let uploads = root.join("uploads");
    fs::create_dir_all(&uploads).map_err(|e| e.to_string())?;
    let mut results: Vec<serde_json::Value> = Vec::new();
    for path in files.unwrap() {
        let meta = path.metadata().map_err(|e| e.to_string())?;
        if meta.len() > 10 * 1024 * 1024 {
            return Err(format!("文件 {} 超过 10MB 限制", path.file_name().and_then(|n| n.to_str()).unwrap_or("")));
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("upload");
        let dest = uploads.join(name);
        let dest = if dest.exists() {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let ts = chrono_timestamp();
            uploads.join(format!("{}-{}.{}", stem, ts, ext))
        } else { dest };
        fs::copy(&path, &dest).map_err(|e| format!("复制失败：{}", e))?;
        let name = dest.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let dest_modified = dest.metadata().ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());
        results.push(serde_json::json!({
            "name": name,
            "path": dest.display().to_string(),
            "size": meta.len(),
            "modified": dest_modified
        }));
    }
    Ok(serde_json::json!({ "files": results }))
}

#[tauri::command]
fn extract_ai_file_text(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let root = ai_files_dir(&app)?;
    let resolved = safe_resolve(&root, &path).ok_or("路径无效或超出范围")?;
    let ext = resolved.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let name = resolved.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let max_chars = 120_000usize;

    Ok(match ext.as_str() {
        "txt" | "md" | "log" | "json" => {
            let content = std::fs::read_to_string(&resolved).map_err(|e| e.to_string())?;
            let truncated = content.chars().count() > max_chars;
            let text: String = content.chars().take(max_chars).collect();
            serde_json::json!({ "text": text, "truncated": truncated, "fileType": ext, "fileName": name })
        }
        "csv" => {
            let mut rdr = csv::ReaderBuilder::new().has_headers(true).from_path(&resolved).map_err(|e| e.to_string())?;
            let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
            let mut lines: Vec<String> = vec![headers.iter().collect::<Vec<&str>>().join(",")];
            let mut row_count = 0u64;
            for result in rdr.records() {
                if row_count >= 2000 { break; }
                let record = result.map_err(|e| e.to_string())?;
                lines.push(record.iter().collect::<Vec<&str>>().join(","));
                row_count += 1;
            }
            let text = lines.join("\n");
            let truncated = text.chars().count() > max_chars;
            serde_json::json!({ "text": if truncated { text.chars().take(max_chars).collect() } else { text }, "truncated": truncated, "fileType": "csv", "fileName": name, "rowCount": row_count })
        }
        "xlsx" | "xls" => {
            let mut workbook = calamine::open_workbook_auto(&resolved).map_err(|e| format!("解析 Excel 失败：{}", e))?;
            let sheets = workbook.sheet_names().to_vec();
            let mut output = String::new();
            let mut total_rows = 0u64;
            let sheet_limit = 5usize.min(sheets.len());
            for i in 0..sheet_limit {
                let range = workbook.worksheet_range(&sheets[i]).map_err(|e| e.to_string())?;
                if i > 0 { output.push_str("\n\n"); }
                output.push_str(&format!("Sheet: {}\n", sheets[i]));
                let mut rows = range.rows().peekable();
                let col_count = rows.peek().map(|r| r.len().min(30)).unwrap_or(0);
                let mut row_n = 0u64;
                for row in rows {
                    if row_n >= 200 { break; }
                    let cells: Vec<String> = row.iter().take(col_count).map(|c| c.to_string()).collect();
                    output.push_str(&cells.join("\t"));
                    output.push('\n');
                    row_n += 1;
                }
                total_rows += row_n;
            }
            let truncated = output.chars().count() > max_chars;
            serde_json::json!({ "text": if truncated { output.chars().take(max_chars).collect() } else { output }, "truncated": truncated, "fileType": "xlsx", "fileName": name, "sheetCount": sheets.len(), "rowCount": total_rows })
        }
        "docx" => {
            let file = std::fs::File::open(&resolved).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("解析 docx 失败：{}", e))?;
            let doc = archive.by_name("word/document.xml").map_err(|_| "无 document.xml".to_string())?;
            let xml_text = std::io::read_to_string(doc).map_err(|e| e.to_string())?;
            let text = extract_xml_text(&xml_text);
            let truncated = text.chars().count() > max_chars;
            serde_json::json!({ "text": if truncated { text.chars().take(max_chars).collect() } else { text }, "truncated": truncated, "fileType": "docx", "fileName": name })
        }
        "pptx" => {
            let file = std::fs::File::open(&resolved).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("解析 pptx 失败：{}", e))?;
            let mut slide_nums: Vec<usize> = Vec::new();
            for i in 0..archive.len() {
                let entry = archive.by_index(i).map_err(|e| e.to_string())?;
                let name_e = entry.name().to_string();
                if name_e.starts_with("ppt/slides/slide") && name_e.ends_with(".xml") {
                    if let Some(num) = name_e.split("slide").nth(1).and_then(|s| s.split('.').next()).and_then(|s| s.parse::<usize>().ok()) {
                        slide_nums.push(num);
                    }
                }
            }
            slide_nums.sort();
            slide_nums.truncate(80);
            let mut output = String::new();
            for num in &slide_nums {
                let slide_name = format!("ppt/slides/slide{}.xml", num);
                if let Ok(slide) = archive.by_name(&slide_name) {
                    let xml_text = std::io::read_to_string(slide).map_err(|e| e.to_string())?;
                    let text = extract_xml_text(&xml_text);
                    if !text.trim().is_empty() {
                        output.push_str(&format!("\nSlide {}:\n{}\n", num, text));
                    }
                }
            }
            if output.trim().is_empty() { output = "（未提取到文本内容）".to_string(); }
            let truncated = output.chars().count() > max_chars;
            serde_json::json!({ "text": if truncated { output.chars().take(max_chars).collect() } else { output }, "truncated": truncated, "fileType": "pptx", "fileName": name, "slideCount": slide_nums.len() })
        }
        _ => return Err(format!("不支持的文件类型：{}", ext)),
    })
}

fn extract_xml_text(xml: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    let mut in_text = false;
    for ch in xml.chars() {
        match ch {
            '<' => { in_tag = true; in_text = false; }
            '>' => { in_tag = false; }
            _ if !in_tag => {
                if ch == ' ' && !in_text { continue; }
                in_text = true;
                out.push(ch);
            }
            _ => {}
        }
    }
    out.trim().split_whitespace().collect::<Vec<&str>>().join(" ")
}

#[tauri::command]
fn save_generated_file(app: tauri::AppHandle, filename: String, content: String) -> Result<serde_json::Value, String> {
    let root = ai_files_dir(&app)?;
    let gen_dir = root.join("generated");
    fs::create_dir_all(&gen_dir).map_err(|e| e.to_string())?;

    // Sanitize filename: only keep the base name, strip any path components
    let name = std::path::Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("generated.md");
    // Remove any ../ or path separators and dangerous chars
    let name: String = name.chars().filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_').collect();
    if name.is_empty() || name == "." || name == ".." {
        return Err("无效的文件名".into());
    }

    // Extension whitelist
    let ext = std::path::Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("md").to_lowercase();
    if !["md", "txt", "json", "csv"].contains(&ext.as_str()) {
        return Err(format!("不支持的文件类型：{}", ext));
    }

    let dest = gen_dir.join(&name);
    let dest = if dest.exists() {
        let stem = std::path::Path::new(&name).file_stem().and_then(|s| s.to_str()).unwrap_or("generated");
        let ts = chrono_timestamp();
        gen_dir.join(format!("{}-{}.{}", stem, ts, ext))
    } else { dest };

    // Final safety: canonicalize and verify stays within generated dir
    let canonical_gen = gen_dir.canonicalize().map_err(|e| format!("无法访问 generated 目录：{}", e))?;
    // Canonicalize the destination (may fail if not yet created, so verify via parent)
    if let Ok(canonical_dest) = dest.canonicalize() {
        if !canonical_dest.starts_with(&canonical_gen) {
            return Err("路径无效".into());
        }
    } else {
        // File doesn't exist yet — verify parent directory is within generated
        let parent = dest.parent().unwrap_or(&gen_dir);
        let canonical_parent = parent.canonicalize().map_err(|_| "路径无效")?;
        if !canonical_parent.starts_with(&canonical_gen) {
            return Err("路径无效".into());
        }
    }

    std::fs::write(&dest, &content).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true, "path": dest.display().to_string() }))
}

#[tauri::command]
fn read_openclaw_gateway_auth_for_local_use() -> Result<serde_json::Value, String> {
    // DEV-ONLY: reads ~/.openclaw/openclaw.json gateway.auth config.
    // Token returned ONLY for internal WebSocket connect use.
    // MUST be migrated to Tauri-managed WS client in P1.
    // Token must never be logged, stored in frontend state, or exposed to UI.
    let Some(home) = home_dir() else {
        return Ok(serde_json::json!({ "tokenPresent": false, "error": "no home dir" }));
    };
    let config_path = home.join(".openclaw").join("openclaw.json");
    if !config_path.exists() {
        return Ok(serde_json::json!({ "tokenPresent": false, "error": "config not found" }));
    }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let cfg: serde_json::Value = serde_json::from_str(strip_bom(&content)).map_err(|e| e.to_string())?;
    let auth = cfg.get("gateway").and_then(|g| g.get("auth"));
    let mode = auth.and_then(|a| a.get("mode")).and_then(|m| m.as_str()).unwrap_or("unknown");
    let token = auth.and_then(|a| a.get("token")).and_then(|t| t.as_str()).unwrap_or("");
    let present = !token.is_empty();
    Ok(serde_json::json!({
        "tokenPresent": present,
        "tokenLength": if present { token.len() } else { 0 },
        "authMode": mode,
        // DEV-ONLY: token returned in-memory for WS connect. Do NOT log or store.
        "token": if present { serde_json::Value::String(token.to_string()) } else { serde_json::Value::Null },
    }))
}

fn openclaw_device_identity_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("openclaw-device-identity.json"))
}

#[tauri::command]
fn get_or_create_openclaw_device_identity(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use ed25519_dalek::{SigningKey, VerifyingKey};
    use sha2::Sha256;
    use sha2::Digest;
    use rand::rngs::OsRng;
    use rand::RngCore;

    let path = openclaw_device_identity_path(&app)?;

    // Try to load existing identity
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(strip_bom(&content)) {
            let pk_bytes = parsed.get("privateKeyHex").and_then(|v| v.as_str());
            let pub_bytes = parsed.get("publicKeyHex").and_then(|v| v.as_str());
            let device_id = parsed.get("deviceId").and_then(|v| v.as_str());
            if let (Some(pk), Some(pub_k), Some(id)) = (pk_bytes, pub_bytes, device_id) {
                if let (Ok(pk_decoded), Ok(pub_decoded)) = (hex::decode(pk), hex::decode(pub_k)) {
                    if pk_decoded.len() == 32 && pub_decoded.len() == 32 {
                        return Ok(serde_json::json!({
                            "deviceId": id,
                            "publicKeyHex": pub_k,
                            "privateKeyHex": pk,
                            "created": false,
                        }));
                    }
                }
            }
        }
        // Corrupted — regenerate
        let _ = fs::remove_file(&path);
    }

    // Generate new Ed25519 keypair
    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);
    let signing_key = SigningKey::from_bytes(&seed.into());
    let verifying_key: VerifyingKey = signing_key.verifying_key();
    let pk_bytes = signing_key.to_bytes();
    let pub_bytes = verifying_key.to_bytes();

    // deviceId = sha256(publicKeyRaw)
    let mut hasher = Sha256::new();
    hasher.update(&pub_bytes);
    let device_id = hex::encode(hasher.finalize());

    let identity = serde_json::json!({
        "deviceId": device_id,
        "publicKeyHex": hex::encode(pub_bytes),
        "privateKeyHex": hex::encode(pk_bytes),
    });

    let content = serde_json::to_string_pretty(&identity).map_err(|e| e.to_string())?;
    fs::write(&path, &content).map_err(|e| e.to_string())?;

    // Set file permissions to owner-only on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(serde_json::json!({
        "deviceId": device_id,
        "publicKeyHex": hex::encode(pub_bytes),
        "privateKeyHex": hex::encode(pk_bytes),
        "created": true,
    }))
}

// Blocking probe: is the OpenClaw gateway actually live on :18789? Unlike a bare
// TCP connect (which any program occupying the port would satisfy), this hits the
// gateway-specific GET /health endpoint and checks for its {"status":"live"} /
// {"ok":true} marker — so a port conflict can't masquerade as a running gateway.
fn probe_gateway_health_blocking() -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    // Auth is optional for /health; include it when available, ignore otherwise.
    let mut req = client.get("http://127.0.0.1:18789/health");
    if let Ok(token) = load_openclaw_gateway_token() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    match req.send() {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<serde_json::Value>() {
                Ok(j) => {
                    j.get("status").and_then(|v| v.as_str()) == Some("live")
                        || j.get("ok").and_then(|v| v.as_bool()) == Some(true)
                }
                Err(_) => false,
            }
        }
        _ => false,
    }
}

fn load_openclaw_gateway_token() -> Result<String, String> {
    let Some(home) = home_dir() else {
        return Err("无法定位用户主目录".to_string());
    };
    let config_path = home.join(".openclaw").join("openclaw.json");
    if !config_path.exists() {
        return Err("OpenClaw 配置文件不存在".to_string());
    }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let cfg: serde_json::Value = serde_json::from_str(strip_bom(&content)).map_err(|e| e.to_string())?;
    let token = cfg.get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .unwrap_or("");
    if token.is_empty() {
        return Err("gateway.auth.token 未配置".to_string());
    }
    Ok(token.to_string())
}

fn emit_openclaw_error(app: &tauri::AppHandle, request_id: &str, error: &str, status: Option<u16>, body: Option<&str>) {
    let _ = app.emit("openclaw-chat-error", serde_json::json!({
        "requestId": request_id,
        "error": error,
        "url": "http://127.0.0.1:18789/v1/chat/completions",
        "model": "openclaw/default",
        "status": status,
        "body": body
    }));
}

// Reads an OpenAI-style SSE response body, emitting incremental content/reasoning chunks.
async fn openclaw_stream_body(
    app: &tauri::AppHandle,
    rid: &str,
    mdl: &str,
    response: reqwest::Response,
    is_sse: bool,
    started: std::time::Instant,
    cancel_flag: Arc<AtomicBool>,
) {
    // Non-SSE fallback: parse the full JSON once and emit it as a single chunk + done.
    if !is_sse {
        match response.json::<serde_json::Value>().await {
            Ok(json) => {
                let content = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("message")).and_then(|m| m.get("content")).and_then(|c| c.as_str()).unwrap_or("");
                let usage = json.get("usage").cloned();
                if !content.is_empty() {
                    let _ = app.emit("openclaw-chat-chunk", serde_json::json!({ "requestId": rid, "content": content, "type": "content" }));
                }
                let _ = app.emit("openclaw-chat-done", serde_json::json!({
                    "requestId": rid, "content": content, "model": mdl,
                    "rawUsage": usage, "elapsedMs": started.elapsed().as_millis() as u64
                }));
            }
            Err(e) => emit_openclaw_error(app, rid, &format!("JSON 解析失败: {}", e), None, None),
        }
        return;
    }

    let mut content_accumulated = String::new();
    let mut reasoning_accumulated = String::new();
    let mut usage_info: Option<serde_json::Value> = None;
    let mut finish_reason: Option<String> = None;
    let mut has_done = false;
    let mut line_buffer = String::new();
    let mut current_event = SseEvent { event: "message".to_string(), data: String::new() };
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = app.emit("openclaw-chat-done", serde_json::json!({
                "requestId": rid, "content": content_accumulated, "reasoningContent": reasoning_accumulated,
                "model": mdl, "rawUsage": usage_info, "elapsedMs": started.elapsed().as_millis() as u64,
                "stopped": true, "partial": !content_accumulated.is_empty(), "warning": "已停止生成"
            }));
            return;
        }
        let bytes = match item {
            Ok(b) => b,
            Err(e) => {
                if !content_accumulated.is_empty() || !reasoning_accumulated.is_empty() {
                    let _ = app.emit("openclaw-chat-done", serde_json::json!({
                        "requestId": rid, "content": content_accumulated, "reasoningContent": reasoning_accumulated,
                        "model": mdl, "rawUsage": usage_info, "elapsedMs": started.elapsed().as_millis() as u64,
                        "partial": true, "warning": "流式连接提前结束，已保留已生成内容", "streamError": e.to_string()
                    }));
                } else {
                    emit_openclaw_error(app, rid, &format!("读取流式响应失败: {}", e), None, None);
                }
                return;
            }
        };
        line_buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(nl) = line_buffer.find('\n') {
            let mut line = line_buffer[..nl].to_string();
            if line.ends_with('\r') { line.pop(); }
            line_buffer = line_buffer[nl + 1..].to_string();
            let Some(completed) = parse_sse_line(&line, &mut current_event) else { continue; };
            if completed.data == "[DONE]" { has_done = true; continue; }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&completed.data) {
                if let Some(fr) = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("finish_reason")).and_then(|v| v.as_str()) {
                    finish_reason = Some(fr.to_string());
                }
                if let Some(delta) = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")) {
                    let content = delta.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    let reasoning = delta.get("reasoning_content").and_then(|v| v.as_str()).unwrap_or("");
                    if !content.is_empty() {
                        content_accumulated.push_str(content);
                        let _ = app.emit("openclaw-chat-chunk", serde_json::json!({ "requestId": rid, "content": content, "type": "content" }));
                    }
                    if !reasoning.is_empty() {
                        reasoning_accumulated.push_str(reasoning);
                        let _ = app.emit("openclaw-chat-chunk", serde_json::json!({ "requestId": rid, "content": reasoning, "reasoningContent": reasoning, "type": "reasoning" }));
                    }
                }
                if let Some(obj) = json.get("usage") { if !obj.is_null() { usage_info = Some(obj.clone()); } }
            }
        }
    }

    let _ = app.emit("openclaw-chat-done", serde_json::json!({
        "requestId": rid, "content": content_accumulated, "reasoningContent": reasoning_accumulated,
        "model": mdl, "rawUsage": usage_info, "elapsedMs": started.elapsed().as_millis() as u64,
        "diagnostics": { "receivedDone": has_done, "finishReason": finish_reason }
    }));
}

// SSE streaming chat for the OpenClaw gateway. Mirrors hermes_chat_completion: requests
// stream:true, parses OpenAI-style `data:` delta lines, emits incremental chunk events,
// and supports user cancellation via cancel_map. The frontend feeds these chunks into the
// same typewriter pipeline so OpenClaw replies appear char-by-char like ChatGPT.
#[tauri::command]
fn openclaw_http_chat_completion_stream(
    app: tauri::AppHandle,
    request_id: String,
    messages: serde_json::Value,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let rid = request_id.clone();
    let mdl = model.unwrap_or_else(|| "openclaw/default".to_string());

    let token = match load_openclaw_gateway_token() {
        Ok(t) => t,
        Err(e) => { emit_openclaw_error(&app, &rid, &e, None, None); return Err(e); }
    };

    let cancel_flag = Arc::new(AtomicBool::new(false));
    cancel_map().lock().unwrap().insert(rid.clone(), cancel_flag.clone());
    let rid_for_handle = rid.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let url = "http://127.0.0.1:18789/v1/chat/completions";
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build() {
            Ok(c) => c,
            Err(e) => { emit_openclaw_error(&app, &rid, &format!("创建 HTTP client 失败: {}", e), None, None); return; }
        };
        // include_usage asks the OpenAI-compatible gateway to emit a final
        // usage chunk in the SSE stream; without it, streaming responses carry
        // no token counts and the usage ledger (TASK-070) never records a turn.
        let request_body = serde_json::json!({
            "model": mdl, "messages": messages, "stream": true,
            "stream_options": { "include_usage": true }
        });
        let response = match client
            .post(url)
            .header("Accept", "text/event-stream")
            .header("Accept-Encoding", "identity")
            .header("Authorization", format!("Bearer {}", token))
            .json(&request_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => { emit_openclaw_error(&app, &rid, &format!("无法连接 OpenClaw 网关: {}", e), None, None); cancel_map().lock().unwrap().remove(&rid); return; }
        };
        let status_code = response.status().as_u16();
        let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
        let is_sse = content_type.contains("text/event-stream");
        if status_code != 200 {
            let body_text = response.text().await.unwrap_or_default();
            let body_summary: String = body_text.chars().take(500).collect();
            emit_openclaw_error(&app, &rid, &format!("HTTP {}: OpenClaw 网关返回错误", status_code), Some(status_code), Some(&body_summary));
            cancel_map().lock().unwrap().remove(&rid);
            return;
        }
        openclaw_stream_body(&app, &rid, &mdl, response, is_sse, started, cancel_flag).await;
        cancel_map().lock().unwrap().remove(&rid);
        task_map().lock().unwrap().remove(&rid);
    });
    task_map().lock().unwrap().insert(rid_for_handle, handle);

    Ok(serde_json::json!({ "success": true, "accepted": true, "requestId": request_id }))
}

#[tauri::command]
fn cancel_openclaw_chat_completion(request_id: String) -> Result<serde_json::Value, String> {
    if let Some(flag) = cancel_map().lock().unwrap().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
    if let Some(handle) = task_map().lock().unwrap().remove(&request_id) {
        handle.abort();
    }
    cancel_map().lock().unwrap().remove(&request_id);
    Ok(serde_json::json!({ "cancelled": true, "requestId": request_id }))
}

#[tauri::command]
async fn openclaw_http_chat_completion(
    messages: serde_json::Value,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    // Read token from config (never returned to frontend)
    let token = load_openclaw_gateway_token()?;

    let model_candidates = if let Some(ref m) = model {
        vec![m.clone(), "openclaw/default".to_string(), "openclaw".to_string(), "openclaw/main".to_string()]
    } else {
        vec!["openclaw/default".to_string(), "openclaw".to_string(), "openclaw/main".to_string()]
    };

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;

    let mut last_error = String::new();

    for model_name in &model_candidates {
        let body = serde_json::json!({
            "model": model_name,
            "messages": messages,
            "stream": false,
        });

        let resp = match client
            .post("http://127.0.0.1:18789/v1/chat/completions")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .timeout(std::time::Duration::from_secs(180))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("HTTP 请求失败: {}", e);
                continue;
            }
        };

        let status = resp.status().as_u16();

        if status == 400 {
            last_error = format!("模型 {} 无效（HTTP 400）", model_name);
            continue;
        }

        if !resp.status().is_success() {
            last_error = format!("HTTP {}", status);
            continue;
        }

        // Parse response
        let json: serde_json::Value = match resp.json().await {
            Ok(j) => j,
            Err(e) => {
                last_error = format!("JSON 解析失败: {}", e);
                continue;
            }
        };

        let content = json
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or("");

        let finish_reason = json
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("finish_reason"))
            .and_then(|f| f.as_str());

        let usage = json.get("usage").cloned();

        return Ok(serde_json::json!({
            "ok": true,
            "content": content,
            "model": json.get("model").and_then(|m| m.as_str()).unwrap_or(model_name.as_str()),
            "finishReason": finish_reason,
            "usage": usage,
        }));
    }

    Err(last_error)
}

#[tauri::command]
fn read_openclaw_config_summary() -> Result<serde_json::Value, String> {
    let Some(home) = home_dir() else {
        return Ok(serde_json::json!({ "configExists": false, "error": "no home dir" }));
    };
    let config_path = home.join(".openclaw").join("openclaw.json");
    if !config_path.exists() {
        return Ok(serde_json::json!({
            "configExists": false,
            "configPathHint": "~/.openclaw/openclaw.json",
            "errors": ["配置文件不存在"]
        }));
    }

    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let cfg: serde_json::Value = serde_json::from_str(strip_bom(&content)).map_err(|e| e.to_string())?;

    let gateway = cfg.get("gateway");
    let auth = gateway.and_then(|g| g.get("auth"));
    let http = gateway.and_then(|g| g.get("http"));
    let endpoints = http.and_then(|h| h.get("endpoints"));
    let cc = endpoints.and_then(|e| e.get("chatCompletions"));
    let responses = endpoints.and_then(|e| e.get("responses"));

    Ok(serde_json::json!({
        "configExists": true,
        "configPathHint": "~/.openclaw/openclaw.json",
        "gatewayAuthMode": auth.and_then(|a| a.get("mode")).and_then(|m| m.as_str()),
        "gatewayTokenPresent": auth.and_then(|a| a.get("token")).and_then(|t| t.as_str()).map(|s| !s.is_empty()).unwrap_or(false),
        "gatewayPort": gateway.and_then(|g| g.get("port")).and_then(|p| p.as_u64()),
        "gatewayHost": gateway.and_then(|g| g.get("host")).and_then(|h| h.as_str()),
        "httpChatCompletionsEnabled": cc.and_then(|c| c.get("enabled")).and_then(|e| e.as_bool()).unwrap_or(false),
        "httpResponsesEnabled": responses.and_then(|r| r.get("enabled")).and_then(|e| e.as_bool()).unwrap_or(false),
        "defaultModelPrimary": cfg.get("agents").and_then(|a| a.get("defaults")).and_then(|d| d.get("model")).and_then(|m| m.get("primary")).and_then(|v| v.as_str()).map(|s| s.to_string()),
        "errors": [],
    }))
}

#[tauri::command]
async fn openclaw_http_status() -> Result<serde_json::Value, String> {
    let token = match load_openclaw_gateway_token() {
        Ok(t) => t,
        Err(e) => {
            return Ok(serde_json::json!({
                "ready": false,
                "error": e,
                "models": [],
            }));
        }
    };

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;

    // Preflight: GET /health is a fast, unambiguous liveness probe ({"ok":true,"status":"live"}).
    // It distinguishes "gateway process down" from "HTTP API enabled but model route missing"
    // far more reliably than inferring from /v1/models.
    let mut gateway_live = false;
    if let Ok(h) = client
        .get("http://127.0.0.1:18789/health")
        .header("Authorization", format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        if h.status().is_success() {
            if let Ok(hj) = h.json::<serde_json::Value>().await {
                gateway_live = hj.get("status").and_then(|v| v.as_str()) == Some("live")
                    || hj.get("ok").and_then(|v| v.as_bool()) == Some(true);
            }
        }
    }

    let resp = match client
        .get("http://127.0.0.1:18789/v1/models")
        .header("Authorization", format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(serde_json::json!({
                "ready": false,
                "error": format!("Gateway 不可达: {}", e),
                "models": [],
                "gatewayReachable": gateway_live,
            }));
        }
    };

    if !resp.status().is_success() {
        return Ok(serde_json::json!({
            "ready": false,
            "error": format!("HTTP {}", resp.status().as_u16()),
            "models": [],
        }));
    }

    let ct = resp.headers().get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if ct.contains("text/html") {
        return Ok(serde_json::json!({
            "ready": false,
            "error": "HTTP API 未启用（返回 Control UI HTML）",
            "models": [],
            "gatewayReachable": true,
            "gatewayLive": gateway_live,
            "httpApiEnabled": false,
        }));
    }

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => {
            return Ok(serde_json::json!({
                "ready": false,
                "error": format!("JSON 解析失败: {}", e),
                "models": [],
            }));
        }
    };

    let models: Vec<String> = json
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let default_model = if models.contains(&"openclaw/default".to_string()) {
        "openclaw/default"
    } else if models.contains(&"openclaw".to_string()) {
        "openclaw"
    } else {
        models.first().map(|s| s.as_str()).unwrap_or("openclaw/default")
    };

    Ok(serde_json::json!({
        "ready": !models.is_empty(),
        "models": models,
        "defaultModel": default_model,
        "statusCode": 200,
        "gatewayReachable": true,
        "gatewayLive": gateway_live,
        "httpApiEnabled": true,
        "authOk": true,
        "authRequired": true,
    }))
}

// Parses the first run of integer digits out of a string, e.g. "171k" -> 171, "85%)" -> 85.
fn first_uint(s: &str) -> Option<u64> {
    let digits: String = s.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() { None } else { digits.parse().ok() }
}

// Extracts the substring after `label` up to the next `·` separator or end of line, trimmed.
fn field_after<'a>(line: &'a str, label: &str) -> Option<&'a str> {
    let rest = line.split_once(label)?.1;
    let val = rest.split('·').next().unwrap_or(rest).trim();
    if val.is_empty() { None } else { Some(val) }
}

// Turns the emoji-tagged session_status text card into structured fields the UI can render
// as a real native status panel (context-window gauge, token usage, cache hit, version, etc.).
fn parse_session_status(text: &str) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    out.insert("statusText".into(), serde_json::Value::String(text.to_string()));
    for raw in text.lines() {
        let line = raw.trim();
        if let Some(v) = line.strip_prefix("🦞") {
            out.insert("version".into(), serde_json::Value::String(v.trim().to_string()));
        } else if line.contains("Uptime:") {
            if let Some(v) = field_after(line, "gateway") { out.insert("uptimeGateway".into(), serde_json::Value::String(v.to_string())); }
        } else if line.contains("Model:") {
            if let Some(v) = field_after(line, "Model:") { out.insert("model".into(), serde_json::Value::String(v.to_string())); }
        } else if line.contains("Tokens:") {
            if let Some(rest) = line.split_once("Tokens:").map(|x| x.1) {
                if let Some(i) = first_uint(rest) { out.insert("tokensIn".into(), serde_json::json!(i)); }
                if let Some(o) = rest.split_once('/').and_then(|x| first_uint(x.1)) { out.insert("tokensOut".into(), serde_json::json!(o)); }
            }
        } else if line.contains("Cache:") {
            if let Some(h) = first_uint(line.split_once("Cache:").map(|x| x.1).unwrap_or("")) { out.insert("cacheHitPct".into(), serde_json::json!(h)); }
        } else if line.contains("Context:") {
            let rest = line.split_once("Context:").map(|x| x.1).unwrap_or("");
            if let Some(used) = first_uint(rest) { out.insert("contextUsedK".into(), serde_json::json!(used)); }
            if let Some(total) = rest.split_once('/').and_then(|x| first_uint(x.1)) { out.insert("contextTotalK".into(), serde_json::json!(total)); }
            if let Some(pct) = rest.split_once('(').and_then(|x| first_uint(x.1)) { out.insert("contextPct".into(), serde_json::json!(pct)); }
            if let Some(c) = line.split_once("Compactions:").and_then(|x| first_uint(x.1)) { out.insert("compactions".into(), serde_json::json!(c)); }
        } else if line.contains("Think:") {
            if let Some(v) = field_after(line, "Think:") { out.insert("thinkLevel".into(), serde_json::Value::String(v.to_string())); }
        }
    }
    serde_json::Value::Object(out)
}

// Calls the gateway's always-on /tools/invoke endpoint with the native `session_status` tool
// and returns parsed structured fields plus the raw card text.
#[tauri::command]
async fn openclaw_session_status() -> Result<serde_json::Value, String> {
    let token = match load_openclaw_gateway_token() {
        Ok(t) => t,
        Err(e) => return Ok(serde_json::json!({ "ok": false, "error": e })),
    };
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;

    let resp = match client
        .post("http://127.0.0.1:18789/tools/invoke")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "tool": "session_status", "action": "json", "args": {} }))
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Ok(serde_json::json!({ "ok": false, "error": format!("Gateway 不可达: {}", e) })),
    };

    if !resp.status().is_success() {
        return Ok(serde_json::json!({ "ok": false, "error": format!("HTTP {}", resp.status().as_u16()) }));
    }
    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => return Ok(serde_json::json!({ "ok": false, "error": format!("JSON 解析失败: {}", e) })),
    };

    // statusText lives either in result.details.statusText or result.content[0].text.
    let result = json.get("result");
    let text = result
        .and_then(|r| r.get("details"))
        .and_then(|d| d.get("statusText"))
        .and_then(|v| v.as_str())
        .or_else(|| result.and_then(|r| r.get("content")).and_then(|c| c.get(0)).and_then(|c| c.get("text")).and_then(|v| v.as_str()))
        .unwrap_or("");

    if text.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "error": "session_status 无返回文本" }));
    }

    let mut parsed = parse_session_status(text);
    if let Some(obj) = parsed.as_object_mut() {
        obj.insert("ok".into(), serde_json::Value::Bool(true));
        if let Some(key) = result.and_then(|r| r.get("details")).and_then(|d| d.get("sessionKey")).and_then(|v| v.as_str()) {
            obj.insert("sessionKey".into(), serde_json::Value::String(key.to_string()));
        }
    }
    Ok(parsed)
}

// Calls the gateway's always-on /tools/invoke endpoint with one tool and returns the parsed
// JSON body. Shared by web_search / sessions_list / (future) tool commands.
async fn invoke_gateway_tool(tool: &str, args: serde_json::Value, timeout_secs: u64) -> Result<serde_json::Value, String> {
    let token = load_openclaw_gateway_token()?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;
    let resp = client
        .post("http://127.0.0.1:18789/tools/invoke")
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "tool": tool, "action": "json", "args": args }))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .send()
        .await
        .map_err(|e| format!("Gateway 不可达: {}", e))?;
    let status = resp.status().as_u16();
    if status == 404 {
        return Err(format!("工具不可用（被策略拒绝或未启用）: {}", tool));
    }
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", status));
    }
    resp.json::<serde_json::Value>().await.map_err(|e| format!("JSON 解析失败: {}", e))
}

// Strips OpenClaw's external-untrusted-content wrappers so search titles/snippets render cleanly.
// Format: "<<<EXTERNAL_UNTRUSTED_CONTENT id=\"..\">>>\nSource: ..\n---\n<text>\n<<<END_..>>>"
fn strip_untrusted_wrapper(s: &str) -> String {
    let text = s
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.starts_with("<<<EXTERNAL_UNTRUSTED_CONTENT")
                && !t.starts_with("<<<END_EXTERNAL_UNTRUSTED_CONTENT")
                && !t.starts_with("Source:")
                && t != "---"
        })
        .collect::<Vec<_>>()
        .join(" ");
    text.trim().to_string()
}

// Web search via the native `web_search` tool (DuckDuckGo, key-free on this gateway).
#[tauri::command]
async fn openclaw_web_search(query: String) -> Result<serde_json::Value, String> {
    if query.trim().is_empty() {
        return Err("搜索词为空".to_string());
    }
    let json = invoke_gateway_tool("web_search", serde_json::json!({ "query": query }), 20).await?;
    let details = json.get("result").and_then(|r| r.get("details"));
    let provider = details.and_then(|d| d.get("provider")).and_then(|v| v.as_str()).unwrap_or("unknown");
    let took_ms = details.and_then(|d| d.get("tookMs")).and_then(|v| v.as_u64()).unwrap_or(0);
    let results: Vec<serde_json::Value> = details
        .and_then(|d| d.get("results"))
        .and_then(|r| r.as_array())
        .map(|arr| {
            arr.iter()
                .map(|item| {
                    let title = strip_untrusted_wrapper(item.get("title").and_then(|v| v.as_str()).unwrap_or(""));
                    let snippet = strip_untrusted_wrapper(item.get("snippet").and_then(|v| v.as_str()).unwrap_or(""));
                    serde_json::json!({
                        "title": title,
                        "snippet": snippet,
                        "url": item.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "siteName": item.get("siteName").and_then(|v| v.as_str()).unwrap_or(""),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(serde_json::json!({
        "ok": true,
        "query": query,
        "provider": provider,
        "tookMs": took_ms,
        "count": results.len(),
        "results": results,
    }))
}

// Lists the gateway's agent sessions with usage/status fields for the activity panel.
#[tauri::command]
async fn openclaw_sessions_list() -> Result<serde_json::Value, String> {
    let json = invoke_gateway_tool("sessions_list", serde_json::json!({}), 12).await?;
    let details = json.get("result").and_then(|r| r.get("details"));
    let sessions: Vec<serde_json::Value> = details
        .and_then(|d| d.get("sessions"))
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .map(|s| {
                    serde_json::json!({
                        "key": s.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                        "agentId": s.get("agentId").and_then(|v| v.as_str()).unwrap_or(""),
                        "channel": s.get("channel").and_then(|v| v.as_str()).unwrap_or(""),
                        "model": s.get("model").and_then(|v| v.as_str()).unwrap_or(""),
                        "status": s.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                        "contextTokens": s.get("contextTokens").and_then(|v| v.as_u64()).unwrap_or(0),
                        "totalTokens": s.get("totalTokens").and_then(|v| v.as_u64()).unwrap_or(0),
                        "runtimeMs": s.get("runtimeMs").and_then(|v| v.as_u64()).unwrap_or(0),
                        "thinkingLevel": s.get("thinkingLevel").and_then(|v| v.as_str()).unwrap_or(""),
                        "updatedAt": s.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let total_tokens: u64 = sessions.iter().map(|s| s.get("totalTokens").and_then(|v| v.as_u64()).unwrap_or(0)).sum();
    Ok(serde_json::json!({
        "ok": true,
        "count": sessions.len(),
        "totalTokensAcrossSessions": total_tokens,
        "sessions": sessions,
    }))
}

// ── ClawHub public catalog (https://clawhub.ai) ──
// Read-only public API. We cache responses in-memory with a short TTL and honor
// 429/Retry-After so we behave as a polite third-party directory consumer.
const CLAWHUB_BASE: &str = "https://clawhub.ai";

// key -> (expires_at_unix_ms, json_body)
static CLAWHUB_CACHE: OnceLock<Mutex<HashMap<String, (u128, serde_json::Value)>>> = OnceLock::new();

fn clawhub_cache() -> &'static Mutex<HashMap<String, (u128, serde_json::Value)>> {
    CLAWHUB_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn clawhub_cache_get(key: &str) -> Option<serde_json::Value> {
    let map = clawhub_cache().lock().ok()?;
    let (exp, val) = map.get(key)?;
    if *exp > now_ms() { Some(val.clone()) } else { None }
}

fn clawhub_cache_put(key: String, val: serde_json::Value, ttl_ms: u128) {
    if let Ok(mut map) = clawhub_cache().lock() {
        if map.len() > 200 { map.clear(); } // crude bound
        map.insert(key, (now_ms() + ttl_ms, val));
    }
}

// GET a ClawHub API path and parse JSON, with TTL cache + 429 handling.
async fn clawhub_get(path: &str, ttl_ms: u128) -> Result<serde_json::Value, String> {
    if let Some(cached) = clawhub_cache_get(path) {
        return Ok(cached);
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .user_agent("ai-agent-workspace/0.1 (+clawhub-directory-client)")
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;
    let url = format!("{}{}", CLAWHUB_BASE, path);
    let resp = client.get(&url).timeout(Duration::from_secs(20)).send().await
        .map_err(|e| format!("ClawHub 不可达: {}", e))?;
    let status = resp.status();
    if status.as_u16() == 429 {
        let retry = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).unwrap_or("?").to_string();
        return Err(format!("RATE_LIMIT:{}", retry));
    }
    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }
    let body = resp.json::<serde_json::Value>().await.map_err(|e| format!("JSON 解析失败: {}", e))?;
    clawhub_cache_put(path.to_string(), body.clone(), ttl_ms);
    Ok(body)
}

// Minimal percent-encoding for query values (avoids adding a urlencoding dep).
fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// Map clawhub_get errors into a friendly Chinese message for the UI.
fn map_clawhub_err(e: String) -> String {
    if let Some(retry) = e.strip_prefix("RATE_LIMIT:") {
        format!("请求过于频繁，请 {} 秒后重试", retry)
    } else {
        format!("无法连接 ClawHub 技能市场：{}", e)
    }
}

// Normalize a ClawHub skill object (from /skills items or /search results) into a
// stable shape for the UI. Untrusted text fields are passed through as plain strings
// (the WebView renders them as text, never as HTML).
fn clawhub_norm_skill(s: &serde_json::Value) -> serde_json::Value {
    let str_at = |k: &str| s.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let owner = s.get("owner");
    let owner_handle = owner.and_then(|o| o.get("handle")).and_then(|v| v.as_str())
        .or_else(|| s.get("ownerHandle").and_then(|v| v.as_str())).unwrap_or("").to_string();
    let latest = s.get("latestVersion").and_then(|v| v.get("version")).and_then(|v| v.as_str())
        .or_else(|| s.get("version").and_then(|v| v.as_str()))
        .or_else(|| s.get("tags").and_then(|t| t.get("latest")).and_then(|v| v.as_str()))
        .unwrap_or("").to_string();
    let stats = s.get("stats");
    let downloads = stats.and_then(|st| st.get("downloads")).and_then(|v| v.as_u64()).unwrap_or(0);
    let stars = stats.and_then(|st| st.get("stars")).and_then(|v| v.as_u64()).unwrap_or(0);
    let installs = stats.and_then(|st| st.get("installsCurrent")).and_then(|v| v.as_u64()).unwrap_or(0);
    let slug = str_at("slug");
    // /skills list items have no owner; the slug-only URL 307-redirects to the
    // canonical /{owner}/{slug} page, so use it as the safe fallback.
    let url = if owner_handle.is_empty() {
        format!("{}/skills/{}", CLAWHUB_BASE, slug)
    } else {
        format!("{}/{}/{}", CLAWHUB_BASE, owner_handle, slug)
    };
    serde_json::json!({
        "slug": slug,
        "displayName": str_at("displayName"),
        "summary": str_at("summary"),
        "version": latest,
        "ownerHandle": owner_handle,
        "downloads": downloads,
        "stars": stars,
        "installs": installs,
        "updatedAt": s.get("updatedAt").and_then(|v| v.as_u64()).unwrap_or(0),
        "url": url,
    })
}

// Browse the public ClawHub skill catalog with sort + pagination.
#[tauri::command]
async fn clawhub_browse(sort: Option<String>, limit: Option<u32>, cursor: Option<String>) -> Result<serde_json::Value, String> {
    let sort = sort.unwrap_or_else(|| "downloads".into());
    let limit = limit.unwrap_or(24).clamp(1, 60);
    let mut path = format!("/api/v1/skills?limit={}&sort={}&nonSuspiciousOnly=true", limit, sort);
    if let Some(c) = cursor.filter(|c| !c.is_empty()) {
        path.push_str(&format!("&cursor={}", pct_encode(&c)));
    }
    let body = clawhub_get(&path, 60_000).await.map_err(map_clawhub_err)?;
    let items: Vec<serde_json::Value> = body.get("items").and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(clawhub_norm_skill).collect()).unwrap_or_default();
    Ok(serde_json::json!({
        "ok": true,
        "items": items,
        "nextCursor": body.get("nextCursor").cloned().unwrap_or(serde_json::Value::Null),
    }))
}

// Relevance search across the public ClawHub catalog.
#[tauri::command]
async fn clawhub_search(query: String, limit: Option<u32>) -> Result<serde_json::Value, String> {
    let q = query.trim();
    if q.is_empty() { return Ok(serde_json::json!({ "ok": true, "items": [] })); }
    let limit = limit.unwrap_or(24).clamp(1, 60);
    let path = format!("/api/v1/search?q={}&limit={}&nonSuspiciousOnly=true", pct_encode(q), limit);
    let body = clawhub_get(&path, 60_000).await.map_err(map_clawhub_err)?;
    let items: Vec<serde_json::Value> = body.get("results").and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(clawhub_norm_skill).collect()).unwrap_or_default();
    Ok(serde_json::json!({ "ok": true, "items": items }))
}

// Full detail for one skill slug, including moderation/security snapshot.
#[tauri::command]
async fn clawhub_skill_detail(slug: String) -> Result<serde_json::Value, String> {
    let slug = slug.trim();
    if slug.is_empty() { return Err("缺少 slug".into()); }
    let path = format!("/api/v1/skills/{}", pct_encode(slug));
    let body = clawhub_get(&path, 120_000).await.map_err(map_clawhub_err)?;
    let skill = body.get("skill").cloned().unwrap_or(serde_json::Value::Null);
    let mut norm = clawhub_norm_skill(&skill);
    // Enrich with version/owner/moderation from the detail envelope.
    if let Some(lv) = body.get("latestVersion") {
        if let Some(v) = lv.get("version").and_then(|v| v.as_str()) { norm["version"] = v.into(); }
        if let Some(ch) = lv.get("changelog").and_then(|v| v.as_str()) { norm["changelog"] = ch.into(); }
    }
    if let Some(owner) = body.get("owner") {
        let h = owner.get("handle").and_then(|v| v.as_str()).unwrap_or("");
        norm["ownerHandle"] = h.into();
        norm["ownerDisplayName"] = owner.get("displayName").and_then(|v| v.as_str()).unwrap_or(h).into();
        norm["url"] = format!("{}/{}/{}", CLAWHUB_BASE, h, slug).into();
    }
    let md = body.get("moderation");
    norm["moderation"] = serde_json::json!({
        "verdict": md.and_then(|m| m.get("verdict")).and_then(|v| v.as_str()).unwrap_or("clean"),
        "isSuspicious": md.and_then(|m| m.get("isSuspicious")).and_then(|v| v.as_bool()).unwrap_or(false),
        "isMalwareBlocked": md.and_then(|m| m.get("isMalwareBlocked")).and_then(|v| v.as_bool()).unwrap_or(false),
    });
    if let Some(meta) = body.get("metadata") { norm["metadata"] = meta.clone(); }
    Ok(serde_json::json!({ "ok": true, "skill": norm }))
}

// List skills installed/available on the local machine via the OpenClaw CLI.
// Fixes the prior bug where the output was parsed as a bare array; the real shape
// is { workspaceDir, managedSkillsDir, skills: [...] }.
#[tauri::command]
async fn openclaw_skills_list() -> Result<serde_json::Value, String> {
    // Runs the `openclaw` CLI (cold start ~0.9s). Must run off the main thread,
    // otherwise the WebView freezes while the subprocess runs.
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .args(["skills", "list", "--json"]).output()
            .map_err(|e| format!("无法运行 openclaw skills list：{}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("openclaw skills list 失败：{}", stderr.trim()));
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("解析 skills list 输出失败：{}", e))?;
        let managed_dir = parsed.get("managedSkillsDir").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let skills: Vec<serde_json::Value> = parsed.get("skills").and_then(|v| v.as_array())
            .map(|arr| arr.iter().map(|s| {
                let str_at = |k: &str| s.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                let bundled = s.get("bundled").and_then(|v| v.as_bool()).unwrap_or(false);
                serde_json::json!({
                    "name": str_at("name"),
                    "description": str_at("description"),
                    "emoji": str_at("emoji"),
                    "source": str_at("source"),
                    "homepage": str_at("homepage"),
                    "bundled": bundled,
                    "eligible": s.get("eligible").and_then(|v| v.as_bool()).unwrap_or(false),
                    "disabled": s.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false),
                    "modelVisible": s.get("modelVisible").and_then(|v| v.as_bool()).unwrap_or(false),
                })
            }).collect()).unwrap_or_default();
        let ready = skills.iter().filter(|s| s.get("eligible").and_then(|v| v.as_bool()).unwrap_or(false) && !s.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false)).count();
        Ok(serde_json::json!({
            "ok": true,
            "managedSkillsDir": managed_dir,
            "total": skills.len(),
            "ready": ready,
            "skills": skills,
        }))
    }).await.map_err(|e| e.to_string())?
}

// Allowed messaging-channel ids, mirrors OpenClaw's `--channel` enum. We gate on
// this so a malformed/injected channel name can never reach the CLI.
fn is_valid_channel_id(id: &str) -> bool {
    matches!(id,
        "telegram" | "whatsapp" | "discord" | "irc" | "googlechat" | "slack" | "signal"
        | "imessage" | "feishu" | "nostr" | "msteams" | "mattermost" | "nextcloud-talk"
        | "matrix" | "line" | "zalo" | "clickclack" | "zalouser" | "synology-chat"
        | "tlon" | "qqbot" | "twitch")
}

// List all chat channels (configured + installable catalog) via the OpenClaw CLI.
// Returns the raw `{ chat: { <id>: { accounts, installed, origin } } }` shape so the
// frontend can render status without us re-deriving it.
#[tauri::command]
async fn list_openclaw_channels() -> Result<serde_json::Value, String> {
    // CLI cold start ~0.9s; run off the main thread so the WebView never freezes.
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .args(["channels", "list", "--all", "--json"]).output()
            .map_err(|e| format!("无法运行 openclaw channels list：{}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("读取通道列表失败：{}", stderr.trim()));
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("解析通道列表输出失败：{}", e))?;
        Ok(serde_json::json!({ "ok": true, "chat": parsed.get("chat").cloned().unwrap_or(serde_json::json!({})) }))
    }).await.map_err(|e| e.to_string())?
}

// Add/update a messaging channel account. The bot token is passed inline via --token
// so OpenClaw stores the value in its own 0600 config (botToken). See the in-body note
// for why --token-file with a self-deleted temp file is unsafe here.
#[tauri::command]
async fn add_openclaw_channel(channel: String, token: String) -> Result<serde_json::Value, String> {
    let channel = channel.trim().to_string();
    if !is_valid_channel_id(&channel) {
        return Err("不支持的通道类型".into());
    }
    let token = token.trim().to_string();
    if token.is_empty() || token.len() > 4096 {
        return Err("无效的凭据".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Pass the token inline via --token so OpenClaw stores the value (botToken) in
        // its own 0600 config. NOTE: do NOT use --token-file with a temp file we delete:
        // OpenClaw persists the file *path* by reference and reads it lazily at gateway
        // startup, so a deleted temp file makes the gateway crash on (re)start
        // (1006 abnormal closure). The token is only briefly on argv for the local user
        // who already owns the OpenClaw config.
        let out = openclaw_command()
            .args(["channels", "add", "--channel", &channel, "--token", &token])
            .output()
            .map_err(|e| format!("无法运行 openclaw channels add：{}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("添加通道失败：{}", stderr.trim()));
        }
        Ok(serde_json::json!({ "ok": true, "channel": channel }))
    }).await.map_err(|e| e.to_string())?
}

// Remove (delete) a channel account non-interactively (`--delete` skips the prompt).
#[tauri::command]
async fn remove_openclaw_channel(channel: String) -> Result<serde_json::Value, String> {
    let channel = channel.trim().to_string();
    if !is_valid_channel_id(&channel) {
        return Err("不支持的通道类型".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .args(["channels", "remove", "--channel", &channel, "--delete"]).output()
            .map_err(|e| format!("无法运行 openclaw channels remove：{}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("移除通道失败：{}", stderr.trim()));
        }
        Ok(serde_json::json!({ "ok": true, "channel": channel }))
    }).await.map_err(|e| e.to_string())?
}

// Restart the OpenClaw gateway service so newly added channels take effect, with
// `--json` for a parseable result. The service is managed by launchd/systemd, so this
// needs no terminal from the user. NOTE: we intentionally do NOT pass `--safe`: that
// path connects back as a WS client requesting elevated scopes, which needs device
// pairing approval and fails with "pairing required" (1008) on a fresh setup.
#[tauri::command]
async fn restart_openclaw_gateway() -> Result<serde_json::Value, String> {
    // Restart can take ~15s (service reload + health settle); never block the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .args(["gateway", "restart", "--json"]).output()
            .map_err(|e| format!("无法重启本地服务，请确认 OpenClaw 已安装。({})", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("重启网关失败：{}", stderr.trim()));
        }
        // The CLI prints a non-JSON status line before the JSON body; grab the JSON object.
        let text = String::from_utf8_lossy(&out.stdout);
        let parsed = text.find('{')
            .and_then(|i| serde_json::from_str::<serde_json::Value>(&text[i..]).ok())
            .unwrap_or(serde_json::json!({ "ok": true, "result": "restarted" }));
        Ok(serde_json::json!({ "ok": true, "restart": parsed }))
    }).await.map_err(|e| e.to_string())?
}

// List pending pairing requests for a channel (e.g. the code shown after a user first
// DMs the bot). Returns the raw `{ channel, requests: [...] }` shape; falls back to an
// empty list so the UI can render even when the gateway has nothing pending.
#[tauri::command]
async fn list_pairing_requests(channel: String) -> Result<serde_json::Value, String> {
    let channel = channel.trim().to_string();
    if !is_valid_channel_id(&channel) {
        return Err("不支持的通道类型".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .args(["pairing", "list", &channel, "--json"]).output()
            .map_err(|e| format!("无法读取配对请求：{}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("读取配对请求失败：{}", stderr.trim()));
        }
        let text = String::from_utf8_lossy(&out.stdout);
        let parsed: serde_json::Value = serde_json::from_str(text.trim())
            .unwrap_or(serde_json::json!({ "channel": channel, "requests": [] }));
        Ok(serde_json::json!({ "ok": true, "requests": parsed.get("requests").cloned().unwrap_or(serde_json::json!([])) }))
    }).await.map_err(|e| e.to_string())?
}

// Approve a pairing code, allowing that sender to talk to the bot.
#[tauri::command]
async fn approve_pairing_request(channel: String, code: String) -> Result<serde_json::Value, String> {
    let channel = channel.trim().to_string();
    if !is_valid_channel_id(&channel) {
        return Err("不支持的通道类型".into());
    }
    let code = code.trim().to_string();
    // Pairing codes are short alphanumeric tokens; reject anything that could be an arg/flag.
    if code.is_empty() || code.len() > 64 || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("无效的配对码".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .args(["pairing", "approve", &channel, &code]).output()
            .map_err(|e| format!("无法批准配对：{}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("批准配对失败：{}", stderr.trim()));
        }
        Ok(serde_json::json!({ "ok": true, "code": code }))
    }).await.map_err(|e| e.to_string())?
}

// Report the installed OpenClaw version string, e.g. "2026.5.27". Used by the UI to
// gate channels that require a newer OpenClaw (Feishu needs >= 2026.5.29).
#[tauri::command]
async fn get_openclaw_version() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .arg("--version").output()
            .map_err(|e| format!("无法读取 OpenClaw 版本：{}", e))?;
        let text = String::from_utf8_lossy(&out.stdout);
        // Output looks like: "OpenClaw 2026.5.27 (27ae826) — ...". Pull the first x.y.z token.
        let version = text.split_whitespace()
            .find(|tok| tok.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && tok.contains('.'))
            .unwrap_or("")
            .to_string();
        Ok(serde_json::json!({ "ok": true, "version": version }))
    }).await.map_err(|e| e.to_string())?
}

// --- WeChat (openclaw-weixin) QR login -------------------------------------------
// WeChat uses an interactive `channels login` that prints an ASCII QR plus a fallback
// URL (https://liteapp.weixin.qq.com/...). We spawn it, extract that URL so the UI can
// render a clean QR, keep the process alive until the user scans, and emit a
// "wechat-login-status" event when it finishes. The child is tracked so it can be
// cancelled if the user closes the panel.
static WECHAT_LOGIN_CHILD: OnceLock<Mutex<Option<std::process::Child>>> = OnceLock::new();
fn wechat_login_child() -> &'static Mutex<Option<std::process::Child>> {
    WECHAT_LOGIN_CHILD.get_or_init(|| Mutex::new(None))
}

// Kill any in-flight WeChat login process. Safe to call repeatedly.
fn kill_wechat_login() {
    if let Ok(mut guard) = wechat_login_child().lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// Strip ANSI escape sequences so URL extraction works on colored CLI output.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b {
            // Skip CSI sequence: ESC [ ... letter
            i += 1;
            if i < bytes.len() && bytes[i] == b'[' {
                i += 1;
                while i < bytes.len() && !bytes[i].is_ascii_alphabetic() { i += 1; }
                if i < bytes.len() { i += 1; }
            }
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

// Start the WeChat QR login. Spawns the interactive CLI, reads stdout until the QR
// fallback URL appears, returns it, then keeps reading in a thread and emits
// "wechat-login-status" {state:"done"|"failed"} when the process exits.
#[tauri::command]
async fn start_wechat_login(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    kill_wechat_login(); // ensure no stale login is running
    let mut child = openclaw_command()
        .args(["channels", "login", "--channel", "openclaw-weixin"])
        .stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动微信登录：{}", e))?;
    let stdout = child.stdout.take().ok_or("无法读取登录输出")?;
    if let Ok(mut guard) = wechat_login_child().lock() { *guard = Some(child); }

    // Read line-by-line; capture the first liteapp URL, then keep draining until EOF.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut sent_url = false;
        for line in reader.lines() {
            let line = match line { Ok(l) => strip_ansi(&l), Err(_) => continue };
            if !sent_url {
                if let Some(idx) = line.find("https://liteapp.weixin.qq.com/") {
                    let url: String = line[idx..].split_whitespace().next().unwrap_or("").to_string();
                    if !url.is_empty() { let _ = tx.send(url); sent_url = true; }
                }
            }
        }
        // Stream ended: the process exited. Report best-effort completion.
        let _ = app.emit("wechat-login-status", serde_json::json!({ "state": "done" }));
    });

    // Wait up to ~12s for the URL to show up.
    match rx.recv_timeout(Duration::from_secs(12)) {
        Ok(url) => Ok(serde_json::json!({ "ok": true, "qrUrl": url })),
        Err(_) => { kill_wechat_login(); Err("登录二维码获取超时，请重试".into()) }
    }
}

// Cancel an in-flight WeChat login (user closed the panel).
#[tauri::command]
async fn cancel_wechat_login() -> Result<serde_json::Value, String> {
    kill_wechat_login();
    Ok(serde_json::json!({ "ok": true }))
}

// Install a ClawHub skill by its real slug via the OpenClaw CLI.
#[tauri::command]
#[allow(non_snake_case)]
async fn clawhub_install_skill(app: tauri::AppHandle, slug: String, displayName: String) -> Result<serde_json::Value, String> {
    let slug = slug.trim().to_string();
    if slug.is_empty() || slug.len() > 200 || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.') {
        return Err("无效的技能 slug".into());
    }
    // CLI install can take seconds (network download); run off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let out = openclaw_command()
            .args(["skills", "install", &slug, "--global"]).output()
            .map_err(|e| format!("无法运行安装命令：{}", e))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("安装失败：{}", stderr.trim()));
        }
        let mut records = load_skill_records(&app);
        records.retain(|r| r.get("slug").and_then(|v| v.as_str()) != Some(&slug));
        records.push(serde_json::json!({
            "slug": slug, "name": displayName, "kind": "skill", "source": "clawhub",
            "installedAt": now_ms(), "installedByApp": true,
        }));
        save_skill_records(&app, &records);
        Ok(serde_json::json!({ "ok": true, "action": "installed", "slug": slug }))
    }).await.map_err(|e| e.to_string())?
}

// Uninstall a ClawHub-managed skill. The CLI has no uninstall verb, so we remove the
// managed skill directory (~/.openclaw/skills/<slug>) — but only when it carries the
// `.clawhub` provenance marker, so we never touch bundled or hand-authored skills.
#[tauri::command]
async fn clawhub_uninstall_skill(app: tauri::AppHandle, slug: String) -> Result<serde_json::Value, String> {
    let slug = slug.trim().to_string();
    // Reject anything that could escape the managed dir.
    if slug.is_empty() || slug.contains("..") || slug.contains('/') || slug.contains('\\') {
        return Err("无效的技能 slug".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir().ok_or("无法定位用户主目录")?;
        let skill_dir = home.join(".openclaw").join("skills").join(&slug);
        if !skill_dir.exists() {
            return Err("未找到该技能的本地安装目录".into());
        }
        // Safety: only delete directories that were installed from ClawHub.
        if !skill_dir.join(".clawhub").exists() {
            return Err("该技能不是通过 ClawHub 安装的，已跳过删除以保护本地数据".into());
        }
        // Canonicalize and confirm the resolved path is still under the managed dir.
        let managed = home.join(".openclaw").join("skills");
        let canon = skill_dir.canonicalize().map_err(|e| format!("路径解析失败：{}", e))?;
        let managed_canon = managed.canonicalize().map_err(|e| format!("路径解析失败：{}", e))?;
        if !canon.starts_with(&managed_canon) {
            return Err("路径越界，已拒绝删除".into());
        }
        fs::remove_dir_all(&canon).map_err(|e| format!("删除失败：{}", e))?;
        let mut records = load_skill_records(&app);
        records.retain(|r| r.get("slug").and_then(|v| v.as_str()) != Some(&slug));
        save_skill_records(&app, &records);
        Ok(serde_json::json!({ "ok": true, "action": "uninstalled", "slug": slug }))
    }).await.map_err(|e| e.to_string())?
}

const MODEL_PROXY_BASE_URL: &str = "https://ai.f1class.icu/v1";
const MODEL_PROXY_PROVIDER_ID: &str = "ai-agent-proxy";

// Read the model-proxy (f1class) baseUrl + apiKey from openclaw.json. The key is
// used only to call the proxy and is never returned to the frontend.
fn read_model_proxy_creds() -> Result<(String, String), String> {
    let home = home_dir().ok_or("无法定位用户主目录")?;
    let config_path = home.join(".openclaw").join("openclaw.json");
    if !config_path.exists() { return Err("未找到模型配置，请先在「AI 助手」中配置模型".into()); }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let cfg: serde_json::Value = serde_json::from_str(strip_bom(&content)).map_err(|e| e.to_string())?;
    let proxy = cfg.get("models").and_then(|m| m.get("providers")).and_then(|p| p.get(MODEL_PROXY_PROVIDER_ID));
    let key = proxy.and_then(|p| p.get("apiKey")).and_then(|k| k.as_str()).filter(|s| !s.is_empty())
        .ok_or("未配置模型密钥，请先在「AI 助手」中完成模型配置")?;
    let base = proxy.and_then(|p| p.get("baseUrl")).and_then(|b| b.as_str()).unwrap_or(MODEL_PROXY_BASE_URL);
    Ok((base.trim_end_matches('/').to_string(), key.to_string()))
}

// text -> translated text cache (translations are deterministic enough to cache long).
static TRANSLATE_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
fn translate_cache() -> &'static Mutex<HashMap<String, String>> {
    TRANSLATE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

// Translate English skill text into Simplified Chinese via the f1class proxy.
#[tauri::command]
async fn translate_text(text: String) -> Result<serde_json::Value, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() { return Ok(serde_json::json!({ "ok": true, "text": "" })); }
    if let Ok(cache) = translate_cache().lock() {
        if let Some(hit) = cache.get(trimmed) { return Ok(serde_json::json!({ "ok": true, "text": hit, "cached": true })); }
    }
    let (base, key) = read_model_proxy_creds()?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8)).build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))?;
    let body = serde_json::json!({
        "model": "deepseek-v4-flash",
        "stream": false,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": "You are a professional translator. Translate the user's text into natural, concise Simplified Chinese suitable for a software skill marketplace. Keep technical terms, product names, and code identifiers in their original form. Output only the translation with no quotes, labels, or explanation." },
            { "role": "user", "content": trimmed }
        ]
    });
    let resp = client.post(format!("{}/chat/completions", base))
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .json(&body).timeout(Duration::from_secs(40)).send().await
        .map_err(|e| format!("翻译请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("翻译服务返回错误 (HTTP {})", resp.status().as_u16()));
    }
    let data = resp.json::<serde_json::Value>().await.map_err(|e| format!("解析翻译结果失败: {}", e))?;
    let out = data.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("message"))
        .and_then(|m| m.get("content")).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if out.is_empty() { return Err("翻译结果为空".into()); }
    if let Ok(mut cache) = translate_cache().lock() {
        if cache.len() > 500 { cache.clear(); }
        cache.insert(trimmed.to_string(), out.clone());
    }
    Ok(serde_json::json!({ "ok": true, "text": out }))
}

#[tauri::command]
fn read_openclaw_model_provider_summary() -> Result<serde_json::Value, String> {
    let Some(home) = home_dir() else {
        return Ok(serde_json::json!({ "providerConfigured": false, "errors": ["no home dir"] }));
    };
    let config_path = home.join(".openclaw").join("openclaw.json");
    if !config_path.exists() {
        return Ok(serde_json::json!({ "providerConfigured": false, "errors": ["config not found"] }));
    }
    let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let cfg: serde_json::Value = serde_json::from_str(strip_bom(&content)).map_err(|e| e.to_string())?;
    let providers = cfg.get("models").and_then(|m| m.get("providers"));
    let proxy = providers.and_then(|p| p.get(MODEL_PROXY_PROVIDER_ID));
    let has_key = proxy.and_then(|p| p.get("apiKey")).and_then(|k| k.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let default_primary = cfg.get("agents").and_then(|a| a.get("defaults")).and_then(|d| d.get("model")).and_then(|m| m.get("primary")).and_then(|v| v.as_str());
    let models = proxy.and_then(|p| p.get("models")).and_then(|m| m.as_array()).map(|arr| arr.iter().filter_map(|v| {
        // Support both { "id": "..." } objects and plain string entries
        if let Some(id) = v.as_str() { Some(id.to_string()) }
        else if let Some(obj) = v.as_object() { obj.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()) }
        else { None }
    }).collect::<Vec<_>>()).unwrap_or_default();
    Ok(serde_json::json!({
        "providerConfigured": proxy.is_some() && has_key && !models.is_empty(),
        "providerId": if proxy.is_some() { Some(MODEL_PROXY_PROVIDER_ID) } else { None::<&str> },
        "tokenPresent": has_key,
        "defaultModelRef": default_primary,
        "availableConfiguredModels": models,
        "errors": [],
    }))
}

#[tauri::command]
fn apply_openclaw_model_provider_config(token: String, model_preset: String) -> Result<serde_json::Value, String> {
    if token.trim().is_empty() { return Err("Token 不能为空".to_string()); }
    let model_id = match model_preset.as_str() {
        "speed" => "deepseek-v4-flash",
        "quality" => "deepseek-v4-pro",
        _ => return Err(format!("无效模型档位: {}", model_preset)),
    };
    let primary_ref = format!("{}/{}", MODEL_PROXY_PROVIDER_ID, model_id);
    let Some(home) = home_dir() else { return Err("无法定位用户主目录".to_string()); };
    let config_path = home.join(".openclaw").join("openclaw.json");
    let mut bak_path: Option<std::path::PathBuf> = None;
    if config_path.exists() {
        let bak = home.join(".openclaw").join(format!("openclaw.json.bak-{}", chrono_timestamp()));
        if let Err(e) = fs::copy(&config_path, &bak) {
            return Err(format!("OpenClaw 配置备份失败，已取消写入。请检查文件权限: {}", e));
        }
        bak_path = Some(bak);
    }
    let mut cfg: serde_json::Value = if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str(strip_bom(&content)).map_err(|e| format!("JSON parse: {}", e))?
    } else { serde_json::json!({}) };
    // Merge provider (never log token)
    if cfg.get("models").is_none() { cfg["models"] = serde_json::json!({}); }
    if cfg["models"].get("providers").is_none() { cfg["models"]["providers"] = serde_json::json!({}); }
    cfg["models"]["providers"][MODEL_PROXY_PROVIDER_ID] = serde_json::json!({
        "baseUrl": MODEL_PROXY_BASE_URL, "apiKey": token, "api": "openai-completions",
        "models": [
            { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash" },
            { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro" },
        ],
    });
    if cfg.get("agents").is_none() { cfg["agents"] = serde_json::json!({}); }
    if cfg["agents"].get("defaults").is_none() { cfg["agents"]["defaults"] = serde_json::json!({}); }
    if cfg["agents"]["defaults"].get("model").is_none() { cfg["agents"]["defaults"]["model"] = serde_json::json!({}); }
    cfg["agents"]["defaults"]["model"]["primary"] = serde_json::Value::String(primary_ref.clone());
    if cfg.get("gateway").is_none() { cfg["gateway"] = serde_json::json!({}); }
    if cfg["gateway"].get("http").is_none() { cfg["gateway"]["http"] = serde_json::json!({}); }
    if cfg["gateway"]["http"].get("endpoints").is_none() { cfg["gateway"]["http"]["endpoints"] = serde_json::json!({}); }
    if cfg["gateway"]["http"]["endpoints"].get("chatCompletions").is_none() { cfg["gateway"]["http"]["endpoints"]["chatCompletions"] = serde_json::json!({}); }
    cfg["gateway"]["http"]["endpoints"]["chatCompletions"]["enabled"] = serde_json::Value::Bool(true);
    let content = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(&config_path, &content).map_err(|e| e.to_string())?;

    // TASK-038D: Set permissions 0o600 after write
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600)) {
            return Err(format!("无法设置配置文件权限: {}", e));
        }
    }

    // TASK-038D: Validate config after write
    let validate = openclaw_command()
        .arg("config").arg("validate")
        .output();
    let validated = validate.as_ref().map(|o| o.status.success()).unwrap_or(false);
    if !validated {
        // Rollback: restore from backup
        if config_path.exists() {
            let _ = fs::remove_file(&config_path);
        }
        if let Some(ref bak) = bak_path {
            if let Err(_) = fs::copy(bak, &config_path) {
                return Err("配置校验失败，且自动恢复失败，请联系支持处理。".to_string());
            }
            // Restore backup permissions if possible
            #[cfg(unix)]
            {
                if let Ok(meta) = fs::metadata(bak) {
                    let _ = fs::set_permissions(&config_path, meta.permissions());
                }
            }
        } else {
            // No backup to restore from — remove the newly written config
            if config_path.exists() {
                let _ = fs::remove_file(&config_path);
            }
        }
        return Err("配置校验失败，已恢复原配置。请检查模型访问密钥或稍后重试。".to_string());
    }

    Ok(serde_json::json!({ "success": true, "appliedPreset": model_preset, "appliedModelId": model_id, "defaultModelRef": primary_ref, "httpChatCompletionsEnabled": true, "needsRestart": true, "validated": true, "backupCreated": true }))
}

// TASK-027C-C: Read-only list of installed skills/plugins via OpenClaw CLI
#[tauri::command]
async fn read_installed_capabilities() -> Result<serde_json::Value, String> {
    // Runs the openclaw CLI up to 3x (cold start ~0.9s each). Must run off the
    // main thread, otherwise the WebView freezes for ~2.7s when this page opens.
    tauri::async_runtime::spawn_blocking(move || {
    let mut warnings: Vec<String> = Vec::new();
    let mut skills: Vec<serde_json::Value> = Vec::new();
    let mut plugins: Vec<serde_json::Value> = Vec::new();
    let cli_available = openclaw_command().arg("--version").output().is_ok();

    if !cli_available {
        return Ok(serde_json::json!({
            "cliAvailable": false,
            "skills": [],
            "plugins": [],
            "warnings": ["OpenClaw CLI not found"],
        }));
    }

    // Read skills (skills list --json)
    match openclaw_command().args(["skills", "list", "--json"]).output() {
        Ok(out) if out.status.success() => {
            if let Ok(text) = String::from_utf8(out.stdout) {
                if let Ok(parsed) = serde_json::from_str::<Vec<serde_json::Value>>(&text) {
                    for s in parsed {
                        let mut entry = serde_json::json!({});
                        if let Some(id) = s.get("id").and_then(|v| v.as_str()) { entry["id"] = id.into(); }
                        if let Some(name) = s.get("name").and_then(|v| v.as_str()) { entry["name"] = name.into(); }
                        if let Some(desc) = s.get("description").and_then(|v| v.as_str()) { entry["description"] = desc.into(); }
                        if let Some(source) = s.get("source").and_then(|v| v.as_str()) { entry["source"] = source.into(); }
                        if let Some(version) = s.get("version").and_then(|v| v.as_str()) { entry["version"] = version.into(); }
                        entry["kind"] = "skill".into();
                        entry["installed"] = true.into();
                        skills.push(entry);
                    }
                } else {
                    warnings.push("skills list: failed to parse JSON output".into());
                }
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            warnings.push(if stderr.contains("config is invalid") {
                "skills list: OpenClaw config invalid".into()
            } else {
                format!("skills list: CLI error (exit {:?})", out.status.code())
            });
        }
        Err(e) => warnings.push(format!("skills list: {}", e)),
    }

    // Read plugins (plugins list)
    // Note: plugins list does not support --json in this version; use text output
    match openclaw_command().args(["plugins", "list"]).output() {
        Ok(out) if out.status.success() => {
            // Parse text output — each line is typically "name  kind  status  source  version  path"
            if let Ok(text) = String::from_utf8(out.stdout) {
                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with("Listing") { continue; }
                    let mut entry = serde_json::json!({
                        "kind": "plugin",
                        "installed": true,
                    });
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if !parts.is_empty() { entry["name"] = parts[0].into(); }
                    if parts.len() > 1 { entry["source"] = parts[1].into(); }
                    if parts.len() > 2 { entry["enabled"] = (parts[2] == "enabled").into(); }
                    plugins.push(entry);
                }
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            warnings.push(if stderr.contains("config is invalid") {
                "plugins list: OpenClaw config invalid".into()
            } else {
                format!("plugins list: CLI error (exit {:?})", out.status.code())
            });
        }
        Err(e) => warnings.push(format!("plugins list: {}", e)),
    }

    Ok(serde_json::json!({
        "cliAvailable": true,
        "skills": skills,
        "plugins": plugins,
        "warnings": warnings,
    }))
    }).await.map_err(|e| e.to_string())?
}

// TASK-027C-D/E: Install/uninstall records path
fn skill_records_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_root(app)?;
    Ok(dir.join("skill-install-records.json"))
}

fn load_skill_records(app: &tauri::AppHandle) -> Vec<serde_json::Value> {
    let path = match skill_records_path(app) { Ok(p) => p, Err(_) => return vec![] };
    match fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(strip_bom(&s)).ok()) {
        Some(v) => v,
        None => vec![],
    }
}

fn save_skill_records(app: &tauri::AppHandle, records: &[serde_json::Value]) {
    if let Ok(path) = skill_records_path(app) {
        if let Ok(content) = serde_json::to_string(records) {
            let _ = fs::write(&path, &content);
        }
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open").arg(&url).spawn().map_err(|e| format!("无法打开链接: {}", e))?; }
    #[cfg(target_os = "linux")]
    { std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| format!("无法打开链接: {}", e))?; }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/c", "start", "", &url]);
        hide_command_window(&mut cmd);
        cmd.spawn().map_err(|e| format!("无法打开链接: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn open_openclaw_dashboard() -> Result<serde_json::Value, String> {
    let output = openclaw_command()
        .arg("dashboard")
        .output()
        .map_err(|e| format!("无法打开 OpenClaw 控制台，请确认 OpenClaw 已安装并尝试在终端运行 openclaw dashboard。({})", e))?;
    if output.status.success() {
        Ok(serde_json::json!({ "ok": true }))
    } else {
        Err("无法打开 OpenClaw 控制台，请确认 OpenClaw 已安装并尝试在终端运行 openclaw dashboard。".to_string())
    }
}

// Resolve node.exe path on Windows (for the VBS gateway wrapper that hides
// the Node.js console window). Uses `where node` to get the full path because
// `Command::new("node")` cannot resolve npm-installed Node from a Tauri app.
#[cfg(windows)]
fn resolve_node_exe() -> Result<String, String> {
    // Cache the resolved path: `where node` is a CLI cold-start and this is called
    // on every gateway install. Only successful results are cached (and re-validated).
    static CACHE: OnceLock<String> = OnceLock::new();
    if let Some(found) = CACHE.get() {
        if std::path::Path::new(found).exists() {
            return Ok(found.clone());
        }
    }
    let mut cmd = Command::new("cmd");
    cmd.args(["/c", "where", "node"]);
    hide_command_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("无法定位 node.exe: {}", e))?;
    if !out.status.success() {
        return Err("node.exe 未找到，请确认 Node.js 已安装".to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let found = text.lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "node.exe 未找到".to_string())?;
    Ok(CACHE.get_or_init(|| found).clone())
}

// Resolve openclaw's dist/index.js entry point on Windows.
// Parses the CLI path from `openclaw gateway status` output (the "CLI version:"
// line includes the openclaw.mjs path inside parentheses), then derives
// node_modules/openclaw/dist/index.js. Falls back to %APPDATA%\npm\...\dist\index.js.
#[cfg(windows)]
fn resolve_openclaw_dist_js() -> Result<String, String> {
    // Cache: this shells out `openclaw gateway status` (CLI cold start ~0.9s) and
    // runs on every gateway install. Re-validate the cached path still exists.
    static CACHE: OnceLock<String> = OnceLock::new();
    if let Some(found) = CACHE.get() {
        if std::path::Path::new(found).exists() {
            return Ok(found.clone());
        }
    }
    let mut cmd = openclaw_command();
    cmd.args(["gateway", "status"]);
    let out = cmd.output().ok();
    if let Some(out) = out {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if line.contains("CLI version:") {
                    if let (Some(start), Some(end)) = (line.find('('), line.rfind(')')) {
                        let mjs_path = &line[start + 1..end];
                        if let Some(parent) = std::path::Path::new(mjs_path).parent() {
                            let index_js = parent.join("dist").join("index.js");
                            if index_js.exists() {
                                return Ok(CACHE.get_or_init(|| index_js.to_string_lossy().to_string()).clone());
                            }
                        }
                    }
                }
            }
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        let cand = std::path::PathBuf::from(&appdata)
            .join("npm").join("node_modules").join("openclaw").join("dist").join("index.js");
        if cand.exists() {
            return Ok(CACHE.get_or_init(|| cand.to_string_lossy().to_string()).clone());
        }
    }
    Err("无法定位 OpenClaw 入口 (dist/index.js)，请确认 openclaw 已安装。".to_string())
}

// Generate the VBS wrapper script that hides the Node.js console window.
// The Windows scheduled task runs: gateway.cmd → wrapper.vbs → node.exe index.js
// WshShell.Run(cmd, 0, False) → 0 = SW_HIDE (no window).
#[cfg(windows)]
fn generate_gateway_wrapper_vbs(node_exe: &str, index_js: &str) -> String {
    format!(
        "Set WshShell = CreateObject(\"WScript.Shell\")\r\n\
         Dim cmd, i\r\n\
         cmd = \"\"\"{}\"\"\" & \" \" & \"\"\"{}\"\"\"\r\n\
         For i = 0 To WScript.Arguments.Count - 1\r\n\
             cmd = cmd & \" \" & WScript.Arguments(i)\r\n\
         Next\r\n\
         WshShell.Run cmd, 0, False\r\n\
         Set WshShell = Nothing\r\n",
        node_exe, index_js,
    )
}

#[tauri::command]
fn start_openclaw_gateway() -> Result<serde_json::Value, String> {
    let output = openclaw_command()
        .arg("gateway").arg("start")
        .output()
        .map_err(|e| format!("无法启动本地服务，请确认 OpenClaw 已安装，或在终端运行 openclaw gateway start。({})", e))?;
    if output.status.success() {
        Ok(serde_json::json!({ "ok": true }))
    } else {
        Err("无法启动本地服务，请确认 OpenClaw 已安装，或在终端运行 openclaw gateway start。".to_string())
    }
}

// Install the OpenClaw gateway as a system service (scheduled task on Windows,
// launchd/systemd on macOS/Linux) so it auto-starts on login. On Windows this
// also generates a VBS wrapper to hide the Node.js console window. Uses --force
// for idempotency: safe to call repeatedly (e.g. every app launch).
#[tauri::command]
async fn install_gateway_service() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let node_exe = resolve_node_exe()?;
            let index_js = resolve_openclaw_dist_js()?;
            let home = home_dir().ok_or("无法定位用户主目录".to_string())?;
            let dir = home.join(".openclaw");
            fs::create_dir_all(&dir)
                .map_err(|e| format!("无法创建 .openclaw 目录: {}", e))?;
            let vbs_path = dir.join("gateway-wrapper.vbs");
            let vbs = generate_gateway_wrapper_vbs(&node_exe, &index_js);
            fs::write(&vbs_path, vbs.as_bytes())
                .map_err(|e| format!("无法写入包装脚本: {}", e))?;
            let out = openclaw_command()
                .args(["gateway", "install", "--force", "--port", "18789", "--wrapper"])
                .arg(vbs_path.to_string_lossy().to_string())
                .output()
                .map_err(|e| format!("安装网关服务失败: {}", e))?;
            if !out.status.success() {
                return Err(format!("安装网关服务失败: {}",
                    String::from_utf8_lossy(&out.stderr).trim()));
            }
        }
        #[cfg(not(windows))]
        {
            let out = openclaw_command()
                .args(["gateway", "install", "--force", "--port", "18789"])
                .output()
                .map_err(|e| format!("安装网关服务失败: {}", e))?;
            if !out.status.success() {
                return Err(format!("安装网关服务失败: {}",
                    String::from_utf8_lossy(&out.stderr).trim()));
            }
        }
        // Start the service. Its exit code is NOT trusted: `gateway start` can
        // return non-zero when the service is already running, and this command
        // is intentionally idempotent (called on every launch). We verify the real
        // outcome by hitting the gateway-specific GET /health endpoint — a genuine
        // failure (port conflict, task perms) is surfaced, while a no-op restart of
        // an already-running service still succeeds. /health (not a bare TCP probe)
        // ensures another program occupying :18789 can't be mistaken for the gateway.
        let _ = openclaw_command().args(["gateway", "start"]).output();

        // The service can take a moment to come up after start; retry briefly.
        // Worst case (genuine failure): 6 × (2s health timeout + 0.5s) ≈ 15s.
        let mut live = false;
        for _ in 0..6 {
            if probe_gateway_health_blocking() {
                live = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if !live {
            return Err("网关服务已安装但未能启动（/health 未响应，端口可能被占用），请稍后在本页点击「启动本地服务」重试。".to_string());
        }
        Ok(serde_json::json!({ "ok": true }))
    }).await.map_err(|e| e.to_string())?
}

// TASK-066/068: Detect whether the openclaw CLI is installed. Does NOT rely on
// the (possibly stale) process PATH — resolve_openclaw_bin() probes known
// install locations. Also reports `onPath` so the UI can tell the difference
// between "not installed" and "installed but needs an app restart".
#[tauri::command]
async fn check_openclaw_installed() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // First: does a launcher exist at any known location (or on PATH)?
        // On Windows, `Command::new("openclaw")` does NOT resolve the `.cmd`
        // shim that npm installs, so a bare probe wrongly reports false even
        // when `where openclaw` succeeds. Use `cmd /c where` there instead.
        let on_path = {
            #[cfg(windows)]
            let mut probe = {
                let mut c = Command::new("cmd");
                c.args(["/c", "where", "openclaw"]);
                c
            };
            #[cfg(not(windows))]
            let mut probe = {
                let mut c = Command::new("openclaw");
                c.arg("--version");
                c
            };
            hide_command_window(&mut probe);
            probe.output().map(|o| o.status.success()).unwrap_or(false)
        };
        let known = openclaw_known_paths().into_iter().find(|p| p.exists());
        let installed_by_fs = on_path || known.is_some();

        // Try to read the actual version via the resolved binary.
        let mut cmd = openclaw_command();
        cmd.arg("--version");
        hide_command_window(&mut cmd);
        let version = match cmd.output() {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout);
                text.split_whitespace()
                    .find(|t| t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && t.contains('.'))
                    .unwrap_or("").to_string()
            }
            _ => String::new(),
        };

        // installed = we can run it OR a launcher file exists on disk.
        let installed = !version.is_empty() || installed_by_fs;
        serde_json::json!({ "installed": installed, "version": version, "onPath": on_path })
    }).await.map_err(|e| e.to_string())
}

// TASK-066: One-click install of the openclaw CLI via the official installer
// script. We shell out to the platform installer (PowerShell on Windows, bash
// on macOS/Linux), stream every output line to the UI via "openclaw-install-log"
// events, and emit "openclaw-install-done" with the exit result at the end.
#[tauri::command]
async fn install_openclaw(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut cmd = build_openclaw_install_command();
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_command_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("无法启动安装程序：{}", e))?;
    let stdout = child.stdout.take().ok_or("无法读取安装输出")?;
    let stderr = child.stderr.take().ok_or("无法读取安装输出")?;

    // Drain stderr on its own thread so it can't block the pipe.
    let app_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_err.emit("openclaw-install-log", serde_json::json!({ "line": strip_ansi(&line) }));
        }
    });

    // Stream stdout line-by-line, then wait for the process and report the result.
    let app_out = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_out.emit("openclaw-install-log", serde_json::json!({ "line": strip_ansi(&line) }));
        }
        let status = child.wait();
        let success = status.map(|s| s.success()).unwrap_or(false);
        let _ = app_out.emit("openclaw-install-done", serde_json::json!({ "success": success }));
    });

    Ok(serde_json::json!({ "ok": true, "started": true }))
}

// Build the platform-specific command that runs the official openclaw installer.
// We pass the no-onboard flag so the installer does NOT launch the interactive
// onboarding wizard at the end — that wizard expects a TTY and hangs when run
// headless from inside the app.
fn build_openclaw_install_command() -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = std::process::Command::new("powershell");
        cmd.args([
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
            "& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard",
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("bash");
        cmd.args([
            "-c",
            "curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard",
        ]);
        cmd
    }
}

// One-click uninstall of the openclaw CLI. Mirrors install_openclaw's streaming
// model: shells out to `npm uninstall -g openclaw`, streams output through the
// same openclaw-install-log / openclaw-install-done events (the frontend store
// reuses them), and reports success.
//
// IMPORTANT (per product decision): this removes the CLI program only. It does
// NOT touch ~/.openclaw (user config, API key, workspace, installed skills), so
// reinstalling restores the previous setup. We also best-effort remove any stale
// launcher shim left behind by npm, but never the data dir.
#[tauri::command]
async fn uninstall_openclaw(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut cmd = build_openclaw_uninstall_command();
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_command_window(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("无法启动卸载程序：{}", e))?;
    let stdout = child.stdout.take().ok_or("无法读取卸载输出")?;
    let stderr = child.stderr.take().ok_or("无法读取卸载输出")?;

    let app_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_err.emit("openclaw-install-log", serde_json::json!({ "line": strip_ansi(&line) }));
        }
    });

    let app_out = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_out.emit("openclaw-install-log", serde_json::json!({ "line": strip_ansi(&line) }));
        }
        let status = child.wait();
        let mut success = status.map(|s| s.success()).unwrap_or(false);
        // Best-effort: remove leftover launcher shims (npm sometimes leaves them).
        // Never remove ~/.openclaw — data is intentionally preserved.
        for shim in openclaw_known_paths() {
            if shim.exists() { let _ = fs::remove_file(&shim); }
        }
        // Re-verify the CLI is actually gone so a non-zero npm exit (e.g. "not
        // installed") still resolves to success when no launcher remains.
        if !success && !openclaw_known_paths().iter().any(|p| p.exists()) {
            let _ = app_out.emit("openclaw-install-log", serde_json::json!({ "line": "openclaw 启动器已不存在，视为卸载完成" }));
            success = true;
        }
        let _ = app_out.emit("openclaw-uninstall-done", serde_json::json!({ "success": success }));
    });

    Ok(serde_json::json!({ "ok": true, "started": true }))
}

// Build the platform-specific `npm uninstall -g openclaw` command.
fn build_openclaw_uninstall_command() -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // npm on Windows is a .cmd shim, so it must run through `cmd /c`.
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/c", "npm", "uninstall", "-g", "openclaw"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("bash");
        cmd.args(["-lc", "npm uninstall -g openclaw"]);
        cmd
    }
}

fn main() {
    tauri::Builder::default()
        // Persist & restore window size/position across launches (Windows users
        // lose their adjusted window otherwise). Rust-side registration is enough.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![read_config, write_config, clear_config, read_chat_sessions, write_chat_sessions, clear_chat_sessions, read_usage_log, append_usage_log, clear_usage_log, read_chat_projects, write_chat_projects, portable_data_status, portable_runtime_status, read_installed_capabilities, read_openclaw_workspace_memory, ensure_ai_files_dirs, list_ai_files, delete_ai_file, open_ai_file_location, pick_and_upload_file, extract_ai_file_text, save_generated_file, read_openclaw_gateway_auth_for_local_use, get_or_create_openclaw_device_identity, open_url, open_openclaw_dashboard, start_openclaw_gateway, install_gateway_service, openclaw_http_chat_completion, openclaw_http_chat_completion_stream, cancel_openclaw_chat_completion, openclaw_http_status, openclaw_session_status, openclaw_web_search, openclaw_sessions_list, clawhub_browse, clawhub_search, clawhub_skill_detail, openclaw_skills_list, clawhub_install_skill, clawhub_uninstall_skill, translate_text, read_openclaw_config_summary, read_openclaw_model_provider_summary, apply_openclaw_model_provider_config, list_openclaw_channels, add_openclaw_channel, remove_openclaw_channel, restart_openclaw_gateway, list_pairing_requests, approve_pairing_request, get_openclaw_version, start_wechat_login, cancel_wechat_login, check_openclaw_installed, install_openclaw, uninstall_openclaw, update::check_update, update::download_update, update::apply_update])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
