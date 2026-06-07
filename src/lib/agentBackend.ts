import { type ChatMessage } from "@/lib/api";
import { OpenClawBackend } from "@/lib/openclawBackend";
import { invoke } from "@tauri-apps/api/core";

export type AgentBackendType = "hermes" | "openclaw";

export interface AgentBackendCapabilities {
  streaming: boolean;
  abort: boolean;
  sessions: boolean;
  attachments: boolean;
  skills: boolean;
  usage: boolean;
  memory: boolean;
  cron: boolean;
  tools: boolean;
}

export interface AgentBackendStatus {
  type: AgentBackendType;
  label: string;
  installed: boolean;
  running: boolean;
  ready: boolean;
  detail?: string;
  version?: string | null;
  capabilities: AgentBackendCapabilities;
  raw?: unknown;
}

export type AgentChatMessage = ChatMessage;

export interface AgentChatRequest {
  requestId: string;
  model: string;
  messages: AgentChatMessage[];
  sessionId?: string | null;
  attachments?: unknown[];
}

export interface AgentRunHandle {
  backend: AgentBackendType;
  requestId: string;
  runId?: string;
  sessionId?: string | null;
  accepted: boolean;
  raw?: unknown;
}

export type AgentEvent =
  | { type: "text_delta"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; text: string }
  | { type: "message_snapshot"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; content: string }
  | { type: "reasoning_delta"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; text: string }
  | { type: "tool_event"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; label: string; data?: unknown }
  | { type: "usage"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; usage: unknown }
  | { type: "diagnostics"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; diagnostics: unknown }
  | { type: "done"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; stopped?: boolean; raw?: unknown }
  | { type: "error"; backend: AgentBackendType; requestId: string; sessionId?: string | null; runId?: string; error: string; raw?: unknown };

export type AgentEventHandler = (event: AgentEvent) => void;
export type AgentUnsubscribe = () => void;

export interface AgentBackend {
  readonly type: AgentBackendType;
  readonly label: string;
  checkStatus(): Promise<AgentBackendStatus>;
  getCapabilities(): AgentBackendCapabilities;
  startChat(request: AgentChatRequest): Promise<AgentRunHandle>;
  cancelChat(handle: Pick<AgentRunHandle, "requestId" | "runId" | "sessionId">): Promise<void>;
  subscribeEvents?(handler: AgentEventHandler, options?: { requestId?: string; sessionId?: string }): Promise<AgentUnsubscribe>;
  listSessions?(): Promise<unknown[]>;
  listSkills?(): Promise<unknown[]>;
  getUsage?(): Promise<unknown>;
}

// ── OpenClawBackend lazy singleton ──
// DEV-ONLY: uses Rust command to read gateway token from ~/.openclaw/openclaw.json.
// Token never leaves memory, never appears in logs, never reaches the UI.
// MUST be migrated to Tauri-managed WS client in P1.

let _openclawBackend: OpenClawBackend | null = null;

async function fetchGatewayToken(): Promise<string | null> {
  try {
    const result = await invoke<{ tokenPresent: boolean; token: string | null; tokenLength: number; authMode: string }>(
      "read_openclaw_gateway_auth_for_local_use"
    );
    if (result.tokenPresent && result.token) {
      // DEV-ONLY: token used only for WS connect, never logged/stored.
      return result.token;
    }
    return null;
  } catch {
    return null;
  }
}

export function getOpenClawBackend(gatewayToken?: string): OpenClawBackend | null {
  // Return existing instance if available and connected
  if (_openclawBackend) return _openclawBackend;

  // If caller provides token directly, use it
  if (gatewayToken) {
    try {
      _openclawBackend = new OpenClawBackend(gatewayToken);
      return _openclawBackend;
    } catch {
      return null;
    }
  }
  return null;
}

export async function initOpenClawBackend(): Promise<OpenClawBackend | null> {
  if (_openclawBackend) return _openclawBackend;
  const token = await fetchGatewayToken();
  if (!token) return null;
  try {
    _openclawBackend = new OpenClawBackend(token);
    return _openclawBackend;
  } catch {
    return null;
  }
}

export function resetOpenClawBackend(): void {
  if (_openclawBackend) {
    _openclawBackend = null;
  }
}

export function isOpenClawBackendAvailable(): boolean {
  return _openclawBackend !== null;
}
