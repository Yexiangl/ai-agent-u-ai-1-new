use std::fs;
use std::collections::HashMap;
use std::error::Error;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use futures_util::StreamExt;
use calamine::Reader;
use tauri::{Emitter, Manager};

type CancelMap = Mutex<HashMap<String, Arc<AtomicBool>>>;
type TaskMap = Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>;

fn cancel_map() -> &'static CancelMap {
    static MAP: OnceLock<CancelMap> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn task_map() -> &'static TaskMap {
    static MAP: OnceLock<TaskMap> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("config.json"))
}

fn chat_sessions_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("chat-sessions.json"))
}

#[tauri::command]
fn read_config(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
fn write_config(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = config_path(&app)?;
    let content = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
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
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    match serde_json::from_str(&content) {
        Ok(value) => Ok(value),
        Err(error) => {
            eprintln!("chat-sessions.json parse error: {}", error);
            Ok(serde_json::json!([]))
        }
    }
}

#[tauri::command]
fn write_chat_sessions(app: tauri::AppHandle, sessions: serde_json::Value) -> Result<(), String> {
    let path = chat_sessions_path(&app)?;
    let content = serde_json::to_string_pretty(&sessions).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_chat_sessions(app: tauri::AppHandle) -> Result<(), String> {
    let path = chat_sessions_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
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

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    ["key", "api_key", "token", "secret", "password", "authorization"]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn clean_yaml_scalar(value: &str) -> String {
    value
        .split('#')
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches(&['"', '\''] as &[_])
        .to_string()
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

fn run_command_timeout(command: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;

    let started = std::time::Instant::now();
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(_) => {
                let output = child.wait_with_output().map_err(|error| error.to_string())?;
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(if stderr.is_empty() { "command failed".to_string() } else { stderr });
            }
            None => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    return Err("command timed out".to_string());
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn run_command_capture_timeout(command: &str, args: &[&str], timeout: Duration) -> serde_json::Value {
    let mut child = match Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return serde_json::json!({
                "ok": false,
                "stdout": "",
                "stderr": error.to_string(),
                "error": error.to_string()
            })
        }
    };

    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => match child.wait_with_output() {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    return serde_json::json!({
                        "ok": output.status.success(),
                        "stdout": stdout,
                        "stderr": stderr,
                        "error": if output.status.success() { serde_json::Value::Null } else { serde_json::Value::String(stderr.clone()) }
                    });
                }
                Err(error) => {
                    return serde_json::json!({
                        "ok": false,
                        "stdout": "",
                        "stderr": error.to_string(),
                        "error": error.to_string()
                    })
                }
            },
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    return serde_json::json!({
                        "ok": false,
                        "stdout": "",
                        "stderr": "command timed out",
                        "error": "command timed out"
                    });
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                return serde_json::json!({
                    "ok": false,
                    "stdout": "",
                    "stderr": error.to_string(),
                    "error": error.to_string()
                })
            }
        }
    }
}

fn hermes_binary_path() -> Result<String, String> {
    if cfg!(target_os = "windows") {
        run_command_timeout("where", &["hermes"], Duration::from_secs(5))
    } else {
        run_command_timeout("which", &["hermes"], Duration::from_secs(5))
    }
    .map(|output| output.lines().next().unwrap_or_default().to_string())
}

fn hermes_status() -> serde_json::Value {
    let checked_at = checked_at();
    let hermes_root = home_dir().map(|home| home.join(".hermes"));
    let config_file = hermes_root.as_ref().map(|root| root.join("config.yaml"));
    let skills_dir = hermes_root.as_ref().map(|root| root.join("skills"));
    let memory_dir = hermes_root.as_ref().map(|root| root.join("memory"));

    let binary = hermes_binary_path();
    let installed = binary.as_ref().map(|path| !path.is_empty()).unwrap_or(false);
    let version = if installed {
        run_command_timeout("hermes", &["--version"], Duration::from_secs(5)).ok()
    } else {
        None
    };

    serde_json::json!({
        "installed": installed,
        "binaryPath": binary.as_ref().ok().filter(|path| !path.is_empty()).cloned(),
        "version": version,
        "configDir": hermes_root.as_ref().filter(|path| path.exists()).map(|path| path.to_string_lossy().to_string()),
        "configFile": config_file.as_ref().filter(|path| path.exists()).map(|path| path.to_string_lossy().to_string()),
        "skillsDir": skills_dir.as_ref().filter(|path| path.exists()).map(|path| path.to_string_lossy().to_string()),
        "memoryDir": memory_dir.as_ref().filter(|path| path.exists()).map(|path| path.to_string_lossy().to_string()),
        "checkedAt": checked_at,
        "error": binary.err()
    })
}

fn probe_hermes_api(host: &str) -> Result<serde_json::Value, String> {
    let timeout = Duration::from_secs(3);
    let addr: SocketAddr = "127.0.0.1:8642".parse::<SocketAddr>().map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect_timeout(&addr, timeout).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(timeout)).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(timeout)).map_err(|error| error.to_string())?;

    let request = format!(
        "GET /v1/models HTTP/1.1\r\nHost: {}:8642\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        host
    );
    stream.write_all(request.as_bytes()).map_err(|error| error.to_string())?;

    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|error| error.to_string())?;

    let mut parts = response.splitn(2, "\r\n\r\n");
    let headers = parts.next().unwrap_or_default();
    let body = parts.next().unwrap_or_default();
    if !headers.starts_with("HTTP/1.1 200") && !headers.starts_with("HTTP/1.0 200") {
        let status = headers.lines().next().unwrap_or("HTTP error");
        return Err(status.to_string());
    }

    let json: serde_json::Value = serde_json::from_str(body).map_err(|error| error.to_string())?;
    let models = json
        .get("data")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()).map(|id| id.to_string()))
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();

    Ok(serde_json::json!({
        "running": true,
        "baseUrl": format!("http://{}:8642/v1", host),
        "models": models,
        "checkedAt": checked_at(),
        "error": null
    }))
}

