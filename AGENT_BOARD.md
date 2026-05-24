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

## Compatibility Review: macOS + Windows RC Sweep

### Scope

Review-only pass. No business code was modified. `.env` was not read, and no Token was printed.

### Findings

1. Windows Hermes lookup is inconsistent across Rust paths.
   - `hermes_binary_path()` correctly uses `where hermes` on Windows and `which hermes` elsewhere.
   - `which_hermes()` still unconditionally calls `which hermes`, then checks Unix-oriented candidates such as `~/.local/bin/hermes`, `~/.cargo/bin/hermes`, `/opt/homebrew/bin/hermes`, and `/usr/local/bin/hermes`.
   - Impact: Windows status detection may say Hermes is installed, while applying Hermes model config, reasoning config, and Cron status may still fail because those paths call `which_hermes()`.
   - Location: `src-tauri/src/main.rs` around `hermes_binary_path()` and `which_hermes()`.

2. `std::os::unix::fs::PermissionsExt` usage now appears cfg-guarded.
   - `.env` permission hardening is inside `#[cfg(unix)]`.
   - executable mode checks are inside the Unix implementation of `has_executable_permission()`.
   - No unguarded `std::os::unix` import was found in the scanned Rust code.
   - This should not block Windows compilation.

3. Windows `.env` permission behavior is compile-safe but not equivalent to Unix `0600`.
   - On Windows, the current code writes `.env` without an ACL equivalent.
   - This is not a compile blocker and should be treated as a security hardening follow-up unless RC requires Windows ACL tightening now.
   - Do not read or display `.env` contents while fixing.

4. AI file library paths are mostly cross-platform, but `safe_resolve()` has a Windows edge-case risk for absolute input.
   - Most app-generated paths are absolute strings returned from Rust itself.
   - `safe_resolve(ai_root, path)` does `ai_root.join(path)`, then canonicalizes and checks `starts_with(root)`.
   - For existing files this is likely safe because canonicalization catches outside-root paths.
   - For non-existing paths, lexical `starts_with(root)` may be less robust with Windows path prefixes, drive-letter casing, `..`, or verbatim path forms. Current callers mostly use existing files, so this is not an immediate packaging blocker.

5. `delete_ai_file` remains protected by root canonicalization and `is_file()`.
   - Existing-file deletion goes through `safe_resolve()` and refuses non-files.
   - No obvious cross-platform delete escape was confirmed in this review.

6. `save_generated_file` is cross-platform enough for RC.
   - It strips path components with `Path::file_name()`, filters dangerous filename characters, whitelists output extensions, canonicalizes the generated directory, and checks destination parent containment.
   - No Windows-specific blocker found.

7. Opening file locations is platform-gated.
   - macOS uses `open`.
   - Windows uses `explorer`.
   - Linux uses `xdg-open`.
   - This is compile-safe. Windows runtime should still be manually checked because Explorer argument behavior can vary with unusual paths, but folder paths from app data should be fine.

8. App data and AI file directories use Tauri `app_data_dir()`.
   - This is the correct cross-platform API for macOS and Windows.
   - `ensure_ai_files_dirs()` creates `uploads`, `generated`, `videos`, `exports`, and `temp`.
   - No platform-specific hardcoded app-data path was found.

9. Frontend path display risk is low.
   - AI 文件库 table displays file names, not full paths, and truncates long names.
   - Memory path detail uses `break-all`.
   - Copy path uses clipboard but does not display the full Windows path in the main table.
   - No immediate Windows long-path UI blocker found.

10. Packaging target caveat remains important.
    - `npm run tauri:build:windows` targets `x86_64-pc-windows-msvc`.
    - A Windows 11 ARM64 Parallels VM may validate Windows compatibility, but it is not the same as producing and validating a normal customer x64 Windows package unless the x64 MSVC target/toolchain is installed and the artifact is tested on x64 Windows.

### Does This Block Windows Packaging?

Yes, one issue should block RC Windows packaging until fixed:

- `which_hermes()` should be made Windows-aware because key runtime operations depend on it, even if compile succeeds.

The previous `PermissionsExt` compile issue appears resolved and does not currently block based on this scan.

### Must Fix

Create one small OpenCode task:

- Make `which_hermes()` platform-aware.
- On Windows, use `where hermes` or `where hermes.exe`, validate each returned path with `is_executable_hermes()`, and include reasonable Windows user candidates only if needed.
- On Unix/macOS/Linux, preserve existing `which hermes` and common path behavior.
- Keep `is_executable_hermes()` and `has_executable_permission()` cfg-gated.
- Do not alter Hermes-only behavior, model whitelist, provider mapping, Base URL, Token handling, or UI exposure rules.

### Can Be Deferred

- Windows ACL equivalent for `.env` file permissions.
- More defensive `safe_resolve()` normalization for non-existing Windows paths.
- Manual Explorer behavior QA with unusual path names.
- Long Windows path visual QA with very long filenames.
- Full x64 Windows packaging pipeline on GitHub Actions or a real x64 Windows machine.

### Windows Packaging Test Commands

From the project root on Windows:

```powershell
npm install
cd src-tauri
cargo check
cd ..
npm run build
npm run tauri:build:windows
```

On Windows ARM64 Parallels:

```powershell
rustup target add x86_64-pc-windows-msvc
npm run tauri:build:windows
```

If x64 target/toolchain is unavailable in the ARM64 VM, use the VM for compatibility checks and produce the RC customer package on a GitHub Actions Windows x64 runner or a real x64 Windows machine.

### macOS Regression Test Commands

From the project root on macOS:

```bash
cd src-tauri
cargo check
cd ..
npm run build
npm run tauri:build:mac
```

### Validation Performed In This Review

```bash
cd src-tauri
cargo check
```

Result: passed on macOS.
