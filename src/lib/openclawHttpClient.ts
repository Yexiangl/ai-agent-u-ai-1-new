import { invoke } from "@tauri-apps/api/core";

// HTTP requests delegated to Rust backend to avoid WebView CORS/CSP issues.
// Token is read by Rust from ~/.openclaw/openclaw.json and never returned to JS.

export interface OpenClawHttpStatus {
  ready: boolean;
  error?: string;
  models?: string[];
  defaultModel?: string;
  statusCode?: number;
  gatewayReachable?: boolean;
  gatewayLive?: boolean;
  httpApiEnabled?: boolean;
  authOk?: boolean;
  authRequired?: boolean;
}

// Structured fields parsed from the gateway's native `session_status` tool.
export interface OpenClawSessionStatus {
  ok: boolean;
  error?: string;
  statusText?: string;
  version?: string;
  uptimeGateway?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheHitPct?: number;
  contextUsedK?: number;
  contextTotalK?: number;
  contextPct?: number;
  compactions?: number;
  thinkLevel?: string;
  sessionKey?: string;
}

export async function readOpenClawSessionStatus(): Promise<OpenClawSessionStatus> {
  try {
    return await invoke<OpenClawSessionStatus>("openclaw_session_status");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OpenClawSearchResult {
  title: string;
  snippet: string;
  url: string;
  siteName: string;
}

export interface OpenClawWebSearch {
  ok: boolean;
  error?: string;
  query?: string;
  provider?: string;
  tookMs?: number;
  count?: number;
  results?: OpenClawSearchResult[];
}

export async function openClawWebSearch(query: string): Promise<OpenClawWebSearch> {
  try {
    return await invoke<OpenClawWebSearch>("openclaw_web_search", { query });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OpenClawSessionEntry {
  key: string;
  agentId: string;
  channel: string;
  model: string;
  status: string;
  contextTokens: number;
  totalTokens: number;
  runtimeMs: number;
  thinkingLevel: string;
  updatedAt: number;
}

export interface OpenClawSessionsList {
  ok: boolean;
  error?: string;
  count?: number;
  totalTokensAcrossSessions?: number;
  sessions?: OpenClawSessionEntry[];
}

export async function readOpenClawSessionsList(): Promise<OpenClawSessionsList> {
  try {
    return await invoke<OpenClawSessionsList>("openclaw_sessions_list");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OpenClawChatResult {
  ok: boolean;
  content?: string;
  model?: string;
  finishReason?: string;
  usage?: unknown;
  error?: string;
}

export async function checkOpenClawHttpStatus(): Promise<OpenClawHttpStatus> {
  try {
    const result = await invoke<{ ready: boolean; error?: string; models?: string[] }>(
      "openclaw_http_status"
    );
    return result;
  } catch (err) {
    return { ready: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OpenClawConfigSummary {
  configExists: boolean;
  configPathHint?: string;
  gatewayAuthMode?: string;
  gatewayTokenPresent: boolean;
  gatewayPort?: number;
  httpChatCompletionsEnabled: boolean;
  defaultModelPrimary?: string | null;  // agents.defaults.model.primary (safe summary, no token)
  errors: string[];
}

export async function readOpenClawConfigSummary(): Promise<OpenClawConfigSummary> {
  try {
    return await invoke<OpenClawConfigSummary>("read_openclaw_config_summary");
  } catch {
    return { configExists: false, gatewayTokenPresent: false, httpChatCompletionsEnabled: false, errors: ["读取失败"] };
  }
}

export interface OpenClawProviderSummary {
  providerConfigured: boolean;
  providerId?: string | null;
  tokenPresent: boolean;
  defaultModelRef?: string | null;
  availableConfiguredModels: string[];
  errors: string[];
}

export interface ApplyProviderConfigResult {
  success: boolean;
  appliedPreset?: string;
  appliedModelId?: string;
  defaultModelRef?: string;
  httpChatCompletionsEnabled?: boolean;
  needsRestart?: boolean;
}

export async function readOpenClawProviderSummary(): Promise<OpenClawProviderSummary> {
  try {
    return await invoke<OpenClawProviderSummary>("read_openclaw_model_provider_summary");
  } catch {
    return { providerConfigured: false, tokenPresent: false, availableConfiguredModels: [], errors: ["读取失败"] };
  }
}

export async function applyOpenClawProviderConfig(token: string, preset: "speed" | "quality"): Promise<ApplyProviderConfigResult> {
  return invoke<ApplyProviderConfigResult>("apply_openclaw_model_provider_config", { token, modelPreset: preset });
}

// Streaming chat: Rust spawns an async SSE task and emits openclaw-chat-chunk/done/error
// events (same shape as the Hermes pipeline). Resolves once the request is accepted.
export async function openClawChatCompletionStream(
  requestId: string,
  messages: Array<{ role: string; content: string }>,
  model?: string,
): Promise<{ accepted: boolean }> {
  const result = await invoke<{ success?: boolean; accepted?: boolean }>(
    "openclaw_http_chat_completion_stream",
    { requestId, messages, model: model || null },
  );
  return { accepted: Boolean(result.accepted ?? result.success) };
}

export async function cancelOpenClawChatCompletion(requestId: string): Promise<void> {
  try {
    await invoke("cancel_openclaw_chat_completion", { requestId });
  } catch {
    // best-effort; local cancel still applies
  }
}

export async function openClawChatCompletion(
  messages: Array<{ role: string; content: string }>,
  model?: string,
): Promise<OpenClawChatResult> {
  try {
    const result = await invoke<{
      ok: boolean;
      content?: string;
      model?: string;
      finishReason?: string;
      usage?: unknown;
    }>("openclaw_http_chat_completion", {
      messages,
      model: model || null,
    });
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