#[tauri::command]
fn check_hermes_installed() -> Result<serde_json::Value, String> {
    Ok(hermes_status())
}

#[tauri::command]
fn get_hermes_version() -> Result<Option<String>, String> {
    Ok(run_command_timeout("hermes", &["--version"], Duration::from_secs(5)).ok())
}

#[tauri::command]
fn get_hermes_paths() -> Result<serde_json::Value, String> {
    Ok(hermes_status())
}

#[tauri::command]
fn get_hermes_help() -> Result<serde_json::Value, String> {
    Ok(run_command_capture_timeout("hermes", &["--help"], Duration::from_secs(5)))
}

#[tauri::command]
fn check_hermes_api_server() -> Result<serde_json::Value, String> {
    let checked_at = checked_at();
    let mut errors = Vec::new();

    for host in ["127.0.0.1", "localhost"] {
        match probe_hermes_api(host) {
            Ok(result) => return Ok(result),
            Err(error) => errors.push(format!("{}: {}", host, error)),
        }
    }

    Ok(serde_json::json!({
        "running": false,
        "baseUrl": null,
        "models": [],
        "checkedAt": checked_at,
        "error": errors.join("; ")
    }))
}

fn emit_hermes_error(app: &tauri::AppHandle, request_id: &str, error: &str) {
    let _ = app.emit("hermes-chat-error", serde_json::json!({
        "requestId": request_id,
        "error": error,
        "url": "http://127.0.0.1:8642/v1/chat/completions",
        "model": null,
        "status": null,
        "body": null
    }));
}

fn emit_hermes_error_full(app: &tauri::AppHandle, request_id: &str, error: &str, status: u16, body: &str) {
    let _ = app.emit("hermes-chat-error", serde_json::json!({
        "requestId": request_id,
        "error": error,
        "url": "http://127.0.0.1:8642/v1/chat/completions",
        "model": null,
        "status": status,
        "body": body
    }));
}

struct SseEvent {
    event: String,
    data: String,
}

fn preview_text(input: &str) -> String {
    let mut out = input.replace('\r', "\\r").replace('\n', "\\n");
    for needle in ["authorization", "api_key", "apikey", "token", "secret", "password"] {
        out = out.replace(needle, "[redacted-key]");
        out = out.replace(&needle.to_uppercase(), "[REDACTED-KEY]");
    }
    out.chars().take(300).collect()
}

fn error_source_chain(error: &dyn Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut current = error.source();
    while let Some(source) = current {
        parts.push(source.to_string());
        current = source.source();
    }
    parts.join(" <- ")
}

fn request_messages_summary(messages: &serde_json::Value) -> serde_json::Value {
    let Some(items) = messages.as_array() else {
        return serde_json::json!({
            "messagesIsArray": false,
            "messageCount": 0,
            "totalContentChars": 0,
            "hasSystemPrompt": false,
            "hasAssistantHistory": false,
            "emptyContentCount": 0,
            "nonStringContentCount": 0,
            "unexpectedFieldCount": 0,
            "messages": []
        });
    };
    let mut total_chars = 0usize;
    let mut empty_content_count = 0usize;
    let mut non_string_content_count = 0usize;
    let mut unexpected_field_count = 0usize;
    let mut has_system_prompt = false;
    let mut has_assistant_history = false;
    let mut summaries = Vec::new();
    for (idx, item) in items.iter().enumerate() {
        let role = item.get("role").and_then(|value| value.as_str()).unwrap_or("<missing>");
        let content_value = item.get("content");
        let content = content_value.and_then(|value| value.as_str());
        if role == "system" { has_system_prompt = true; }
        if role == "assistant" { has_assistant_history = true; }
        if content_value.is_some() && content.is_none() { non_string_content_count += 1; }
        let content = content.unwrap_or_default();
        if content.is_empty() { empty_content_count += 1; }
        total_chars += content.chars().count();
        let unexpected_fields = item.as_object()
            .map(|object| object.keys().filter(|key| key.as_str() != "role" && key.as_str() != "content").count())
            .unwrap_or(0);
        unexpected_field_count += unexpected_fields;
        summaries.push(serde_json::json!({
            "index": idx,
            "role": role,
            "contentChars": content.chars().count(),
            "preview": preview_text(content).chars().take(60).collect::<String>(),
            "unexpectedFields": unexpected_fields,
            "contentIsString": content_value.map(|value| value.is_string()).unwrap_or(false)
        }));
    }
    serde_json::json!({
        "messagesIsArray": true,
        "messageCount": items.len(),
        "totalContentChars": total_chars,
        "hasSystemPrompt": has_system_prompt,
        "hasAssistantHistory": has_assistant_history,
        "emptyContentCount": empty_content_count,
        "nonStringContentCount": non_string_content_count,
        "unexpectedFieldCount": unexpected_field_count,
        "messages": summaries
    })
}

