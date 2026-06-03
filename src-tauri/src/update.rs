// TASK-065: Portable app self-updater for U-disk deployment (GitHub Releases)

use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

const GITHUB_OWNER: &str = "Yexiangl";
const GITHUB_REPO: &str = "ai-agent-u-ai-1-new";

// ── check_update: Query GitHub API for latest release ──────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub download_url: Option<String>,
    pub release_notes: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();

    // We avoid the GitHub REST API (api.github.com) because anonymous requests
    // are rate-limited to 60/hour per IP — on shared/NAT networks this quickly
    // returns HTTP 403. Instead we use two endpoints served by the normal
    // github.com web CDN, which are NOT counted against that API rate limit:
    //   1. /releases/latest        → 302 redirects to /releases/tag/<tag>
    //   2. /releases/expanded_assets/<tag> → HTML fragment listing the assets
    let err_result = |msg: String| UpdateInfo {
        available: false, current_version: current.clone(), latest_version: None,
        download_url: None, release_notes: None, error: Some(msg),
    };

    // Step 1: resolve the latest tag from the redirect Location, WITHOUT
    // following it (so we can read the header cheaply).
    let no_redirect = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("ai-agent-workspace-updater/0.1")
        .build()
        .map_err(|e| format!("HTTP 初始化失败: {}", e))?;

    let latest_url = format!("https://github.com/{}/{}/releases/latest", GITHUB_OWNER, GITHUB_REPO);
    let resp = match no_redirect.get(&latest_url).timeout(Duration::from_secs(15)).send().await {
        Ok(r) => r,
        Err(e) => return Ok(err_result(format!("无法访问 GitHub: {}", e))),
    };

    // Expect a 3xx with a Location pointing at /releases/tag/<tag>.
    let location = resp.headers().get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let tag = match location.as_deref().and_then(|loc| loc.rsplit("/tag/").next()) {
        Some(t) if !t.is_empty() && t.contains(|c: char| c.is_ascii_digit()) => t.to_string(),
        _ => {
            // No redirect → likely no releases published yet, or an unexpected response.
            if resp.status().is_success() {
                return Ok(err_result("尚未发布任何版本".into()));
            }
            return Ok(err_result(format!("检查更新失败：HTTP {}", resp.status().as_u16())));
        }
    };
    let version = tag.trim_start_matches('v').to_string();

    // Step 2: fetch the asset list fragment and pick the platform-appropriate file.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .user_agent("ai-agent-workspace-updater/0.1")
        .build()
        .map_err(|e| format!("HTTP 初始化失败: {}", e))?;

    let assets_url = format!("https://github.com/{}/{}/releases/expanded_assets/{}", GITHUB_OWNER, GITHUB_REPO, tag);
    let assets_html = match client.get(&assets_url).timeout(Duration::from_secs(15)).send().await {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(_) => String::new(),
    };

    // Parse `releases/download/<tag>/<file>` paths out of the HTML (no regex dep).
    let asset_names = parse_asset_names(&assets_html);
    let pick = |predicate: &dyn Fn(&str) -> bool| -> Option<String> {
        asset_names.iter().find(|n| predicate(&n.to_lowercase())).cloned()
    };

    let chosen = if cfg!(target_os = "windows") {
        pick(&|n| n.contains("portable") && n.ends_with(".exe"))
            .or_else(|| pick(&|n| n.ends_with(".exe")))
    } else if cfg!(target_os = "macos") {
        pick(&|n| n.ends_with(".dmg"))
    } else {
        pick(&|n| n.ends_with(".appimage") || n.ends_with(".deb"))
    };

    let download_url = chosen.as_ref().map(|name|
        format!("https://github.com/{}/{}/releases/download/{}/{}", GITHUB_OWNER, GITHUB_REPO, tag, name));

    let newer = version_gt(&version, &current);
    let missing_asset = newer && download_url.is_none();

    Ok(UpdateInfo {
        available: newer && download_url.is_some(),
        current_version: current,
        latest_version: Some(version.clone()),
        download_url,
        release_notes: None,
        error: if missing_asset {
            Some(format!("发现新版本 {} 但未找到适配当前系统的安装包", version))
        } else { None },
    })
}

// Extract asset file names from a release's expanded_assets HTML fragment.
// Looks for substrings like `releases/download/<tag>/<file>` and returns the
// trailing <file> portion. No external regex dependency needed.
fn parse_asset_names(html: &str) -> Vec<String> {
    const MARKER: &str = "releases/download/";
    let mut out: Vec<String> = Vec::new();
    for (idx, _) in html.match_indices(MARKER) {
        let rest = &html[idx + MARKER.len()..];
        // rest starts with "<tag>/<file>...". Cut at the closing quote/space/angle.
        let end = rest.find(|c: char| c == '"' || c == '\'' || c == '<' || c == ' ' || c == '\n')
            .unwrap_or(rest.len());
        let path = &rest[..end];
        if let Some(name) = path.rsplit('/').next() {
            if !name.is_empty() && !out.iter().any(|n| n == name) {
                out.push(name.to_string());
            }
        }
    }
    out
}

