#!/usr/bin/env node

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IDENTITY_PATH = process.env.OPENCLAW_AUTH_PROBE_IDENTITY
  || path.join(os.tmpdir(), "ai-agent-workspace-openclaw-auth-probe-device.json");

const results = [];

function record(name, status, detail = "") {
  results.push({ name, status, detail: sanitizeText(detail) });
}

function sanitizeText(text) {
  return String(text ?? "")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:gateway[-_\s]?token|device[-_\s]?token|provider[-_\s]?key|api[-_\s]?key|password|secret)\s*[:=]\s*)[^\s,}"']+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|gsk|sk-or|sk-ant|sk-proj)-[A-Za-z0-9_\-]{8,}\b/g, "[REDACTED]");
}

function tryJson(cmd, label) {
  try {
    const raw = execSync(cmd, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!raw) return { ok: false, error: "empty output" };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: true, raw };
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function sha256Prefix(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function loadProbeIdentity() {
  try {
    return JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
  } catch {
    return null;
  }
}

// ── Step 1: Gateway auth mode & token source ──
console.log("=== Step 1: Gateway auth mode & token source ===\n");

// 1a. Auth mode
const authMode = tryJson("openclaw config get gateway.auth.mode", "auth-mode");
if (authMode.ok) {
  record("gateway.auth.mode", "INFO", String(authMode.raw || authMode.value));
} else {
  record("gateway.auth.mode", "FAIL", authMode.error);
}

// 1b. Auth token (CLI redacts this — normal)
const authToken = tryJson("openclaw config get gateway.auth.token", "auth-token");
const isRedacted = authToken.ok && String(authToken.raw || authToken.value).includes("REDACTED");
record("gateway.auth.token config get", "INFO",
  isRedacted
    ? "CLI redacts output; cannot read token via config get"
    : `token present (unexpected: not redacted)`);

// 1c. Environment variable token
const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
if (envToken) {
  record("OPENCLAW_GATEWAY_TOKEN env", "INFO",
    `present; length=${envToken.length}; trimmed_length=${envToken.trim().length}; has_newline=${envToken.length !== envToken.trim().length}; sha256_prefix=${sha256Prefix(envToken)}`);
} else {
  record("OPENCLAW_GATEWAY_TOKEN env", "INFO", "not set");
}

// 1d. Compare: if both env and config token exist, compare hash prefix
// (config get returns REDACTED, so we can only compare when we have env token)
const gatewayAuth = tryJson("openclaw config get gateway.auth", "gateway-auth");
if (gatewayAuth.ok && gatewayAuth.value) {
  const gwMode = gatewayAuth.value?.mode || "unknown";
  const hasToken = gatewayAuth.value?.token && !String(gatewayAuth.value.token).includes("REDACTED");
  record("gateway.auth config", "INFO", `mode=${gwMode}; token_in_config=${hasToken ? "present (not redacted)" : "redacted"}`);
}
console.log("");

// ── Step 2: Gateway connectivity (CLI's own session) ──
console.log("=== Step 2: Gateway connectivity (CLI's own session) ===\n");

const gwStatus = tryJson("openclaw gateway status --json", "gateway-status");
if (gwStatus.ok && gwStatus.value) {
  const rpc = gwStatus.value.rpc;
  record("gateway.status rpc.ok", "INFO", String(rpc?.ok ?? "unknown"));
  record("gateway.status rpc.kind", "INFO", String(rpc?.kind ?? "unknown"));
  record("gateway.status rpc.auth.role", "INFO", String(rpc?.auth?.role ?? "unknown"));
  record("gateway.status rpc.auth.scopes", "INFO", JSON.stringify(rpc?.auth?.scopes ?? []));
  record("gateway.status rpc.server.version", "INFO", String(rpc?.server?.version ?? "unknown"));
  record("gateway.status port", "INFO", String(gwStatus.value.gateway?.port ?? "unknown"));
  record("gateway.status bind", "INFO", String(gwStatus.value.gateway?.bindMode ?? "unknown"));
} else {
  record("gateway.status", "FAIL", gwStatus.error);
}
console.log("");

// ── Step 3: Device pairing status ──
console.log("=== Step 3: Device pairing status ===\n");

const devices = tryJson("openclaw devices list --json", "devices-list");
if (devices.ok && devices.value) {
  const paired = Array.isArray(devices.value.paired) ? devices.value.paired : [];
  const pending = Array.isArray(devices.value.pending) ? devices.value.pending : [];

  record("devices paired count", "INFO", String(paired.length));
  record("devices pending count", "INFO", String(pending.length));

  for (const d of paired) {
    record("paired device", "INFO",
      `deviceId=${(d.deviceId || "").slice(0, 12)}...; clientId=${d.clientId}; clientMode=${d.clientMode}; role=${d.role}; scopes=${JSON.stringify(d.scopes || [])}; approvedScopes=${JSON.stringify(d.approvedScopes || [])}; tokenCount=${Array.isArray(d.tokens) ? d.tokens.length : 0}`);
  }

  for (const p of pending) {
    record("pending request", "INFO",
      `requestId=${p.requestId}; deviceId=${(p.deviceId || "").slice(0, 12)}...; clientId=${p.clientId}; clientMode=${p.clientMode}; role=${p.role}; scopes=${JSON.stringify(p.scopes || [])}; isRepair=${p.isRepair}`);
  }
} else {
  record("devices list", "FAIL", devices.error);
}
console.log("");

// ── Step 4: Probe identity vs CLI identity ──
console.log("=== Step 4: Probe identity vs CLI identity ===\n");

const probeIdentity = loadProbeIdentity();
if (probeIdentity) {
  record("probe identity", "INFO",
    `deviceId=${probeIdentity.deviceId}; persisted=${IDENTITY_PATH}; created=${probeIdentity.created || false}`);
} else {
  record("probe identity", "INFO", "not yet created (run auth-probe first)");
}

// Compare probe deviceId to paired/pending deviceIds
if (probeIdentity && devices.ok && devices.value) {
  const allPaired = Array.isArray(devices.value.paired) ? devices.value.paired : [];
  const allPending = Array.isArray(devices.value.pending) ? devices.value.pending : [];

  const probePaired = allPaired.find((d) => d.deviceId === probeIdentity.deviceId);
  const probePending = allPending.find((d) => d.deviceId === probeIdentity.deviceId);

  if (probePaired) {
    record("probe device pairing status", "PASS",
      `PAIRED; clientId=${probePaired.clientId}; clientMode=${probePaired.clientMode}; scopes=${JSON.stringify(probePaired.scopes)}`);
  } else if (probePending) {
    record("probe device pairing status", "WARN",
      `PENDING; requestId=${probePending.requestId}; scopes=${JSON.stringify(probePending.scopes)}`);
  } else {
    record("probe device pairing status", "FAIL",
      "NOT paired and NOT pending — probe identity is unknown to Gateway");
  }
}
console.log("");

// ── Step 5: Auth flow mapping ──
console.log("=== Step 5: Auth flow mapping ===\n");

record("AUTH_TOKEN_MISMATCH meaning", "INFO",
  "Gateway token provided does not match config gateway.auth.token");
record("DEVICE_IDENTITY_REQUIRED meaning", "INFO",
  "No device identity in connect frame (or identity not recognized)");
record("NOT_PAIRED meaning", "INFO",
  "Device identity present but not in paired table");
record("canRetryWithDeviceToken=true meaning", "INFO",
  "Boolean capability flag: Gateway supports device-token retry. NOT a token value.");
record("recommendedNextStep=retry_with_device_token", "INFO",
  "Gateway recommends: use a paired device token instead of gateway auth token");

// Determine what the CLI uses to connect
if (gwStatus.ok && gwStatus.value?.rpc?.ok) {
  record("CLI connect method", "INFO",
    "CLI connects using its own paired device identity (~/.openclaw/identity/), not gateway token");
}
console.log("");

// ── Step 6: Token source summary ──
console.log("=== Step 6: Token source summary ===\n");

record("gateway token location", "INFO", "~/.openclaw/openclaw.json → gateway.auth.token (CLI redacts on read)");
record("CLI device identity location", "INFO", "~/.openclaw/identity/device.json + device-auth.json");
record("probe device identity location", "INFO", IDENTITY_PATH);
record("Control UI", "INFO", "http://127.0.0.1:18789 — Control UI has allowInsecureAuth=true in loopback mode");
record("device pairing CLI", "INFO",
  "openclaw devices approve <requestId> --token <gateway-token> (requires gateway token from config)");
console.log("");

// ── Step 7: Implications for product ──
console.log("=== Step 7: Product implications ===\n");

record("onboarding needs gateway token", "WARN",
  "Yes — gateway.auth.mode=token requires gateway token for initial device pairing");
record("CLI redacts token", "INFO",
  "openclaw config get gateway.auth.token returns __OPENCLAW_REDACTED__; user must find token via Control UI or config file");
record("Control UI token source", "INFO",
  "Control UI has allowInsecureAuth=true on loopback; user may be able to find token in UI → Settings → Infrastructure");
record("device token reuse", "INFO",
  "Once a device is paired, it receives a device-specific token (stored in ~/.openclaw/devices/paired.json). This token can be used for future connects instead of gateway token.");
record("OpenClawBackend strategy", "INFO",
  "Recommended: use CLI's own identity OR create a persistent App identity + pair it once. Gateway token only needed for initial pairing.");

// ── Output ──
console.log("OpenClaw Gateway auth source probe\n");
for (const result of results) {
  console.log(`[${result.status.padEnd(4, " ")}] ${result.name}`);
  if (result.detail) {
    for (const line of result.detail.split(/\r?\n/).filter(Boolean)) {
      console.log(`       ${line}`);
    }
  }
}

const failed = results.filter((r) => r.status === "FAIL");
if (failed.length > 0) {
  console.error(`\nProbe finished with ${failed.length} failure(s).`);
  process.exitCode = 1;
} else {
  console.log("\nProbe completed.");
}