fn emit_stream_diagnostics(app: &tauri::AppHandle, request_id: &str, diagnostics: serde_json::Value) {
    let _ = app.emit("hermes-stream-diagnostics", serde_json::json!({
        "requestId": request_id,
        "diagnostics": diagnostics
    }));
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
fn hermes_chat_completion(app: tauri::AppHandle, request_id: String, model: String, messages: serde_json::Value) -> Result<serde_json::Value, String> {
    let rid = request_id.clone();
    let mdl = model.clone();

    let cancel_flag = Arc::new(AtomicBool::new(false));
    cancel_map().lock().unwrap().insert(rid.clone(), cancel_flag.clone());

    let rid_for_handle = rid.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let url = "http://127.0.0.1:8642/v1/chat/completions";
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build() {
            Ok(client) => client,
            Err(e) => {
                emit_hermes_error(&app, &rid, &format!("创建 HTTP client 失败: {}", e));
                return;
            }
        };

        let request_body = serde_json::json!({
            "model": mdl,
            "messages": messages,
            "stream": true
        });
        let request_summary = request_messages_summary(request_body.get("messages").unwrap_or(&serde_json::Value::Null));
        println!("[stream-debug] request requestId={} url={} model={} stream={} timeout=connect-only messages={}", rid, url, request_body.get("model").and_then(|v| v.as_str()).unwrap_or(""), request_body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false), request_summary);

        let response = match client
            .post(url)
            .header("Accept", "text/event-stream")
            .header("Accept-Encoding", "identity")
            .json(&request_body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                emit_hermes_error(&app, &rid, &format!("无法连接 Hermes API Server: {}", e));
                return;
            }
        };

        let status_code = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let transfer_encoding = response
            .headers()
            .get("transfer-encoding")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let content_encoding = response
            .headers()
            .get("content-encoding")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let connection_header = response
            .headers()
            .get("connection")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let session_id = response
            .headers()
            .get("x-hermes-session-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let is_sse = content_type.contains("text/event-stream");
        println!("[stream-debug] response requestId={} status={} contentType={} transferEncoding={} contentEncoding={} connection={} isSse={}", rid, status_code, content_type, transfer_encoding, content_encoding, connection_header, is_sse);
        emit_stream_diagnostics(&app, &rid, serde_json::json!({
            "url": url,
            "model": mdl,
            "streamRequested": true,
            "requestSummary": request_summary.clone(),
            "timeout": "connect_timeout=10s; no total response timeout",
            "status": status_code,
            "contentType": content_type,
            "transferEncoding": transfer_encoding,
            "contentEncoding": content_encoding,
            "connection": connection_header,
            "isSse": is_sse,
            "fallbackToNonStreamJson": false
        }));

        if status_code != 200 {
            let body_text = response.text().await.unwrap_or_default();
            let body_summary: String = body_text.chars().take(500).collect();
            emit_hermes_error_full(&app, &rid, &format!("HTTP {}: Hermes API Server 返回错误", status_code), status_code, &body_summary);
            return;
        }

        if !is_sse {
            emit_stream_diagnostics(&app, &rid, serde_json::json!({
                "url": url,
                "model": mdl,
                "streamRequested": true,
                "status": status_code,
                "contentType": content_type,
                "transferEncoding": transfer_encoding,
                "isSse": false,
                "fallbackToNonStreamJson": true
            }));
            match response.json::<serde_json::Value>().await {
                Ok(json) => {
                    let message = json
                        .get("choices").and_then(|c| c.get(0))
                        .and_then(|c| c.get("message"));
                    let content = message
                        .and_then(|m| m.get("content")).and_then(|c| c.as_str()).unwrap_or("").to_string();
                    let reasoning_content = message
                        .and_then(|m| m.get("reasoning_content")).and_then(|r| r.as_str()).unwrap_or("").to_string();
                    let usage = json.get("usage").cloned();
                    let elapsed_ms = started.elapsed().as_millis() as u64;
                    if !content.is_empty() {
                        let _ = app.emit("hermes-chat-chunk", serde_json::json!({
                            "requestId": rid, "content": content, "type": "content"
                        }));
                    }
                    if !reasoning_content.is_empty() {
                        let _ = app.emit("hermes-chat-chunk", serde_json::json!({
                            "requestId": rid, "content": reasoning_content, "reasoningContent": reasoning_content, "type": "reasoning"
                        }));
                    }
                    let _ = app.emit("hermes-chat-done", serde_json::json!({
                        "requestId": rid,
                        "content": content,
                        "reasoningContent": reasoning_content,
                        "model": mdl,
                        "rawUsage": usage,
                        "sessionId": session_id,
                        "elapsedMs": elapsed_ms,
                        "diagnostics": {
                            "contentType": content_type,
                            "transferEncoding": transfer_encoding,
                            "isSse": false,
                            "fallbackToNonStreamJson": true,
                            "firstByteMs": null,
                            "bytesChunkCount": 0,
                            "sseEventCount": 0,
                            "dataLineCount": 0,
                            "chunkCount": if !content.is_empty() || !reasoning_content.is_empty() { 1 } else { 0 },
                            "contentChunkCount": if !content.is_empty() { 1 } else { 0 },
                            "reasoningChunkCount": if !reasoning_content.is_empty() { 1 } else { 0 },
                            "toolEventCount": 0,
                            "emptyDeltaCount": 0,
                            "parseErrorCount": 0,
                            "receivedDone": true
                        }
                    }));
                }
                Err(e) => {
                    emit_hermes_error(&app, &rid, &format!("JSON 解析失败: {}", e));
                }
            }
            return;
        }

        let mut content_accumulated = String::new();
        let mut reasoning_accumulated = String::new();
        let mut usage_info: Option<serde_json::Value> = None;
        let mut chunk_count: u64 = 0;
        let mut bytes_chunk_count: u64 = 0;
        let mut sse_event_count: u64 = 0;
        let mut data_line_count: u64 = 0;
        let mut content_chunk_count: u64 = 0;
        let mut reasoning_chunk_count: u64 = 0;
        let mut tool_event_count: u64 = 0;
        let mut empty_delta_count: u64 = 0;
        let mut parse_error_count: u64 = 0;
        let mut has_done = false;
        let mut first_byte_ms: Option<u64> = None;
        let mut first_content_ms: Option<u64> = None;
        let mut last_content_ms: u64 = 0;
        let mut finish_reason: Option<String> = None;
        let mut last_byte_at = started;
        let mut line_buffer = String::new();
        let mut current_event = SseEvent { event: "message".to_string(), data: String::new() };
        let mut stream = response.bytes_stream();

        while let Some(item) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                println!("[stream-debug] cancelled by user requestId={}", rid);
                let elapsed_ms = started.elapsed().as_millis() as u64;
                let _ = app.emit("hermes-chat-done", serde_json::json!({
                    "requestId": rid,
                    "content": content_accumulated,
                    "reasoningContent": reasoning_accumulated,
                    "model": mdl,
                    "rawUsage": usage_info,
                    "sessionId": session_id,
                    "elapsedMs": elapsed_ms,
                    "stopped": true,
                    "partial": !content_accumulated.is_empty() || !reasoning_accumulated.is_empty(),
                    "warning": "已停止生成",
                    "diagnostics": { "stoppedByUser": true }
                }));
                cancel_map().lock().unwrap().remove(&rid);
                return;
            }
            let bytes = match item {
                Ok(bytes) => bytes,
                Err(e) => {
                    let error_display = e.to_string();
                    let error_debug = format!("{:?}", e);
                    let error_chain = error_source_chain(&e);
                    println!("[stream-debug] stream read error requestId={} display={} debug={} sourceChain={}", rid, error_display, error_debug, error_chain);
                    let diagnostics = serde_json::json!({
                        "contentType": content_type,
                        "transferEncoding": transfer_encoding,
                        "contentEncoding": content_encoding,
                        "connection": connection_header,
                        "isSse": true,
                        "fallbackToNonStreamJson": false,
                        "firstByteMs": first_byte_ms,
                        "bytesChunkCount": bytes_chunk_count,
                        "sseEventCount": sse_event_count,
                        "dataLineCount": data_line_count,
                        "chunkCount": chunk_count,
                        "contentChunkCount": content_chunk_count,
                        "reasoningChunkCount": reasoning_chunk_count,
                        "toolEventCount": tool_event_count,
                        "emptyDeltaCount": empty_delta_count,
                        "parseErrorCount": parse_error_count,
                        "receivedDone": false,
                        "streamReadError": true,
                        "streamError": error_display,
                        "streamErrorDebug": error_debug,
                        "streamErrorSourceChain": error_chain,
                        "partial": !content_accumulated.is_empty() || !reasoning_accumulated.is_empty() || tool_event_count > 0
                    });
                    if !content_accumulated.is_empty() || !reasoning_accumulated.is_empty() || tool_event_count > 0 {
                        let warning = if content_accumulated.is_empty() && reasoning_accumulated.is_empty() {
                            "工具执行后流式连接提前结束，未收到正式回复"
                        } else {
                            "流式连接提前结束，已保留已生成内容"
                        };
                        let _ = app.emit("hermes-chat-done", serde_json::json!({
                            "requestId": rid,
                            "content": content_accumulated,
                            "reasoningContent": reasoning_accumulated,
                            "model": mdl,
                            "rawUsage": usage_info,
                            "sessionId": session_id,
                            "elapsedMs": started.elapsed().as_millis() as u64,
                            "partial": true,
                            "warning": warning,
                            "streamError": diagnostics.get("streamError").cloned().unwrap_or(serde_json::Value::Null),
                            "diagnostics": diagnostics
                        }));
                    } else {
                        emit_hermes_error(&app, &rid, &format!("读取流式响应失败: {}", diagnostics.get("streamError").and_then(|v| v.as_str()).unwrap_or("unknown")));
                    }
                    return;
                }
            };
            let now = std::time::Instant::now();
            let elapsed_ms = started.elapsed().as_millis() as u64;
            let interval_ms = now.duration_since(last_byte_at).as_millis() as u64;
            last_byte_at = now;
            bytes_chunk_count += 1;
            if first_byte_ms.is_none() {
                first_byte_ms = Some(elapsed_ms);
            }
            let chunk_text = String::from_utf8_lossy(&bytes);
            let preview = if bytes_chunk_count <= 5 { preview_text(&chunk_text) } else { String::new() };
            println!("[stream-debug] bytes requestId={} bytesChunk={} len={} elapsedMs={} intervalMs={} preview={}", rid, bytes_chunk_count, bytes.len(), elapsed_ms, interval_ms, preview);
            emit_stream_diagnostics(&app, &rid, serde_json::json!({
                "url": url,
                "model": mdl,
                "streamRequested": true,
                "status": status_code,
                "contentType": content_type,
                "transferEncoding": transfer_encoding,
                "contentEncoding": content_encoding,
                "connection": connection_header,
                "isSse": true,
                "fallbackToNonStreamJson": false,
                "firstByteMs": first_byte_ms,
                "bytesChunkCount": bytes_chunk_count,
                "lastBytesChunkLength": bytes.len(),
                "lastBytesIntervalMs": interval_ms,
                "sseEventCount": sse_event_count,
                "dataLineCount": data_line_count,
                "chunkCount": chunk_count,
                "contentChunkCount": content_chunk_count,
                "reasoningChunkCount": reasoning_chunk_count,
                "toolEventCount": tool_event_count,
                "emptyDeltaCount": empty_delta_count,
                "parseErrorCount": parse_error_count,
                "receivedDone": has_done,
                "streamReadError": false,
                "partial": false
            }));

            line_buffer.push_str(&chunk_text);
            while let Some(newline_idx) = line_buffer.find('\n') {
                let mut line = line_buffer[..newline_idx].to_string();
                if line.ends_with('\r') {
                    line.pop();
                }
                line_buffer = line_buffer[newline_idx + 1..].to_string();
                if line.starts_with("data:") {
                    data_line_count += 1;
                }
                let Some(completed) = parse_sse_line(&line, &mut current_event) else { continue; };
                sse_event_count += 1;
                if completed.data == "[DONE]" {
                    has_done = true;
                    println!("[stream-debug] sse done requestId={} elapsedMs={}", rid, started.elapsed().as_millis());
                    continue;
                }

                if completed.event == "hermes.tool.progress" {
                    tool_event_count += 1;
                    let emit_result = app.emit("hermes-tool-progress", serde_json::json!({
                        "requestId": rid,
                        "event": completed.event,
                        "data": completed.data
                    }));
                    println!("[stream-debug] emit eventName=hermes-tool-progress requestId={} type=tool contentLength={} ok={} elapsedMs={}", rid, completed.data.len(), emit_result.is_ok(), started.elapsed().as_millis());
                    continue;
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&completed.data) {
                    let delta_opt = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta"));
                    let fr = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("finish_reason")).and_then(|v| v.as_str()).map(|s| s.to_string());
                    if fr.is_some() { finish_reason = fr; }
                    if let Some(delta) = delta_opt {
                        let content = delta.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let reasoning = delta.get("reasoning_content").and_then(|v| v.as_str()).unwrap_or("");
                        if content.is_empty() && reasoning.is_empty() {
                            empty_delta_count += 1;
                        }
                        if !content.is_empty() {
                            chunk_count += 1;
                            content_chunk_count += 1;
                            if first_content_ms.is_none() {
                                first_content_ms = Some(started.elapsed().as_millis() as u64);
                            }
                            last_content_ms = started.elapsed().as_millis() as u64;
                            content_accumulated.push_str(content);
                            let emit_result = app.emit("hermes-chat-chunk", serde_json::json!({
                                "requestId": rid, "content": content, "type": "content"
                            }));
                            println!("[stream-debug] emit eventName=hermes-chat-chunk requestId={} type=content contentLength={} ok={} elapsedMs={}", rid, content.len(), emit_result.is_ok(), started.elapsed().as_millis());
                        }
                        if !reasoning.is_empty() {
                            chunk_count += 1;
                            reasoning_chunk_count += 1;
                            reasoning_accumulated.push_str(reasoning);
                            let emit_result = app.emit("hermes-chat-chunk", serde_json::json!({
                                "requestId": rid, "content": reasoning, "reasoningContent": reasoning, "type": "reasoning"
                            }));
                            println!("[stream-debug] emit eventName=hermes-chat-chunk requestId={} type=reasoning contentLength={} ok={} elapsedMs={}", rid, reasoning.len(), emit_result.is_ok(), started.elapsed().as_millis());
                        }
                    }
                    if let Some(obj) = json.get("usage") {
                        usage_info = Some(obj.clone());
                    }
                } else {
                    parse_error_count += 1;
                    println!("[stream-debug] sse parseError requestId={} event={} dataPreview={}", rid, completed.event, preview_text(&completed.data));
                }
            }
        }

        let elapsed_ms = started.elapsed().as_millis() as u64;
        let diagnostics = serde_json::json!({
            "contentType": content_type,
            "transferEncoding": transfer_encoding,
            "contentEncoding": content_encoding,
            "connection": connection_header,
            "isSse": true,
            "fallbackToNonStreamJson": false,
            "firstByteMs": first_byte_ms,
            "firstContentMs": first_content_ms,
            "lastContentMs": last_content_ms,
            "bytesChunkCount": bytes_chunk_count,
            "sseEventCount": sse_event_count,
            "dataLineCount": data_line_count,
            "chunkCount": chunk_count,
            "contentChunkCount": content_chunk_count,
            "reasoningChunkCount": reasoning_chunk_count,
            "toolEventCount": tool_event_count,
            "emptyDeltaCount": empty_delta_count,
            "parseErrorCount": parse_error_count,
            "receivedDone": has_done,
            "finishReason": finish_reason,
            "afterLastContentToDoneMs": if last_content_ms > 0 { Some(elapsed_ms - last_content_ms) } else { None },
            "streamReadError": false,
            "partial": false
        });
        let emit_done_result = app.emit("hermes-chat-done", serde_json::json!({
            "requestId": rid,
            "content": content_accumulated,
            "reasoningContent": reasoning_accumulated,
            "model": mdl,
            "rawUsage": usage_info,
            "sessionId": session_id,
            "elapsedMs": elapsed_ms,
            "diagnostics": diagnostics
        }));
        println!("[stream-debug] emit eventName=hermes-chat-done requestId={} finalContentLength={} finalReasoningLength={} ok={} diagnostics={}", rid, content_accumulated.len(), reasoning_accumulated.len(), emit_done_result.is_ok(), diagnostics);
        cancel_map().lock().unwrap().remove(&rid);
        task_map().lock().unwrap().remove(&rid);
    });
    task_map().lock().unwrap().insert(rid_for_handle, handle);

    Ok(serde_json::json!({
        "success": true,
        "accepted": true,
        "requestId": request_id
    }))
}

