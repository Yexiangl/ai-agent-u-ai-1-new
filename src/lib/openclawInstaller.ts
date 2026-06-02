import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// TASK-066: One-click openclaw (本地服务) installer client.
// Drives the official openclaw install script via Rust and streams its log
// output so the UI can show install progress live.

export interface OpenClawInstallStatus {
  installed: boolean;
  version: string;
}

// Check whether the openclaw CLI is installed and on PATH.
export async function checkOpenClawInstalled(): Promise<OpenClawInstallStatus> {
  return invoke<OpenClawInstallStatus>("check_openclaw_installed");
}

// Kick off the official installer. Returns immediately; progress arrives via
// onInstallLog() and completion via onInstallDone(). Subscribe to both BEFORE
// calling this.
export async function installOpenClaw(): Promise<void> {
  await invoke("install_openclaw");
}

// Stream one install log line at a time. Remember to call the returned unlisten.
export function onInstallLog(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<{ line: string }>("openclaw-install-log", (e) => cb(e.payload.line));
}

// Fires once when the installer process exits. success=false means it failed.
export function onInstallDone(cb: (success: boolean) => void): Promise<UnlistenFn> {
  return listen<{ success: boolean }>("openclaw-install-done", (e) => cb(e.payload.success));
}
