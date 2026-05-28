// TASK-028H-1: Sensitive information redaction helper.
// Used for logs, diagnostic summaries, error messages, and portable status output.

/** Redact sensitive information from diagnostic/log output.
 *  Covers: Bearer tokens, API keys, auth tokens, provider URLs, local paths.
 */
export function redactSensitive(input: unknown): string {
  if (input == null) return "[null]";
  if (typeof input !== "string") {
    try {
      return redactSensitive(JSON.stringify(input));
    } catch {
      return "[Unserializable]";
    }
  }
  let result = input;

  // 1. Authorization: Bearer <token>
  result = result.replace(/Authorization\s*:\s*Bearer\s+\S+/gi, "Authorization: Bearer [REDACTED]");
  // 2. Bare Bearer token in string
  result = result.replace(/Bearer\s+\S{8,}/gi, "Bearer [REDACTED]");

  // 3. JSON key-value token fields: "apiKey":"...", "api_key":"...", etc.
  const sensitiveKeys = ["apiKey", "api_key", "token", "access_token", "refresh_token", "gateway\\.auth\\.token", "password", "secret", "key"];
  for (const key of sensitiveKeys) {
    const re = new RegExp(`(["'])${key}\\1\\s*:\\s*(["'])([^"']{4,})\\2`, "gi");
    result = result.replace(re, `$1${key.replace(/\\./g, ".")}$1:$2[REDACTED]$2`);
  }
  // Also handle OPENCLAW_GATEWAY_TOKEN env var
  result = result.replace(/OPENCLAW_GATEWAY_TOKEN\s*=\s*"?\S{8,}"?/gi, "OPENCLAW_GATEWAY_TOKEN=[REDACTED]");
  // Handle gateway.auth.token key=value (bare format)
  result = result.replace(/gateway\.auth\.token\s*[=:]\s*\S{4,}/gi, "gateway.auth.token=[REDACTED]");

  // 4. Provider URLs and API endpoints
  result = result.replace(/https?:\/\/ai\.\w+\.\w+\/\S*/gi, "[MODEL_PROXY_URL]");
  result = result.replace(/https?:\/\/127\.0\.0\.1:\d+\/\S*/gi, "[LOCAL_API_URL]");
  result = result.replace(/https?:\/\/localhost:\d+\/\S*/gi, "[LOCAL_API_URL]");
  // URL query params with token/key/secret
  result = result.replace(/([?&])(token|key|secret|api_key|apiKey|signature|sig)=[^&\s"]+/gi, "$1$2=[REDACTED]");

  // 5. provider / baseUrl fields in text
  result = result.replace(/(provider\s*:\s*)\S+/gi, "$1[REDACTED]");
  result = result.replace(/(baseUrl\s*:\s*|base_url\s*:\s*)\S+/gi, "$1[REDACTED]");
  result = result.replace(/(API URL\s*:\s*)\S+/gi, "$1[REDACTED]");

  // 6. Local absolute paths (macOS / Linux)
  result = result.replace(/\/Users\/[^/\s]+\//g, "/Users/***/");
  result = result.replace(/\/home\/[^/\s]+\//g, "/home/***/");
  // Windows absolute paths
  result = result.replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, (m) => {
    const parts = m.split("\\");
    if (parts.length >= 3) parts[2] = "***";
    return parts.join("\\");
  });

  return result;
}

/** Safe version for object logging — returns redacted string, never throws. */
export function redactObject<T>(value: T): string {
  try {
    return redactSensitive(JSON.stringify(value));
  } catch {
    return "[Unserializable]";
  }
}