// Semver-ish compare: returns true if `a` > `b`. Falls back to false on parse issues.
fn version_gt(a: &str, b: &str) -> bool {
    parse_ver(a) > parse_ver(b)
}

fn parse_ver(v: &str) -> (u64, u64, u64) {
    let core = v.trim_start_matches('v').split(['-', '+']).next().unwrap_or("");
    let mut it = core.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

// ── download_update: Stream the installer to the update dir, emit progress ──

// Where downloaded installers are staged. On portable installs this lives on
// the U-disk under data/updates; otherwise it falls back to the system temp dir.
fn update_dir() -> Result<PathBuf, String> {
    let dir = match crate::workspace_root() {
        Some(root) => root.join("data").join("updates"),
        None => std::env::temp_dir().join("ai-agent-workspace-updates"),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建更新目录: {}", e))?;
    Ok(dir)
}

#[tauri::command]
pub async fn download_update(app: AppHandle, url: String, version: String) -> Result<String, String> {
    // Derive a safe filename from the URL, fall back to a versioned default.
    let ext = if cfg!(target_os = "windows") { "exe" } else { "dmg" };
    let file_name = url.rsplit('/').next()
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')))
        .map(str::to_string)
        .unwrap_or_else(|| format!("AI-Agent-Workspace-{}.{}", version, ext));
    let dest = update_dir()?.join(&file_name);

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .user_agent("ai-agent-workspace-updater/0.1")
        .build()
        .map_err(|e| format!("HTTP 初始化失败: {}", e))?;

    let resp = client.get(&url).send().await
        .map_err(|e| format!("下载失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败：服务器返回 HTTP {}", resp.status().as_u16()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut last_pct: i64 = -1;
    let mut file = fs::File::create(&dest).map_err(|e| format!("无法写入文件: {}", e))?;
    let mut stream = resp.bytes_stream();

    use std::io::Write;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("下载中断: {}", e))?;
        file.write_all(&bytes).map_err(|e| format!("写入失败: {}", e))?;
        downloaded += bytes.len() as u64;
        let pct = if total > 0 { (downloaded * 100 / total) as i64 } else { -1 };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit("update-download-progress", serde_json::json!({
                "downloaded": downloaded, "total": total, "pct": pct,
            }));
        }
    }
    file.flush().map_err(|e| format!("保存失败: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

// ── apply_update: Launch installer OR swap the portable exe in place ──────
//
// - If the downloaded file is the portable .exe: generate a .bat script to swap
//   it after this process exits, then quit.
// - Otherwise (installer .dmg / NSIS .exe): launch it and quit.

#[tauri::command]
pub fn apply_update(app: AppHandle, installer_path: String) -> Result<(), String> {
    let path = PathBuf::from(&installer_path);
    if !path.exists() {
        return Err("更新包不存在，请重新下载。".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;

        let is_portable_exe = path.extension().and_then(|e| e.to_str()) == Some("exe")
            && path.file_name().and_then(|n| n.to_str()).map(|n| n.contains("portable")).unwrap_or(false);
        if is_portable_exe {
            // Portable swap: generate a .bat that waits for this process to exit,
            // renames the running exe to .bak, drops the new exe in place,
            // relaunches, cleans up the .bak, then deletes itself.
            let current_exe = std::env::current_exe().map_err(|e| format!("获取当前程序路径失败: {}", e))?;
            let backup = current_exe.with_file_name(format!("{}.bak", current_exe.file_name().unwrap().to_string_lossy()));
            let bat_path = current_exe.with_file_name("_update.bat");

            // ping is used instead of `timeout` because the script runs with no
            // console window, where `timeout` (needs stdin) would fail.
            // `(goto) 2>nul & del "%~f0"` is the canonical self-delete that avoids
            // the "找不到批处理文件 / batch file cannot be found" error.
            let script = format!(
                "@echo off\r\n\
ping 127.0.0.1 -n 4 >nul\r\n\
move /y \"{cur}\" \"{bak}\" >nul 2>&1\r\n\
move /y \"{new}\" \"{cur}\" >nul 2>&1\r\n\
start \"\" \"{cur}\"\r\n\
ping 127.0.0.1 -n 3 >nul\r\n\
del /q \"{bak}\" >nul 2>&1\r\n\
(goto) 2>nul & del \"%~f0\"\r\n",
                cur = current_exe.display(),
                bak = backup.display(),
                new = path.display(),
            );

            fs::write(&bat_path, script).map_err(|e| format!("生成更新脚本失败: {}", e))?;

            // Launch the script hidden and detached so no console window appears
            // and it survives this process exiting.
            std::process::Command::new("cmd")
                .args(["/c", &bat_path.to_string_lossy()])
                .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
                .spawn()
                .map_err(|e| format!("启动更新脚本失败: {}", e))?;

            let app_handle = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                app_handle.exit(0);
            });
            return Ok(());
        }

        // Windows installer: launch it.
        std::process::Command::new(&path).spawn().map_err(|e| format!("无法启动安装程序: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&path).spawn().map_err(|e| format!("无法打开安装包: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| format!("无法打开安装包: {}", e))?;
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        app_handle.exit(0);
    });
    Ok(())
}