#[tauri::command]
fn cancel_hermes_chat_completion(request_id: String) -> Result<serde_json::Value, String> {
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
fn read_hermes_model_config() -> Result<serde_json::Value, String> {
    let updated_at = checked_at();
    let display_path = "~/.hermes/config.yaml";
    let Some(home) = home_dir() else {
        return Ok(serde_json::json!({
            "exists": false,
            "configPath": display_path,
            "model": null,
            "provider": null,
            "baseUrl": null,
            "updatedAt": updated_at,
            "error": "无法定位用户主目录"
        }));
    };

    let config_path = home.join(".hermes").join("config.yaml");

    if !config_path.exists() {
        return Ok(serde_json::json!({
            "exists": false,
            "configPath": display_path,
            "model": null,
            "provider": null,
            "baseUrl": null,
            "updatedAt": updated_at,
            "error": "配置文件不存在"
        }));
    }

    let content = match fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(error) => {
            return Ok(serde_json::json!({
                "exists": false,
                "configPath": display_path,
                "model": null,
                "provider": null,
                "baseUrl": null,
                "updatedAt": updated_at,
                "error": error.to_string()
            }))
        }
    };

    let mut model: Option<String> = None;
    let mut provider: Option<String> = None;
    let mut base_url: Option<String> = None;
    let mut reasoning_effort: Option<String> = None;
    let mut path_stack: Vec<(usize, String)> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        let indent = line.len().saturating_sub(trimmed.len());
        while path_stack.last().map(|(level, _)| *level >= indent).unwrap_or(false) {
            path_stack.pop();
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            let raw_key = key.trim().trim_start_matches('-').trim().to_lowercase();
            if raw_key.is_empty() {
                continue;
            }

            let mut full_parts = path_stack.iter().map(|(_, part)| part.clone()).collect::<Vec<String>>();
            full_parts.push(raw_key.clone());
            let full_key = full_parts.join(".");

            if is_sensitive_key(&raw_key) || is_sensitive_key(&full_key) {
                if value.trim().is_empty() {
                    path_stack.push((indent, raw_key));
                }
                continue;
            }

            let value = clean_yaml_scalar(value);
            if value.is_empty() {
                path_stack.push((indent, raw_key));
                continue;
            }

            if full_key == "model.default"
                || full_key == "model.model"
                || raw_key == "model.default"
                || raw_key == "model.model"
                || (raw_key == "model" && model.is_none())
            {
                model = Some(value.clone());
            }

            if full_key == "model.provider"
                || raw_key == "model.provider"
                || (raw_key == "provider" && provider.is_none())
            {
                provider = Some(value.clone());
            }

            if full_key == "model.base_url"
                || full_key == "model.baseurl"
                || raw_key == "model.base_url"
                || raw_key == "model.baseurl"
                || ((raw_key == "base_url" || raw_key == "baseurl") && base_url.is_none())
                || (full_key.contains("custom_providers") && (raw_key == "base_url" || raw_key == "baseurl") && base_url.is_none())
            {
                base_url = Some(value.clone());
            }

            if full_key == "agent.reasoning_effort"
                || raw_key == "agent.reasoning_effort"
                || (raw_key == "reasoning_effort" && reasoning_effort.is_none())
            {
                reasoning_effort = Some(value.clone());
            }
        }
    }

    Ok(serde_json::json!({
        "exists": true,
        "configPath": display_path,
        "model": model,
        "provider": provider,
        "baseUrl": base_url,
        "reasoningEffort": reasoning_effort,
        "updatedAt": updated_at,
        "error": null
    }))
}

