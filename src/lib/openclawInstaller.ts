import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// TASK-066: One-click openclaw (本地服务) installer client.
// Drives the official openclaw install script via Rust and streams its log
// output. State lives in a module-level store so it survives React component
// unmounts (e.g. navigating away from the AI 助手 page mid-install).

export interface OpenClawInstallStatus {
  installed: boolean;
  version: string;
  onPath?: boolean;
}

export type InstallPhase = "idle" | "installing" | "done" | "failed" | "uninstalling" | "uninstalled";

interface InstallState {
  phase: InstallPhase;
  logs: string[];
}

const state: InstallState = { phase: "idle", logs: [] };
const subscribers = new Set<() => void>();
let listenersWired = false;

function emit() {
  for (const fn of subscribers) fn();
}

function pushLog(line: string) {
  // Cap retained lines so a chatty installer can't grow memory unbounded.
  state.logs = [...state.logs.slice(-400), line];
  emit();
}

// Wire the Tauri event listeners exactly once for the whole app session.
async function ensureListeners() {
  if (listenersWired) return;
  listenersWired = true;
  await listen<{ line: string }>("openclaw-install-log", (e) => pushLog(e.payload.line));
  await listen<{ success: boolean }>("openclaw-install-done", (e) => {
    state.phase = e.payload.success ? "done" : "failed";
    emit();
  });
  // Uninstall reuses the same log event but has its own done event.
  await listen<{ success: boolean }>("openclaw-uninstall-done", (e) => {
    state.phase = e.payload.success ? "uninstalled" : "failed";
    emit();
  });
}

// Subscribe a React component to store changes. Returns an unsubscribe fn.
export function subscribeInstall(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

export function getInstallState(): InstallState {
  return state;
}

// Check whether the openclaw CLI is installed and on PATH.
export async function checkOpenClawInstalled(): Promise<OpenClawInstallStatus> {
  return invoke<OpenClawInstallStatus>("check_openclaw_installed");
}

// Kick off the official installer. Logs/phase flow into the store; subscribe
// via subscribeInstall() to render them. Safe to call only when not already
// installing.
export async function startInstall(): Promise<void> {
  if (state.phase === "installing") return;
  await ensureListeners();
  state.phase = "installing";
  state.logs = [];
  emit();
  try {
    await invoke("install_openclaw");
  } catch (err) {
    state.phase = "failed";
    pushLog(typeof err === "string" ? err : "安装启动失败");
  }
}

// Kick off uninstall. Removes the openclaw CLI program only; user data in
// ~/.openclaw is intentionally preserved. Logs/phase flow into the same store.
export async function startUninstall(): Promise<void> {
  if (state.phase === "uninstalling" || state.phase === "installing") return;
  await ensureListeners();
  state.phase = "uninstalling";
  state.logs = [];
  emit();
  try {
    await invoke("uninstall_openclaw");
  } catch (err) {
    state.phase = "failed";
    pushLog(typeof err === "string" ? err : "卸载启动失败");
  }
}

// Reset the store back to idle (e.g. after the user dismisses a result panel).
export function resetInstallState(): void {
  state.phase = "idle";
  state.logs = [];
  emit();
}
