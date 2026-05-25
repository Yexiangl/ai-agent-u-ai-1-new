#!/usr/bin/env node

import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const GATEWAY_HTTP_URL = "http://127.0.0.1:18789";
const GATEWAY_WS_URL = "ws://127.0.0.1:18789";
const TIMEOUT_MS = 5000;

const results = [];

function sanitize(text) {
  return String(text ?? "")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)[^\n]+/gi, "$1[REDACTED]")
    .replace(/((?:gateway[-_\s]?token|device[-_\s]?token|api[-_\s]?key|password)\s*[:=]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|gsk|sk-or|sk-ant|sk-proj)-[A-Za-z0-9_\-]{8,}\b/g, "[REDACTED]");
}

function record(name, status, detail = "") {
  results.push({ name, status, detail: sanitize(detail) });
}

function execOpenClaw(args) {
  return new Promise((resolve) => {
    execFile("openclaw", args, { timeout: TIMEOUT_MS, env: process.env }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error === "object" && "code" in error ? error.code : 0,
        signal: error && typeof error === "object" && "signal" in error ? error.signal : null,
        stdout: sanitize(stdout),
        stderr: sanitize(stderr),
        error: error ? sanitize(error.message) : "",
      });
    });
  });
}

function summarizeGatewayStatus(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interesting = lines.filter((line) => /runtime|running|port|18789|warning|warn|doctor|node|connectivity|probe|status/i.test(line));
  return (interesting.length ? interesting : lines).slice(0, 12).join("\n");
}

async function checkCli() {
  const version = await execOpenClaw(["--version"]);
  if (!version.ok) {
    record("openclaw CLI", "FAIL", version.error || version.stderr || "openclaw command not found or failed");
    return false;
  }
  record("openclaw --version", "PASS", version.stdout.trim() || version.stderr.trim());
  return true;
}

async function checkGatewayStatus() {
  const status = await execOpenClaw(["gateway", "status"]);
  if (!status.ok) {
    record("openclaw gateway status", "FAIL", [status.stdout, status.stderr, status.error].filter(Boolean).join("\n"));
    return false;
  }
  record("openclaw gateway status", "PASS", summarizeGatewayStatus(`${status.stdout}\n${status.stderr}`));
  return true;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttpPort() {
  try {
    const response = await fetchWithTimeout(GATEWAY_HTTP_URL, { redirect: "manual" });
    record("Gateway HTTP 127.0.0.1:18789", "PASS", `status=${response.status} ${response.statusText}`);
    return true;
  } catch (error) {
    record("Gateway HTTP 127.0.0.1:18789", "FAIL", error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkModelsEndpoint() {
  try {
    const response = await fetchWithTimeout(`${GATEWAY_HTTP_URL}/v1/models`, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    const contentType = response.headers.get("content-type") || "unknown";
    const body = await response.text();
    let summary = `status=${response.status} ${response.statusText}; content-type=${contentType}`;
    const lowerBody = body.toLowerCase();
    const looksLikeControlUi = contentType.includes("text/html")
      || lowerBody.includes("openclaw-app")
      || lowerBody.includes("openclaw control ui")
      || lowerBody.includes("control ui");

    if (body && contentType.includes("application/json")) {
      try {
        const json = JSON.parse(body);
        const data = Array.isArray(json?.data) ? json.data : [];
        const ids = data.map((item) => item?.id).filter(Boolean).slice(0, 5);
        summary += `; models=${data.length}`;
        if (ids.length > 0) summary += `; sample=${ids.join(", ")}`;
      } catch {
        summary += "; json=parse_failed";
      }
    } else if (looksLikeControlUi) {
      summary += "; html_fallback=possible_control_ui; api_confirmed=false";
      summary += `; body=${sanitize(body).slice(0, 160)}`;
    } else if (body) {
      summary += `; body=${sanitize(body).slice(0, 160)}`;
    }

    if (response.status === 401 || response.status === 403) {
      record("GET /v1/models", "WARN", `${summary}; endpoint_reachable=true; auth_required=true`);
      return true;
    }

    if (looksLikeControlUi) {
      record("GET /v1/models", "WARN", summary);
      return true;
    }

    const isJsonApi = response.status >= 200 && response.status < 300 && contentType.includes("application/json");
    record("GET /v1/models", isJsonApi ? "PASS" : "WARN", `${summary}; api_confirmed=${isJsonApi}`);
    return isJsonApi;
  } catch (error) {
    record("GET /v1/models", "FAIL", error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkWebSocket() {
  if (typeof WebSocket === "undefined") {
    record("Gateway WebSocket", "WARN", "global WebSocket is unavailable in this Node runtime; use Node 22+ or 24+ for this check.");
    return true;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let receivedChallenge = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch { /* noop */ }
      record("Gateway WebSocket", receivedChallenge ? "PASS" : "WARN", receivedChallenge ? "connected and received connect.challenge" : "connected timeout before connect.challenge");
      resolve(receivedChallenge);
    }, TIMEOUT_MS);

    const socket = new WebSocket(GATEWAY_WS_URL);

    socket.addEventListener("open", () => {
      record("WebSocket TCP connect", "PASS", GATEWAY_WS_URL);
    });

    socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      let detail = text.slice(0, 240);
      try {
        const json = JSON.parse(text);
        if (json?.type === "event" && json?.event === "connect.challenge") {
          receivedChallenge = true;
          detail = "received connect.challenge";
        } else {
          detail = `received ${json?.type ?? "unknown"}/${json?.event ?? json?.method ?? "unknown"}`;
        }
      } catch {
        detail = sanitize(detail);
      }
      if (!settled && receivedChallenge) {
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* noop */ }
        record("Gateway WebSocket", "PASS", detail);
        resolve(true);
      }
    });

    socket.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      record("Gateway WebSocket", "FAIL", "WebSocket connection error");
      resolve(false);
    });

    socket.addEventListener("close", (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const status = receivedChallenge ? "PASS" : "FAIL";
      record("Gateway WebSocket", status, `closed code=${event.code}; reason=${sanitize(event.reason || "none")}; challenge=${receivedChallenge}`);
      resolve(receivedChallenge);
    });
  });
}

async function main() {
  console.log("OpenClaw Gateway smoke test");
  console.log("Read-only checks only. This script does not read .env, does not print tokens, and does not modify OpenClaw config.\n");

  const cliOk = await checkCli();
  if (cliOk) await checkGatewayStatus();
  await checkHttpPort();
  await checkModelsEndpoint();
  await checkWebSocket();

  await delay(50);

  for (const result of results) {
    const prefix = result.status.padEnd(4, " ");
    console.log(`[${prefix}] ${result.name}`);
    if (result.detail) {
      for (const line of result.detail.split(/\r?\n/).filter(Boolean)) {
        console.log(`       ${line}`);
      }
    }
  }

  const failed = results.filter((result) => result.status === "FAIL");
  if (failed.length > 0) {
    console.error(`\nSmoke test finished with ${failed.length} failure(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("\nSmoke test completed without hard failures.");
}

main().catch((error) => {
  console.error(sanitize(error instanceof Error ? error.stack || error.message : String(error)));
  process.exitCode = 1;
});
