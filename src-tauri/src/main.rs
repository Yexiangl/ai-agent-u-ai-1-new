use std::fs;
use std::error::Error;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use futures_util::StreamExt;
use tauri::{Emitter, Manager};

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

    tauri::async_runtime::spawn(async move {
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
        let mut last_byte_at = started;
        let mut line_buffer = String::new();
        let mut current_event = SseEvent { event: "message".to_string(), data: String::new() };
        let mut stream = response.bytes_stream();

        while let Some(item) = stream.next().await {
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
                    if let Some(delta) = delta_opt {
                        let content = delta.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let reasoning = delta.get("reasoning_content").and_then(|v| v.as_str()).unwrap_or("");
                        if content.is_empty() && reasoning.is_empty() {
                            empty_delta_count += 1;
                        }
                        if !content.is_empty() {
                            chunk_count += 1;
                            content_chunk_count += 1;
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
    });

    Ok(serde_json::json!({
        "success": true,
        "accepted": true,
        "requestId": request_id
    }))
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
        }
    }

    Ok(serde_json::json!({
        "exists": true,
        "configPath": display_path,
        "model": model,
        "provider": provider,
        "baseUrl": base_url,
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

    // 2. Locate hermes binary
    let hermes_bin = which_hermes();
    if hermes_bin.is_none() {
        return Err("未找到 hermes 程序，无法写入配置".to_string());
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
                let stderr = String::from_utf8_lossy(&o.stderr);
                return Err(format!("hermes config set {} 失败：{}", key, stderr.trim()));
            }
            Err(e) => {
                return Err(format!("执行 hermes config set {} 失败：{}", key, e));
            }
            _ => {}
        }
    }

    // 5. Write token to both provider keys (no logging of token value)
    let token_keys = ["DEEPSEEK_API_KEY", "KIMI_API_KEY"];
    for key in &token_keys {
        let output = std::process::Command::new(&hermes_bin)
            .args(["config", "set", key, &token])
            .output();
        match output {
            Ok(o) if !o.status.success() => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                return Err(format!("hermes config set {} 失败：{}", key, stderr.trim()));
            }
            Err(e) => {
                return Err(format!("执行 hermes config set {} 失败：{}", key, e));
            }
            _ => {}
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

fn which_hermes() -> Option<String> {
    // Try ~/.hermes/hermes-agent (official install location)
    if let Some(home) = home_dir() {
        let local_bin = home.join(".hermes").join("hermes-agent");
        if local_bin.exists() {
            return Some(local_bin.display().to_string());
        }
    }
    // Try common system locations
    let candidates = [
        "/usr/local/bin/hermes",
        "/opt/homebrew/bin/hermes",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    // Try PATH via which
    if let Ok(output) = std::process::Command::new("which").arg("hermes").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

fn chrono_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", secs)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_config, write_config, clear_config, read_chat_sessions, write_chat_sessions, clear_chat_sessions, check_hermes_installed, get_hermes_version, get_hermes_paths, get_hermes_help, check_hermes_api_server, hermes_chat_completion, read_hermes_model_config, read_hermes_native_memory, apply_hermes_model_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