#[tauri::command]
fn read_hermes_native_memory() -> Result<serde_json::Value, String> {
    let Some(home) = home_dir() else {
        return Ok(serde_json::json!({
            "homeDir": "~/.hermes",
            "found": false,
            "files": [],
            "checkedAt": checked_at(),
            "error": "无法定位用户主目录"
        }));
    };
    let hermes_root = home.join(".hermes");
    if !hermes_root.exists() || !hermes_root.is_dir() {
        return Ok(serde_json::json!({
            "homeDir": "~/.hermes",
            "found": false,
            "files": [],
            "checkedAt": checked_at(),
            "error": null
        }));
    }

    let mut files: Vec<serde_json::Value> = Vec::new();
    for rel in [
        "MEMORY.md",
        "USER.md",
        "SOUL.md",
        "memory/MEMORY.md",
        "memory/USER.md",
        "memory/SOUL.md",
        "memories/MEMORY.md",
        "memories/USER.md",
        "memories/SOUL.md",
    ] {
        collect_memory_file(&mut files, &hermes_root, hermes_root.join(rel));
    }

    let users_dir = hermes_root.join("memories").join("users");
    if users_dir.exists() && users_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&users_dir) {
            for entry in entries.flatten() {
                let user_dir = entry.path();
                if user_dir.is_dir() {
                    collect_memory_file(&mut files, &hermes_root, user_dir.join("USER.md"));
                }
            }
        }
    }

    files.sort_by(|a, b| {
        let ar = a.get("relativePath").and_then(|v| v.as_str()).unwrap_or_default();
        let br = b.get("relativePath").and_then(|v| v.as_str()).unwrap_or_default();
        ar.cmp(br)
    });

    Ok(serde_json::json!({
        "homeDir": "~/.hermes",
        "found": true,
        "files": files,
        "checkedAt": checked_at(),
        "error": null
    }))
}

