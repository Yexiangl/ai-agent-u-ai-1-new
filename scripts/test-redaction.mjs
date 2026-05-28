// TASK-028H-1: redaction helper tests (plain JS, no Node deps needed)

function redactSensitive(input) {
  if (input == null) return "[null]";
  if (typeof input !== "string") {
    try {
      return redactSensitive(JSON.stringify(input));
    } catch {
      return "[Unserializable]";
    }
  }
  let result = input;

  result = result.replace(/Authorization\s*:\s*Bearer\s+\S+/gi, "Authorization: Bearer [REDACTED]");
  result = result.replace(/Bearer\s+\S{8,}/gi, "Bearer [REDACTED]");

  const sensitiveKeys = ["apiKey", "api_key", "token", "access_token", "refresh_token", "gateway\\.auth\\.token", "password", "secret", "key"];
  for (const key of sensitiveKeys) {
    const re = new RegExp(`(["'])${key}\\1\\s*:\\s*(["'])([^"']{4,})\\2`, "gi");
    result = result.replace(re, `$1${key.replace(/\\./g, ".")}$1:$2[REDACTED]$2`);
  }
  result = result.replace(/OPENCLAW_GATEWAY_TOKEN\s*=\s*"?\S{8,}"?/gi, "OPENCLAW_GATEWAY_TOKEN=[REDACTED]");
  result = result.replace(/gateway\.auth\.token\s*[=:]\s*\S{4,}/gi, "gateway.auth.token=[REDACTED]");

  result = result.replace(/https?:\/\/ai\.\w+\.\w+\/\S*/gi, "[MODEL_PROXY_URL]");
  result = result.replace(/https?:\/\/127\.0\.0\.1:\d+\/\S*/gi, "[LOCAL_API_URL]");
  result = result.replace(/https?:\/\/localhost:\d+\/\S*/gi, "[LOCAL_API_URL]");
  result = result.replace(/([?&])(token|key|secret|api_key|apiKey|signature|sig)=[^&\s"]+/gi, "$1$2=[REDACTED]");

  result = result.replace(/(provider\s*:\s*)\S+/gi, "$1[REDACTED]");
  result = result.replace(/(baseUrl\s*:\s*|base_url\s*:\s*)\S+/gi, "$1[REDACTED]");
  result = result.replace(/(API URL\s*:\s*)\S+/gi, "$1[REDACTED]");

  result = result.replace(/\/Users\/[^/\s]+\//g, "/Users/***/");
  result = result.replace(/\/home\/[^/\s]+\//g, "/home/***/");
  result = result.replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, (m) => {
    const parts = m.split("\\");
    if (parts.length >= 3) parts[2] = "***";
    return parts.join("\\");
  });

  return result;
}

const tests = [];
let pass = 0, fail = 0;

function test(name, input, shouldNotContain) {
  const output = redactSensitive(input);
  const ok = !output.includes(shouldNotContain);
  tests.push({ name, ok, output });
  if (ok) pass++; else fail++;
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}`);
  if (!ok) console.log(`  input:  ${input}`);
  if (!ok) console.log(`  output: ${output}`);
  if (!ok) console.log(`  should not contain: ${shouldNotContain}`);
}

// 1. Bearer token
test("Bearer in Authorization header", "Authorization: Bearer sk-test-123456", "sk-test-123456");
test("Bare Bearer token", "Bearer sk-test-1234567890", "sk-test-1234567890");

// 2. apiKey JSON
test("apiKey in JSON", '{"apiKey":"dummy-token-1234"}', "dummy-token-1234");
test("api_key in JSON", '{"api_key":"my-secret"}', "my-secret");
test("token in JSON", '{"token":"abc123456789"}', "abc123456789");

// 3. URLs
test("Model proxy URL", "https://ai.f1class.icu/v1/chat", "ai.f1class.icu");
test("Localhost API URL", "http://127.0.0.1:18789/v1/models", "127.0.0.1:18789");
test("Localhost 8642 URL", "http://127.0.0.1:8642/v1/chat/completions", "127.0.0.1:8642");
test("URL query token", "https://example.com/v1/chat?token=dummy-token", "dummy-token");

// 4. Paths
test("macOS user path", "/Users/alice/Documents/file.txt", "/Users/alice/");
test("Linux home path", "/home/bob/projects/secret.txt", "/home/bob/");
test("Windows user path", "C:\\Users\\charlie\\Documents\\file.txt", "charlie");

// 5. Edge cases
test("null input", null, "Unserializable");
test("undefined input", undefined, "Unserializable");
test("object input", { key: "value" }, "value"); // should NOT contain plain value after redaction? Actually this tests redaction pipeline

// 6. Safe text preserved
const safeOut = redactSensitive("AI 助手已准备好");
console.log(safeOut === "AI 助手已准备好" ? "[PASS] Safe text preserved" : `[FAIL] Safe text altered to: ${safeOut}`);
if (safeOut === "AI 助手已准备好") pass++; else fail++;

// 7. gateway.auth.token
test("gateway.auth.token", "gateway.auth.token=my-secret-token-123", "my-secret-token-123");

// 8. OPENCLAW_GATEWAY_TOKEN
test("OPENCLAW_GATEWAY_TOKEN env", "OPENCLAW_GATEWAY_TOKEN=abcdefgh12345678", "abcdefgh12345678");

// 9. baseUrl
test("baseUrl", "baseUrl: https://proxy.example.com/v1", "proxy.example.com");

// 10. JSON validity after redaction
function testJsonValidity(name, input, expectedKey, expectedValue) {
  const output = redactSensitive(input);
  let parsed;
  try { parsed = JSON.parse(output); } catch (e) {
    tests.push({ name, ok: false, output });
    fail++;
    console.log(`[FAIL] ${name}`);
    console.log(`  output: ${output}`);
    console.log(`  JSON.parse error: ${e.message}`);
    return;
  }
  const ok = parsed[expectedKey] === expectedValue;
  tests.push({ name, ok, output });
  if (ok) pass++; else fail++;
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}`);
  if (!ok) console.log(`  output: ${output}`);
  if (!ok) console.log(`  parsed[${expectedKey}]: ${parsed[expectedKey]}`);
}

testJsonValidity("JSON apiKey validity", '{"apiKey":"test1234"}', "apiKey", "[REDACTED]");
testJsonValidity("JSON token validity", '{"token":"test1234"}', "token", "[REDACTED]");

console.log(`\n${pass} passed, ${fail} failed of ${pass + fail} tests`);
process.exit(fail > 0 ? 1 : 0);
