# AGENT_BOARD

## Project Guardrails

- Role: planning / review agent only.
- This file is the single coordination surface for OpenCode tasks, execution feedback, and review notes.
- Do not restore OpenClaw, fallback mode, lightweight mode, remote Hermes, video generation, OCR, or complex Python/BI spreadsheet analysis.
- Keep the product Hermes-only.
- Keep the customer model supply Token model. Do not output, log, display, or expose Tokens.
- Keep Base URL fixed. Do not add user-editable Base URL, provider, or API URL fields in ordinary UI.
- Do not read or display `.env` contents.
- Do not save full attachment text into `chat-sessions.json`.
- RC phase rule: prefer minimal compatibility fixes over broad refactors.

## Current Task: Fix Windows Rust Compile Error

### Background

On a Parallels Desktop Windows 11 ARM64 VM, running the Rust check from the Tauri backend fails:

```powershell
cd C:\dev\ai-agent-u-ai-1-new\src-tauri
cargo check
```

This project must remain buildable on Windows and macOS for RC packaging. The current local worktree already contains modified `src-tauri/src/main.rs`; do not discard or overwrite existing user changes.

### Goal

Make `cargo check` pass on Windows for the Tauri Rust backend with the smallest safe code change.

### Modification Scope

- Allowed:
  - `src-tauri/src/main.rs`
  - Only if required by the compiler error: `src-tauri/Cargo.toml`
- Prefer platform-gated Rust fixes using `#[cfg(windows)]`, `#[cfg(unix)]`, or cross-platform standard library alternatives.
- Keep changes narrowly focused on Windows compilation.

### Forbidden

- Do not modify React frontend files under `src/`.
- Do not modify product configuration, Base URL behavior, model whitelist, provider mapping, Token behavior, or Hermes-only assumptions.
- Do not add new runtime features.
- Do not introduce remote Hermes support.
- Do not read, print, or expose `.env` contents or Tokens.
- Do not remove existing safety checks around file paths, generated files, memory redaction, or attachment storage.
- Do not rewrite large sections of `main.rs` just to clean up style.

### Acceptance Criteria

- `cargo check` passes from `src-tauri` on Windows.
- Existing macOS/Linux-specific behavior remains guarded and does not break non-Windows builds.
- Any Windows-specific replacement behavior is equivalent enough for RC use, especially for:
  - locating Hermes CLI
  - opening file locations
  - writing Hermes config / `.env`
  - reading local app data and AI files
- No Token, Base URL, provider, or API URL is newly exposed in ordinary user UI.
- Execution feedback is appended below, including:
  - exact compiler error before the fix
  - files changed
  - summary of the fix
  - validation command output summary

### Required Validation Commands

Run these from `src-tauri`:

```powershell
cargo check
```

If a macOS environment is also available, run:

```bash
cargo check
```

If frontend files were not touched, do not run broad frontend validation unless needed.

### OpenCode Execution Feedback

Pending.

### Review Notes

Pending OpenCode feedback.