fn sanitize_token_error(error: &str, token: &str) -> String {
    if token.is_empty() { return error.to_string(); }
    error.replace(token, "[REDACTED]")
}

#[tauri::command]
fn apply_hermes_model_config(token: String, model: String) -> Result<serde_json::Value, String> {
    // 1. Whitelist validation
    let provider = match model.as_str() {
        "deepseek-v4-flash" => "deepseek",
        "deepseek-v4-pro" => "deepseek",
        "kimi-k2.6" => "kimi-coding",
        _ => return Err(format!("模型 {} 不在白名单内", model)),
    };

    if token.trim().is_empty() {
        return Err("Token 不能为空".to_string());
    }

    let base_url = "https://ai.f1class.icu/v1";

    // 2. Locate hermes binary (must be validated executable)
    let hermes_bin = which_hermes();
    if hermes_bin.is_none() {
        return Err("未找到可执行的 Hermes 程序，请确认 Hermes 已安装并可在终端执行 hermes。".to_string());
    }
    let hermes_bin = hermes_bin.unwrap();

    // 3. Backup existing files
    let Some(home) = home_dir() else {
        return Err("无法定位用户主目录".to_string());
    };
    let hermes_dir = home.join(".hermes");
    let timestamp = chrono_timestamp();
    let mut backup_paths: Vec<String> = Vec::new();

    let config_path = hermes_dir.join("config.yaml");
    if config_path.exists() {
        let bak = hermes_dir.join(format!("config.yaml.bak-{}", timestamp));
        if let Err(e) = fs::copy(&config_path, &bak) {
            return Err(format!("备份 config.yaml 失败：{}", e));
        }
        backup_paths.push(bak.display().to_string());
    }

    let env_path = hermes_dir.join(".env");
    if env_path.exists() {
        let bak = hermes_dir.join(format!(".env.bak-{}", timestamp));
        if let Err(e) = fs::copy(&env_path, &bak) {
            return Err(format!("备份 .env 失败：{}", e));
        }
        backup_paths.push(bak.display().to_string());
    }

    // 4. Execute hermes config set commands (no token in logs)
    let config_commands: Vec<(&str, &str)> = vec![
        ("model.provider", provider),
        ("model.default", &model),
        ("model.base_url", base_url),
        ("model.api_mode", "chat_completions"),
    ];

    for (key, value) in &config_commands {
        let output = std::process::Command::new(&hermes_bin)
            .args(["config", "set", key, value])
            .output();
        match output {
            Ok(o) if !o.status.success() => {
                let stderr = sanitize_token_error(&String::from_utf8_lossy(&o.stderr), &token);
                return Err(format!("hermes config set {} 失败：{}", key, stderr.trim()));
            }
            Err(e) => {
                return Err(format!("执行 hermes config set {} 失败：{}", key, e));
            }
            _ => {}
        }
    }

    // 5. Write token to .env directly (NOT via CLI args to avoid ps visibility)
    let token_keys = ["DEEPSEEK_API_KEY", "KIMI_API_KEY"];
    let env_path = hermes_dir.join(".env");
    let mut env_content = if env_path.exists() {
        fs::read_to_string(&env_path).unwrap_or_default()
    } else {
        String::new()
    };
    for key in &token_keys {
        let key_eq = format!("{}=", key);
        if let Some(line_start) = env_content.lines().position(|l| l.trim_start().starts_with(&key_eq)) {
            // Replace existing line
            let lines: Vec<&str> = env_content.lines().collect();
            let updated: Vec<String> = lines.iter().enumerate().map(|(i, l)| {
                if i == line_start {
                    let comment = if l.contains('#') { l.split('#').nth(1).unwrap_or("").trim() } else { "" };
                    if comment.is_empty() { format!("{}={}", key, token) }
                    else { format!("{}={} # {}", key, token, comment) }
                } else { l.to_string() }
            }).collect();
            env_content = updated.join("\n") + "\n";
        } else {
            // Append new line
            if !env_content.ends_with('\n') { env_content.push('\n'); }
            env_content.push_str(&format!("{}={}\n", key, token));
        }
    }
    // Write .env with restricted permissions (0600 on Unix)
    {
        let mut file = std::fs::File::create(&env_path).map_err(|e| sanitize_token_error(&format!("写入 .env 失败：{}", e), &token))?;
        file.write_all(env_content.as_bytes()).map_err(|e| sanitize_token_error(&format!("写入 .env 失败：{}", e), &token))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
        }
    }

    // 6. Verify by re-reading config
    let verify = read_hermes_model_config();
    let verified = match verify {
        Ok(v) => v,
        Err(_) => serde_json::json!(null),
    };

    Ok(serde_json::json!({
        "success": true,
        "appliedModel": model,
        "appliedProvider": provider,
        "baseUrl": base_url,
        "apiMode": "chat_completions",
        "backupPaths": backup_paths,
        "verifiedConfig": verified
    }))
}

