import { invoke } from "@tauri-apps/api/core";

// OpenClaw messaging-channel client. All calls go through Rust commands that drive
// the `openclaw channels` CLI, so the gateway owns config writes/validation and bot
// tokens never touch the WebView, localStorage, or the app's own config.json.

// One channel entry as reported by `openclaw channels list --all --json`.
export interface ChannelEntry {
  // Stable channel id, e.g. "telegram" / "discord".
  id: string;
  // Configured account ids (empty when not set up).
  accounts: string[];
  // Whether the channel plugin is installed locally.
  installed: boolean;
  // "configured" | "bundled" | "installable".
  origin: string;
}

export interface ChannelsListResult {
  ok: boolean;
  channels: ChannelEntry[];
}

export interface ChannelMutationResult {
  ok: boolean;
  channel: string;
}

// One pending pairing request, e.g. the code shown after a user first DMs the bot.
export interface PairingRequest {
  code: string;
  from?: string;
  fromName?: string;
  createdAt?: number;
}

// Raw shape returned by Rust: { ok, chat: { <id>: { accounts, installed, origin } } }.
interface RawChannelsResult {
  ok: boolean;
  chat: Record<string, { accounts?: string[]; installed?: boolean; origin?: string }>;
}

// List all chat channels (configured + installable). Returns a flat, sorted array;
// falls back to an empty list if the CLI/gateway is unavailable so the UI can render.
export async function listOpenClawChannels(): Promise<ChannelsListResult> {
  try {
    const raw = await invoke<RawChannelsResult>("list_openclaw_channels");
    const channels: ChannelEntry[] = Object.entries(raw.chat || {}).map(([id, v]) => ({
      id,
      accounts: v.accounts ?? [],
      installed: Boolean(v.installed),
      origin: v.origin ?? "installable",
    }));
    return { ok: true, channels };
  } catch {
    return { ok: false, channels: [] };
  }
}

// Add/update a channel account. `token` is the platform credential (e.g. a Telegram
// bot token). It is sent to Rust, written to a 0600 temp file, handed to the CLI via
// --token-file, then deleted; it is never persisted on the frontend.
export async function addOpenClawChannel(channel: string, token: string): Promise<ChannelMutationResult> {
  return invoke<ChannelMutationResult>("add_openclaw_channel", { channel, token });
}

// Delete a channel account's config non-interactively.
export async function removeOpenClawChannel(channel: string): Promise<ChannelMutationResult> {
  return invoke<ChannelMutationResult>("remove_openclaw_channel", { channel });
}

// Restart the gateway service so channel changes take effect (~15s). Drains in-flight
// work first via --safe. The caller should poll gateway health afterwards.
export async function restartOpenClawGateway(): Promise<{ ok: boolean }> {
  return invoke<{ ok: boolean }>("restart_openclaw_gateway");
}

// List pending pairing requests for a channel; empty list on any failure.
export async function listPairingRequests(channel: string): Promise<PairingRequest[]> {
  try {
    const res = await invoke<{ ok: boolean; requests: PairingRequest[] }>("list_pairing_requests", { channel });
    return res.requests ?? [];
  } catch {
    return [];
  }
}

// Approve a pairing code, allowing that sender to talk to the bot.
export async function approvePairingRequest(channel: string, code: string): Promise<{ ok: boolean; code: string }> {
  return invoke<{ ok: boolean; code: string }>("approve_pairing_request", { channel, code });
}

// Read the installed OpenClaw version (e.g. "2026.5.27"); "" if unavailable.
export async function getOpenClawVersion(): Promise<string> {
  try {
    const res = await invoke<{ ok: boolean; version: string }>("get_openclaw_version");
    return res.version ?? "";
  } catch {
    return "";
  }
}

// Compare two dotted version strings (e.g. "2026.5.27"). Returns true if a >= b.
export function versionGte(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

// Start WeChat QR login; returns the QR URL to render. The backend keeps the login
// process alive and emits a "wechat-login-status" event when it finishes.
export async function startWeChatLogin(): Promise<{ ok: boolean; qrUrl: string }> {
  return invoke<{ ok: boolean; qrUrl: string }>("start_wechat_login");
}

// Cancel an in-flight WeChat login.
export async function cancelWeChatLogin(): Promise<void> {
  try { await invoke("cancel_wechat_login"); } catch { /* ignore */ }
}
