import { type ModelName } from "@/lib/config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ApiResult<T> {
  ok: boolean;
  latencyMs: number;
  data?: T;
  error?: string;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

async function requestJson<T>(url: string, apiKey: string, init?: RequestInit): Promise<ApiResult<T>> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);

  try {
    if (!apiKey.trim()) {
      return { ok: false, latencyMs: 0, error: "模型访问密钥未填写，请先在 AI 助手页填写并保存" };
    }

    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, latencyMs: 0, error: "模型服务配置异常，请联系售后处理" };
    }

    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init?.headers ?? {})
      }
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    const text = await response.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { message: text };
    }

    if (!response.ok) {
      return { ok: false, latencyMs, error: formatApiError(response.status, json) };
    }

    return { ok: true, latencyMs, data: json as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: message.includes("abort") || message.includes("Abort")
        ? "网络请求超时，请检查模型服务状态"
        : "网络错误或模型服务暂不可用，请检查网络连接"
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatApiError(status: number, json: unknown) {
  if (status === 401 || status === 403) return `HTTP ${status}: 鉴权失败，请检查模型访问密钥是否正确或是否有模型权限`;
  if (status === 404) return `HTTP ${status}: 模型服务暂不可用，请联系售后处理`;

  if (typeof json === "object" && json) {
    if ("error" in json) {
      const error = (json as { error: unknown }).error;
      if (typeof error === "object" && error && "message" in error) {
        return `HTTP ${status}: ${String((error as { message: unknown }).message)}`;
      }
      return `HTTP ${status}: ${typeof error === "string" ? error : JSON.stringify(error)}`;
    }
    if ("message" in json) return `HTTP ${status}: ${String((json as { message: unknown }).message)}`;
  }
  return `HTTP ${status}: 请求失败`;
}

export async function listModels(baseUrl: string, apiKey: string) {
  return requestJson<{ data?: Array<{ id: string }> }>(`${normalizeBaseUrl(baseUrl)}/models`, apiKey, { method: "GET" });
}

export async function chatCompletion(baseUrl: string, apiKey: string, model: ModelName | string, messages: ChatMessage[]) {
  const body: Record<string, unknown> = { model, messages };
  if (model === "kimi-k2.6") body.temperature = 1;

  return requestJson<{ choices?: Array<{ message?: { content?: string } }> }>(`${normalizeBaseUrl(baseUrl)}/chat/completions`, apiKey, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function testConnection(baseUrl: string, apiKey: string, model: ModelName | string) {
  const models = await listModels(baseUrl, apiKey);
  if (!models.ok) return models;
  return chatCompletion(baseUrl, apiKey, model, [{ role: "user", content: "请回复：连接正常" }]);
}
