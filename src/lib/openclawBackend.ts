import {
  type AgentBackend,
  type AgentBackendCapabilities,
  type AgentBackendStatus,
  type AgentChatRequest,
  type AgentEventHandler,
  type AgentRunHandle,
  type AgentUnsubscribe,
} from "@/lib/agentBackend";
import { cancelOpenClawChatCompletion, checkOpenClawHttpStatus, openClawChatCompletionStream } from "@/lib/openclawHttpClient";

// WebSocket Gateway RPC preserved for future advanced features.
// Not used in default chat path (HTTP-first since TASK-013).
import { OpenClawGatewayClient, type OpenClawGatewayUnsubscribe } from "@/lib/openclawGateway";

export const openclawCapabilities: AgentBackendCapabilities = {
  streaming: true,   // SSE streaming via gateway stream:true (Rust openclaw_http_chat_completion_stream)
  abort: true,       // remote cancel via cancel_openclaw_chat_completion
  sessions: false,   // HTTP-first: stateless
  attachments: false,
  skills: false,     // HTTP-first: no skills.status
  usage: true,
  memory: false,
  cron: false,
  tools: false,
};

const CHAT_MODEL = "openclaw/default";

// A native tool-progress item broadcast by the gateway during an agent run.
export interface OpenClawToolItem {
  runId?: string;
  itemId: string;
  name: string;
  title: string;
  phase: string;   // start | update | end
  status: string;  // running | completed | failed
}

export interface OpenClawGatewayConnState {
  connected: boolean;
  protocol?: number;
  serverVersion?: string;
  methodsCount?: number;
  eventsCount?: number;
  error?: string;
}

export class OpenClawBackend implements AgentBackend {
  readonly type = "openclaw" as const;
  readonly label = "OpenClaw";

  // WebSocket client preserved for future advanced features, not default chat
  private wsClient: OpenClawGatewayClient | null = null;

  constructor(
    private readonly gatewayToken: string,
  ) {}

  getCapabilities(): AgentBackendCapabilities {
    return openclawCapabilities;
  }

  async checkStatus(): Promise<AgentBackendStatus> {
    try {
      const httpStatus = await checkOpenClawHttpStatus();
      return {
        type: this.type,
        label: this.label,
        installed: true,
        running: httpStatus.ready,
        ready: httpStatus.ready,
        detail: httpStatus.error,
        version: null,
        capabilities: this.getCapabilities(),
        raw: {
          models: httpStatus.models,
        },
      };
    } catch (err) {
      return {
        type: this.type,
        label: this.label,
        installed: false,
        running: false,
        ready: false,
        detail: `checkStatus failed: ${err instanceof Error ? err.message : String(err)}`,
        capabilities: this.getCapabilities(),
      };
    }
  }

  async startChat(request: AgentChatRequest): Promise<AgentRunHandle> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Kick off the SSE stream in Rust. Returns once accepted; content arrives via
    // openclaw-chat-chunk/done/error events that App.tsx feeds into the typewriter.
    const result = await openClawChatCompletionStream(request.requestId, messages, request.model || CHAT_MODEL);

    return {
      backend: this.type,
      requestId: request.requestId,
      sessionId: request.sessionId ?? null,
      accepted: result.accepted,
      raw: { streaming: true },
    };
  }

  async cancelChat(handle: Pick<AgentRunHandle, "requestId" | "runId" | "sessionId">): Promise<void> {
    // Streaming path: tell Rust to abort the SSE task. Local cancel in App.tsx
    // stopGeneration() also flushes the buffer and marks the message stopped.
    await cancelOpenClawChatCompletion(handle.requestId);
  }

  // Connects the WS operator client and streams native tool-progress items.
  // The gateway broadcasts `agent` events (stream:"item", kind:"tool") for every run —
  // including HTTP chat-completion runs — to any operator.read client. We surface those
  // as live tool-progress without changing the HTTP chat path.
  async connectToolEvents(
    onTool: (item: OpenClawToolItem) => void,
  ): Promise<{ status: OpenClawGatewayConnState; unsubscribe: OpenClawGatewayUnsubscribe }> {
    if (!this.wsClient) {
      this.wsClient = new OpenClawGatewayClient(undefined, this.gatewayToken);
    }
    const status = await this.wsClient.connect();
    const unsubscribe = this.wsClient.onEvent((evt) => {
      if (evt.type !== "agent") return;
      const payload = evt.payload as { stream?: string; runId?: string; data?: Record<string, unknown> } | undefined;
      if (!payload || payload.stream !== "item") return;
      const data = payload.data || {};
      if (data.kind !== "tool") return;
      onTool({
        runId: payload.runId || evt.runId,
        itemId: typeof data.itemId === "string" ? data.itemId : "",
        name: typeof data.name === "string" ? data.name : "",
        title: typeof data.title === "string" ? data.title : "",
        phase: typeof data.phase === "string" ? data.phase : "",
        status: typeof data.status === "string" ? data.status : "",
      });
    });
    return {
      status: {
        connected: status.connected,
        protocol: status.protocol,
        serverVersion: status.serverVersion,
        methodsCount: status.methodsCount,
        eventsCount: status.eventsCount,
        error: status.error,
      },
      unsubscribe,
    };
  }

  disconnectToolEvents(): void {
    this.wsClient?.disconnect();
  }

  async subscribeEvents(
    handler: AgentEventHandler,
    options?: { requestId?: string; sessionId?: string },
  ): Promise<AgentUnsubscribe> {
    // HTTP-first: no event subscription needed.
    // Content is delivered synchronously from chat completion response.
    // App.tsx handleOpenClawResponse dispatches a single "done" event.
    return () => {};
  }
}
