#!/usr/bin/env node
// OpenClaw HTTP API probe — tests OpenAI-compatible endpoints.
// Does NOT read .env, does NOT print tokens, does NOT modify config.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GATEWAY_URL = "http://127.0.0.1:18789";
const results = [];

function record(name, status, detail = "") {
  results.push({ name, status, detail: sanitizeText(detail) });
}

function sanitizeText(text) {
  return String(text ?? "")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:gateway[-_\s]?token|device[-_\s]?token|api[-_\s]?key|password|secret)\s*[:=]\s*)[^\s,}"']+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|gsk|sk-or|sk-ant|sk-proj)-[A-Za-z0-9_\-]{8,}\b/g, "[REDACTED]");
}

async function httpFetch(url, opts = {}) {
  try {
    const init = { method: opts.method || "GET", headers: { ...(opts.headers || {}) } };
    if (opts.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
    const contentType = resp.headers.get("content-type") || "";
    const body = await resp.text();
    return { statusCode: resp.status, contentType, body };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

async function run() {

// ── Step 0: Read token ──
console.log("=== Step 0: Token ===\n");
let token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || null;
if (!token) {
  try {
    const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    token = cfg?.gateway?.auth?.token || null;
    if (token && !token.includes("REDACTED")) {
      record("token source", "INFO", `~/.openclaw/openclaw.json; length=${token.length}`);
    } else {
      token = null;
    }
  } catch {}
}
if (!token) {
  record("token source", "SKIP", "token_present=false; set OPENCLAW_GATEWAY_TOKEN or ensure ~/.openclaw/openclaw.json exists");
} else {
  record("token source", "INFO", `present; length=${token.length}`);
}
console.log("");

// ── Step 1: /v1/models ──
console.log("=== Step 1: GET /v1/models ===\n");
const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
const models = await httpFetch(`${GATEWAY_URL}/v1/models`, { headers: authHeaders });
if (models.error) {
  record("/v1/models", "FAIL", `HTTP error: ${models.error}`);
} else if (models.statusCode === 200) {
  const isHtml = models.contentType.includes("text/html");
  const isJson = models.contentType.includes("application/json");
  if (isHtml) {
    record("/v1/models", "WARN", "status=200; content-type=text/html → Control UI fallback. HTTP API NOT enabled.");
    record("/v1/models conclusion", "INFO", "HTTP API endpoints are disabled by default. Must enable in config.");
  } else if (isJson) {
    record("/v1/models", "PASS", "status=200; content-type=application/json → HTTP API available");
    try {
      const data = JSON.parse(models.body);
      const modelList = data?.data || [];
      record("/v1/models data", "INFO", `models.count=${modelList.length}; sample=${modelList.slice(0, 5).map((m) => m.id || m.model).join(", ")}`);
    } catch {
      record("/v1/models parse", "WARN", "JSON parse failed");
    }
  } else {
    record("/v1/models", "WARN", `status=200; content-type=${models.contentType}; body_preview=${models.body.slice(0, 100)}`);
  }
} else {
  record("/v1/models", "FAIL", `status=${models.statusCode}`);
}
console.log("");

// ── Step 2: /v1/chat/completions ──
console.log("=== Step 2: POST /v1/chat/completions ===\n");
const chat = await httpFetch(`${GATEWAY_URL}/v1/chat/completions`, {
  method: "POST",
  headers: authHeaders,
  body: {
    model: "openclaw/default",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
  },
});
if (chat.error) {
  record("/v1/chat/completions", "FAIL", `HTTP error: ${chat.error}`);
} else {
  if (chat.statusCode === 404) {
    record("/v1/chat/completions", "FAIL", "status=404 → endpoint NOT enabled. Requires gateway.http.endpoints.chatCompletions.enabled=true");
  } else if (chat.statusCode === 200) {
    record("/v1/chat/completions", "PASS", "status=200 → endpoint available");
    try {
      const data = JSON.parse(chat.body);
      const content = data?.choices?.[0]?.message?.content || "(empty)";
      record("/v1/chat/completions response", "INFO", `content=${content.slice(0, 200)}`);
    } catch {
      record("/v1/chat/completions parse", "WARN", "JSON parse failed");
    }
  } else if (chat.statusCode === 401 || chat.statusCode === 403) {
    record("/v1/chat/completions", "WARN", `status=${chat.statusCode} → auth required`);
  } else {
    record("/v1/chat/completions", "FAIL", `status=${chat.statusCode}; body=${chat.body.slice(0, 200)}`);
  }
}
console.log("");

// ── Step 3: Config check ──
console.log("=== Step 3: Config check ===\n");
try {
  const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const http = cfg?.gateway?.http;
    const endpoints = http?.endpoints;
    const cc = endpoints?.chatCompletions;
    record("config gateway.http", "INFO", http ? "present" : "absent");
    if (endpoints) {
      record("config gateway.http.endpoints", "INFO", "present");
      record("config chatCompletions.enabled", "INFO", cc?.enabled === true ? "true" : (cc?.enabled === false ? "false" : "not set"));
    } else {
      record("config gateway.http.endpoints", "INFO", "absent — HTTP API not configured");
    }
  }
} catch (err) {
  record("config read", "WARN", `failed: ${err.message}`);
}
console.log("");

// ── Step 4: Conclusion ──
console.log("=== Step 4: Conclusion ===\n");
const modelsOk = results.find((r) => r.name === "/v1/models" && r.status === "PASS");
const chatOk = results.find((r) => r.name === "/v1/chat/completions" && r.status === "PASS");

if (modelsOk && chatOk) {
  record("HTTP API status", "PASS", "OpenAI-compatible HTTP API is ENABLED and available.");
  record("recommendation", "INFO", "App can use HTTP /v1/chat/completions for basic chat. WebSocket RPC retained for advanced features.");
} else {
  record("HTTP API status", "FAIL", "HTTP API endpoints are NOT enabled by default.");
  record("how to enable", "INFO",
    "Run: openclaw config set gateway.http.endpoints.chatCompletions.enabled true --strict-json");
  record("how to verify", "INFO",
    "Then restart Gateway and re-run: node scripts/openclaw-http-api-probe.mjs");
  record("comparison WS vs HTTP", "INFO", [
    "HTTP /v1/chat/completions: simple, no pairing, no device identity, no WS RPC",
    "HTTP loses: session management, tool live events, skills.status, abort granularity, usage/capabilities",
    "If HTTP works, it satisfies basic chat. WebSocket RPC for advanced features later.",
  ].join(" | "));
}

// ── Output ──
}

run().then(() => {
  console.log("OpenClaw HTTP API Probe\n");
  for (const r of results) {
  console.log(`[${r.status.padEnd(4, " ")}] ${r.name}`);
  if (r.detail) for (const line of r.detail.split(/\r?\n/).filter(Boolean)) console.log(`       ${line}`);
}
  const failed = results.filter((r) => r.status === "FAIL");
  if (failed.length > 0) console.error(`\n${failed.length} failure(s).`);
  else console.log("\nProbe completed.");
});
