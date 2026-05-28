import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type ChatMessage } from "@/lib/api";
import {
  cancelHermesChatCompletion,
  checkHermes,
  checkHermesApiServer,
  hermesChatCompletion,
  type HermesApiServerStatus,
  type HermesChatChunk,
  type HermesChatDone,
  type HermesChatError,
  type HermesChatResult,
  type HermesStatus,
  type HermesStreamDiagnostics,
  type HermesToolProgress,
} from "@/lib/hermes";
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

export const hermesLegacyCapabilities: AgentBackendCapabilities = {
  streaming: true,
  abort: true,
  sessions: true,
  attachments: true,
  skills: true,
  usage: true,
  memory: true,
  cron: true,
  tools: true,
};

export class HermesLegacyBackend implements AgentBackend {
  readonly type = "hermes" as const;
  readonly label = "Hermes Legacy";

  getCapabilities(): AgentBackendCapabilities {
    return hermesLegacyCapabilities;
  }

  async checkStatus(): Promise<AgentBackendStatus> {
    const [cli, api] = await Promise.all([this.checkHermesInstalled(), this.checkHermesApiServer()]);

    return {
      type: this.type,
      label: this.label,
      installed: cli.installed,
      running: api.running,
      ready: Boolean(cli.installed && api.running),
      detail: api.error || cli.error || undefined,
      version: cli.version,
      capabilities: this.getCapabilities(),
      raw: { cli, api },
    };
  }

  async checkHermesInstalled(): Promise<HermesStatus> {
    return checkHermes();
  }

  async checkHermesApiServer(): Promise<HermesApiServerStatus> {
    return checkHermesApiServer();
  }

  async startChat(request: AgentChatRequest): Promise<AgentRunHandle> {
    const result: HermesChatResult = await hermesChatCompletion(request.requestId, request.model, request.messages);

    return {
      backend: this.type,
      requestId: request.requestId,
      sessionId: result.sessionId ?? request.sessionId ?? null,
      accepted: Boolean(result.success && (result.accepted ?? true)),
      raw: result,
    };
  }

  async cancelChat(handle: Pick<AgentRunHandle, "requestId">): Promise<void> {
    await cancelHermesChatCompletion(handle.requestId);
  }

  async subscribeEvents(handler: AgentEventHandler, options?: { requestId?: string }): Promise<AgentUnsubscribe> {
    const matches = (requestId: string) => !options?.requestId || options.requestId === requestId;
    const unlisteners: UnlistenFn[] = [];

    unlisteners.push(await listen<HermesChatChunk>("hermes-chat-chunk", (event) => {
      if (!matches(event.payload.requestId)) return;
      handler(event.payload.type === "reasoning"
        ? { type: "reasoning_delta", backend: this.type, requestId: event.payload.requestId, text: event.payload.content || "" }
        : { type: "text_delta", backend: this.type, requestId: event.payload.requestId, text: event.payload.content || "" });
    }));

    unlisteners.push(await listen<HermesToolProgress>("hermes-tool-progress", (event) => {
      if (!matches(event.payload.requestId)) return;
      handler({ type: "tool_event", backend: this.type, requestId: event.payload.requestId, label: event.payload.event, data: event.payload.data });
    }));

    unlisteners.push(await listen<HermesStreamDiagnostics>("hermes-stream-diagnostics", (event) => {
      if (!matches(event.payload.requestId)) return;
      handler({ type: "diagnostics", backend: this.type, requestId: event.payload.requestId, diagnostics: event.payload.diagnostics });
    }));

    unlisteners.push(await listen<HermesChatDone>("hermes-chat-done", (event) => {
      if (!matches(event.payload.requestId)) return;
      if (event.payload.rawUsage) {
        handler({ type: "usage", backend: this.type, requestId: event.payload.requestId, sessionId: event.payload.sessionId, usage: event.payload.rawUsage });
      }
      handler({ type: "message_snapshot", backend: this.type, requestId: event.payload.requestId, sessionId: event.payload.sessionId, content: event.payload.content || "" });
      handler({ type: "done", backend: this.type, requestId: event.payload.requestId, sessionId: event.payload.sessionId, stopped: event.payload.stopped, raw: event.payload });
    }));

    unlisteners.push(await listen<HermesChatError>("hermes-chat-error", (event) => {
      if (!matches(event.payload.requestId)) return;
      handler({ type: "error", backend: this.type, requestId: event.payload.requestId, error: event.payload.error, raw: event.payload });
    }));

    return () => {
      for (const unlisten of unlisteners) unlisten();
    };
  }
}

export const hermesLegacyBackend = new HermesLegacyBackend();

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
