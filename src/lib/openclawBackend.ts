import {
  type AgentBackend,
  type AgentBackendCapabilities,
  type AgentBackendStatus,
  type AgentChatRequest,
  type AgentEventHandler,
  type AgentRunHandle,
  type AgentUnsubscribe,
} from "@/lib/agentBackend";
import { checkOpenClawHttpStatus, openClawChatCompletion } from "@/lib/openclawHttpClient";

// WebSocket Gateway RPC preserved for future advanced features.
// Not used in default chat path (HTTP-first since TASK-013).
import { OpenClawGatewayClient, type OpenClawGatewayUnsubscribe } from "@/lib/openclawGateway";

export const openclawCapabilities: AgentBackendCapabilities = {
  streaming: false,  // HTTP-first v0: stream=false, P1 add SSE
  abort: false,      // HTTP-first v0: local cancel only
  sessions: false,   // HTTP-first: stateless
  attachments: false,
  skills: false,     // HTTP-first: no skills.status
  usage: false,
  memory: false,
  cron: false,
  tools: false,
};

const CHAT_MODEL = "openclaw/default";

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

    const result = await openClawChatCompletion(messages, request.model || CHAT_MODEL);

    if (!result.ok) {
      throw new Error(`OpenClaw 请求失败：${result.error || "未知错误"}`);
    }

    return {
      backend: this.type,
      requestId: request.requestId,
      sessionId: request.sessionId ?? null,
      accepted: true,
      raw: { content: result.content, model: result.model },
    };
  }

  async cancelChat(_handle: Pick<AgentRunHandle, "requestId" | "runId" | "sessionId">): Promise<void> {
    // HTTP-first v0: stream=false, cannot abort remote.
    // Local cancel is handled in App.tsx stopGeneration().
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