#[tauri::command]
async fn apply_hermes_reasoning_config(effort: String) -> Result<serde_json::Value, String> {
    let valid = ["none", "minimal", "low", "medium", "high", "xhigh"];
    if !valid.contains(&effort.as_str()) {
        return Err(format!("无效的 reasoning_effort 值：{}", effort));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let hermes_bin = which_hermes();
        if hermes_bin.is_none() {
            return Err("未找到可执行的 Hermes 程序".to_string());
        }
        let bin = hermes_bin.unwrap();
        let Some(home) = home_dir() else {
            return Err("无法定位用户主目录".to_string());
        };
        let config_path = home.join(".hermes").join("config.yaml");
        if config_path.exists() {
            let bak = home.join(".hermes").join(format!("config.yaml.bak-reasoning-{}", chrono_timestamp()));
            let _ = fs::copy(&config_path, &bak);
        }
        let output = std::process::Command::new(&bin)
            .args(["config", "set", "agent.reasoning_effort", &effort])
            .output();
        match output {
            Ok(o) if !o.status.success() => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                return Err(format!("hermes config set agent.reasoning_effort 失败：{}", stderr.trim()));
            }
            Err(e) => return Err(format!("执行失败：{}", e)),
            _ => {}
        }
        let verify = read_hermes_model_config();
        let verified = match verify {
            Ok(v) => v,
            Err(_) => serde_json::json!(null),
        };
        Ok(serde_json::json!({
            "success": true,
            "appliedEffort": effort,
            "verifiedConfig": verified
        }))
    }).await.map_err(|e| e.to_string())?
}

