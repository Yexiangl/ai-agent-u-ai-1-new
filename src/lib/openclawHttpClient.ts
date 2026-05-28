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
  authOk?: boolean;
  authRequired?: boolean;
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
