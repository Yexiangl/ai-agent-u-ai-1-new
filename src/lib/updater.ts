import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// TASK-065: Online update client for the portable U-disk build.
// Talks to Rust commands that query GitHub Releases, stream the installer to the
// update dir, and hand off to the installer. No code or data leaves the machine
// except the read-only GitHub API/release download.

export interface UpdateInfo {
  // True only when a newer version AND a matching installer for this OS exist.
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseNotes: string | null;
  // Set when a newer version exists but no installer matched this OS, etc.
  error: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  // -1 when total size is unknown (indeterminate).
  pct: number;
}

// Query GitHub for the latest release and compare against the running version.
export async function checkUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_update");
}

// Stream the installer to disk. Returns the local installer path on success.
// Subscribe with onDownloadProgress() before calling to drive a progress bar.
export async function downloadUpdate(url: string, version: string): Promise<string> {
  return invoke<string>("download_update", { url, version });
}

// Launch the downloaded installer and quit the app so it can replace files.
export async function applyUpdate(installerPath: string): Promise<void> {
  await invoke("apply_update", { installerPath });
}

// Listen for streaming download progress. Remember to call the returned unlisten.
export function onDownloadProgress(cb: (p: DownloadProgress) => void): Promise<UnlistenFn> {
  return listen<DownloadProgress>("update-download-progress", (e) => cb(e.payload));
}