fn which_hermes() -> Option<String> {
    // 1. Try PATH via `which hermes` (highest priority)
    if let Ok(output) = std::process::Command::new("which").arg("hermes").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && is_executable_hermes(&path) {
                return Some(path);
            }
        }
    }
    // 2. Try common user/system locations
    let home_str = home_dir().map(|h| h.display().to_string()).unwrap_or_default();
    let candidates: Vec<String> = vec![
        format!("{}/.local/bin/hermes", home_str),
        format!("{}/.cargo/bin/hermes", home_str),
        "/opt/homebrew/bin/hermes".to_string(),
        "/usr/local/bin/hermes".to_string(),
        format!("{}/.hermes/hermes-agent", home_str), // last resort, often a directory
    ];
    for c in &candidates {
        if is_executable_hermes(c) {
            return Some(c.clone());
        }
    }
    None
}

/// Validates that a path is a real executable hermes CLI (not a directory).
fn is_executable_hermes(path: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let p = std::path::Path::new(path);
    // Must exist and be a file (not directory)
    let meta = match p.metadata() {
        Ok(m) => m,
        Err(_) => return false,
    };
    if !meta.is_file() {
        return false;
    }
    // Must have execute permission
    if meta.permissions().mode() & 0o111 == 0 {
        return false;
    }
    // Must successfully run --version
    match std::process::Command::new(path).arg("--version").output() {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

fn chrono_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", secs)
}

#[tauri::command]
async fn read_hermes_cron_overview() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(home) = home_dir() else {
            return Ok(serde_json::json!({"cronDirExists": false, "outputDirExists": false, "outputFileCount": 0, "hermesAvailable": false, "checkedAt": checked_at()}));
        };
        let cron_dir = home.join(".hermes").join("cron");
        let output_dir = cron_dir.join("output");
        let cron_dir_exists = cron_dir.exists() && cron_dir.is_dir();
        let output_dir_exists = output_dir.exists() && output_dir.is_dir();
        let mut output_file_count = 0u64;
        if output_dir_exists {
            if let Ok(entries) = std::fs::read_dir(&output_dir) {
                output_file_count = entries.flatten().filter(|e| e.path().is_file()).count() as u64;
            }
        }
        let hermes_bin = which_hermes();
        Ok(serde_json::json!({
            "cronDirExists": cron_dir_exists,
            "outputDirExists": output_dir_exists,
            "outputFileCount": output_file_count,
            "hermesAvailable": hermes_bin.is_some(),
            "checkedAt": checked_at()
        }))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_hermes_cron_cli_status() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hermes_bin = which_hermes();
        if hermes_bin.is_none() {
            return Ok(serde_json::json!({"schedulerRunning": false, "schedulerStatus": "未找到可执行 Hermes", "jobs": [], "hermesAvailable": false}));
        }
        let bin = hermes_bin.unwrap();

        let mut scheduler_running = false;
        let mut status_text = String::new();
        let child = std::process::Command::new(&bin).args(["cron", "status"]).stdout(Stdio::piped()).stderr(Stdio::null()).spawn();
        if let Ok(mut child) = child {
            let started = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if status.success() {
                            if let Ok(output) = child.wait_with_output() {
                                status_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                                scheduler_running = status_text.contains("running");
                            }
                        }
                        break;
                    }
                    Ok(None) => {
                        if started.elapsed() > Duration::from_secs(2) { let _ = child.kill(); break; }
                        std::thread::sleep(Duration::from_millis(30));
                    }
                    Err(_) => break,
                }
            }
        }

        let mut jobs: Vec<serde_json::Value> = Vec::new();
        let child = std::process::Command::new(&bin).args(["cron", "list"]).stdout(Stdio::piped()).stderr(Stdio::null()).spawn();
        if let Ok(mut child) = child {
            let started = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if status.success() {
                            if let Ok(output) = child.wait_with_output() {
                                let raw = String::from_utf8_lossy(&output.stdout);
                                for line in raw.lines() {
                                    let trimmed = line.trim();
                                    if trimmed.is_empty() || trimmed.starts_with("No scheduled") || trimmed.contains("Create one") { continue; }
                                    jobs.push(serde_json::json!({"raw": trimmed}));
                                }
                            }
                        }
                        break;
                    }
                    Ok(None) => {
                        if started.elapsed() > Duration::from_secs(2) { let _ = child.kill(); break; }
                        std::thread::sleep(Duration::from_millis(30));
                    }
                    Err(_) => break,
                }
            }
        }

    Ok(serde_json::json!({
        "schedulerRunning": scheduler_running,
        "schedulerStatus": status_text,
        "jobs": jobs,
        "hermesAvailable": true
    }))
    }).await.map_err(|e| e.to_string())?
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
        results.push(serde_json::json!({
            "name": name,
            "path": dest.display().to_string(),
            "size": meta.len()
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_config, write_config, clear_config, read_chat_sessions, write_chat_sessions, clear_chat_sessions, check_hermes_installed, get_hermes_version, get_hermes_paths, get_hermes_help, check_hermes_api_server, hermes_chat_completion, cancel_hermes_chat_completion, read_hermes_model_config, read_hermes_native_memory, apply_hermes_model_config, apply_hermes_reasoning_config, read_hermes_cron_overview, read_hermes_cron_cli_status, ensure_ai_files_dirs, list_ai_files, delete_ai_file, open_ai_file_location, pick_and_upload_file, extract_ai_file_text, save_generated_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
