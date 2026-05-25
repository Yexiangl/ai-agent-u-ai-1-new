#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GATEWAY_WS_URL = "ws://127.0.0.1:18789";
const TIMEOUT_MS = 15000;
const RPC_TIMEOUT_MS = 8000;
const RETRY_INTERVAL_MS = 3000;
const MAX_RETRIES = 40; // ~2 min total

// Persistent identity in a stable location (NOT /tmp — survives reboots).
const IDENTITY_PATH = path.join(os.homedir(), ".openclaw-agents", "ai-agent-workspace-pairing-probe-device.json");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

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

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeText(value) : value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/token|authorization|password|secret|apikey|apiKey|privateKey|signature$/i.test(key)) {
      out[key] = raw ? "[REDACTED]" : raw;
    } else {
      out[key] = redact(raw);
    }
  }
  return out;
}

function compactJson(value, max = 1000) {
  const json = JSON.stringify(redact(value));
  return sanitizeText(json.length > max ? `${json.slice(0, max)}...` : json);
}

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function sha256Prefix(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

// ── Identity ──
function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function deriveDeviceId(publicKeyPem) {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function loadOrCreateIdentity() {
  try {
    const parsed = JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"));
    if (parsed?.version === 2 && typeof parsed.publicKeyPem === "string" && typeof parsed.privateKeyPem === "string") {
      const deviceId = deriveDeviceId(parsed.publicKeyPem);
      if (deviceId === parsed.deviceId) return { ...parsed, deviceId, created: false };
    }
  } catch { /* create below */ }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const identity = {
    version: 2,
    deviceId: deriveDeviceId(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    createdAtMs: Date.now(),
  };
  fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(IDENTITY_PATH, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return { ...identity, created: true };
}

// ── Gateway token ──
function loadGatewayToken() {
  // 1. Env var (user override)
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (envToken) {
    record("gateway token source", "INFO", `env OPENCLAW_GATEWAY_TOKEN; length=${envToken.length}; sha256_prefix=${sha256Prefix(envToken)}`);
    return envToken;
  }
  // 2. OpenClaw config file (read into memory only, never printed)
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const token = cfg?.gateway?.auth?.token;
    if (typeof token === "string" && token.trim() && !token.includes("REDACTED")) {
      record("gateway token source", "INFO", `~/.openclaw/openclaw.json; length=${token.length}; sha256_prefix=${sha256Prefix(token)}`);
      return token.trim();
    }
  } catch { /* fall through */ }
  record("gateway token source", "FAIL", "no token found in env or config");
  return null;
}

// ── Connect ──
function buildDeviceAuthPayloadV3(params) {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.signatureToken ?? "",
    params.nonce,
    params.platform ?? "",
    params.deviceFamily ?? "",
  ].join("|");
}

function signPayload(privateKeyPem, payload) {
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem)));
}

function createConnectFrame(id, nonce, identity, gatewayToken) {
  const role = "operator";
  const scopes = ["operator.read"];
  const client = {
    id: "gateway-client",
    displayName: "AI Agent Workspace Pairing Probe",
    version: "0.1.1",
    platform: process.platform,
    mode: "backend",
  };
  const signedAtMs = Date.now();
  const signaturePayload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: client.id,
    clientMode: client.mode,
    role,
    scopes,
    signedAtMs,
    signatureToken: gatewayToken,
    nonce,
    platform: client.platform,
  });

  return {
    type: "req",
    id,
    method: "connect",
    params: {
      minProtocol: 4,
      maxProtocol: 4,
      client,
      role,
      scopes,
      caps: [],
      commands: [],
      permissions: {},
      auth: { token: gatewayToken },
      locale: "en-US",
      userAgent: "ai-agent-workspace-pairing-probe/0.1.1",
      device: {
        id: identity.deviceId,
        publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
        signature: signPayload(identity.privateKeyPem, signaturePayload),
        signedAt: signedAtMs,
        nonce,
      },
    },
  };
}

function summarizeHelloOk(helloOk) {
  const methods = Array.isArray(helloOk?.features?.methods) ? helloOk.features.methods : [];
  const events = Array.isArray(helloOk?.features?.events) ? helloOk.features.events : [];
  return [
    `protocol=${helloOk?.protocol ?? "unknown"}`,
    `server.version=${helloOk?.server?.version ?? "unknown"}`,
    `methods.count=${methods.length}; methods.sample=${methods.filter((m) => typeof m === "string").slice(0, 12).join(", ")}`,
    `events.count=${events.length}; events.sample=${events.filter((e) => typeof e === "string").slice(0, 12).join(", ")}`,
    `auth=${compactJson({ role: helloOk?.auth?.role, scopes: helloOk?.auth?.scopes, hasDeviceToken: Boolean(helloOk?.auth?.deviceToken) })}`,
  ].join("\n");
}

function summarizeRpcPayload(method, payload) {
  if (method === "skills.status") {
    const skills = Array.isArray(payload?.skills) ? payload.skills : Array.isArray(payload?.entries) ? payload.entries : [];
    const sample = skills.map((s) => s?.name || s?.slug || s?.id).filter(Boolean).slice(0, 10);
    return `skills.count=${skills.length}; skills.sample=${sample.join(", ")}`;
  }
  if (method === "models.list") {
    const models = Array.isArray(payload?.models) ? payload.models : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const sample = models.map((m) => m?.id || m?.model || m?.name).filter(Boolean).slice(0, 10);
    return `models.count=${models.length}; models.sample=${sample.join(", ")}`;
  }
  return compactJson(payload, 900);
}

async function connectToGateway(identity, gatewayToken) {
  return new Promise((resolve) => {
    const socket = new WebSocket(GATEWAY_WS_URL);
    let seq = 0;
    const nextId = (prefix) => `${prefix}-${Date.now()}-${++seq}`;
    let challengeNonce = null;
    let resolved = false;

    const done = (result) => {
      if (resolved) return;
      resolved = true;
      try { socket.close(); } catch { /* ok */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ ok: false, hardFailure: true, error: "connect timeout" });
    }, TIMEOUT_MS);

    socket.addEventListener("open", () => {
      record("pairing WS connect", "PASS", GATEWAY_WS_URL);
    });

    socket.addEventListener("message", (event) => {
      let frame;
      try {
        frame = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }

      if (frame?.type === "event" && frame.event === "connect.challenge") {
        const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce.trim() : "";
        challengeNonce = nonce;
        record("pairing connect.challenge", nonce ? "PASS" : "FAIL",
          nonce ? "nonce present" : "nonce missing");
        if (!nonce) {
          done({ ok: false, error: "no nonce in challenge" });
          return;
        }
        const connectFrame = createConnectFrame(nextId("connect"), nonce, identity, gatewayToken);
        record("pairing connect frame", "INFO", compactJson({
          id: connectFrame.id,
          method: connectFrame.method,
          clientId: connectFrame.params.client.id,
          deviceId: identity.deviceId.slice(0, 12) + "...",
          auth_token_present: true,
        }));
        socket.send(JSON.stringify(connectFrame));
        return;
      }

      if (frame?.type === "res") {
        clearTimeout(timer);
        if (frame.ok) {
          record("pairing connect hello-ok", "PASS", summarizeHelloOk(frame.payload));
          done({ ok: true, helloOk: frame.payload });
        } else {
          const err = frame.error;
          err._raw = structuredClone(err); // preserve raw for diagnostics
          record("pairing connect response", "WARN", compactJson({
            code: err.code,
            message: err.message,
            details_code: err.details?.code,
            recommendedNextStep: err.details?.recommendedNextStep,
            requestId: err.details?.requestId,
          }));
          done({ ok: false, gatewayError: err });
        }
        return;
      }
    });

    socket.addEventListener("error", () => {
      done({ ok: false, hardFailure: true, error: "WebSocket error" });
    });

    socket.addEventListener("close", (event) => {
      if (!resolved) {
        done({ ok: false, hardFailure: true, error: `WS closed code=${event.code}` });
      }
    });
  });
}

async function runMinimalRpc(helloOk, gatewayToken, identity) {
  // We need a new WS connection for RPC since the connect socket was closed.
  // Reconnect using the device token from hello-ok if available.
  const deviceToken = helloOk?.auth?.deviceToken;
  const auth = deviceToken ? { deviceToken } : { token: gatewayToken };

  return new Promise((resolve) => {
    const socket = new WebSocket(GATEWAY_WS_URL);
    let seq = 0;
    const nextId = (prefix) => `${prefix}-${Date.now()}-${++seq}`;
    const pending = new Map();
    let resolved = false;
    let challengeNonce = null;

    const done = (msg) => {
      if (resolved) return;
      resolved = true;
      try { socket.close(); } catch { /* ok */ }
      resolve(msg);
    };

    setTimeout(() => done("RPC session timeout"), RPC_TIMEOUT_MS * 2);

    socket.addEventListener("message", (event) => {
      let frame;
      try { frame = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch { return; }

      if (frame?.type === "event" && frame.event === "connect.challenge") {
        challengeNonce = frame.payload?.nonce?.trim();
        if (!challengeNonce) { done("no nonce"); return; }
        const connFrame = createConnectFrame(nextId("rpc-connect"), challengeNonce, identity, gatewayToken);
        socket.send(JSON.stringify(connFrame));
        return;
      }

      if (frame?.type === "res") {
        const item = pending.get(frame.id);
        if (frame.id?.startsWith("rpc-connect")) {
          // This is the connect response for RPC session
          if (frame.ok) {
            record("RPC session hello-ok", "PASS", "reconnected for RPC");
            // Now call RPC methods
            const methods = Array.isArray(frame.payload?.features?.methods)
              ? new Set(frame.payload.features.methods) : new Set();
            callRpcMethods(socket, methods, nextId, pending);
          } else {
            record("RPC session connect", "WARN", `failed: ${frame.error?.code}`);
            done("RPC session connect failed");
          }
          return;
        }
        if (!item) return;
        pending.delete(frame.id);
        clearTimeout(item.timer);
        if (frame.ok) item.resolve(frame.payload);
        else item.reject(new Error(frame.error?.code || "rpc error"));
      }
    });

    socket.addEventListener("error", () => done("RPC WS error"));
    socket.addEventListener("close", () => { /* handled by timer */ });
  });
}

function callRpcMethods(socket, methods, nextId, pending) {
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    if (!methods.has(method)) {
      resolve({ skipped: true, reason: "not in features.methods" });
      return;
    }
    const id = nextId(method);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout"));
    }, RPC_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });

  const run = async () => {
    const rpcResults = [];

    for (const method of ["health", "status", "skills.status", "models.list"]) {
      try {
        const payload = await call(method, method === "models.list" ? { view: "configured" } : {});
        if (payload?.skipped) {
          record(`RPC ${method}`, "SKIP", payload.reason);
        } else {
          record(`RPC ${method}`, "PASS", summarizeRpcPayload(method, payload));
        }
        rpcResults.push({ method, ok: true });
      } catch (err) {
        record(`RPC ${method}`, "WARN", err.message || String(err));
        rpcResults.push({ method, ok: false, error: err.message });
      }
    }

    return rpcResults;
  };

  // Run RPC calls after a short delay for session stability
  setTimeout(() => {
    run().then((rpcResults) => {
      try { socket.close(); } catch { /* ok */ }
      const allOk = rpcResults.every((r) => r.ok);
      record("RPC summary", allOk ? "PASS" : "WARN",
        rpcResults.map((r) => `${r.method}=${r.ok ? "ok" : "fail"}`).join(", "));
    });
  }, 500);
}

// ── Main ──
async function main() {
  console.log("OpenClaw Device Pairing Flow Probe");
  console.log("Read-only except for: creating device identity, attempting WebSocket connect.\n");

  // 1. Identity
  const identity = loadOrCreateIdentity();
  record("device identity", "INFO",
    `deviceId=${identity.deviceId.slice(0, 16)}...; ` +
    `persisted=${IDENTITY_PATH}; created=${identity.created}`);

  // 2. Gateway token
  const gatewayToken = loadGatewayToken();
  if (!gatewayToken) {
    record("pairing flow", "FAIL", "no gateway token available");
    record("how to fix", "INFO",
      "Set OPENCLAW_GATEWAY_TOKEN env var, or ensure ~/.openclaw/openclaw.json has gateway.auth.token");
    printResults();
    return;
  }

  // 3. Connect
  console.log("Connecting to Gateway...\n");
  const result = await connectToGateway(identity, gatewayToken);

  if (result.ok) {
    // Already paired — hello-ok received!
    record("pairing flow", "PASS", "device already paired; hello-ok received");
    console.log("\nDevice is already paired! Running minimal RPC...\n");
    await runMinimalRpc(result.helloOk, gatewayToken, identity);
    printResults();
    return;
  }

  if (result.hardFailure) {
    record("pairing flow", "FAIL", result.error || "hard failure");
    printResults();
    return;
  }

  // 4. Check error type
  const err = result.gatewayError;
  const details = err?.details || {};
  const code = err?.code;
  const detailsCode = details?.code;
  const requestId = details?.requestId;
  const nextStep = details?.recommendedNextStep;

  if (code === "AUTH_TOKEN_MISMATCH") {
    record("pairing flow", "FAIL", "gateway token mismatch — token from config/env does not match Gateway");
    record("how to fix", "INFO", "Verify OPENCLAW_GATEWAY_TOKEN or ~/.openclaw/openclaw.json gateway.auth.token matches Gateway config");
    printResults();
    return;
  }

  if (detailsCode === "DEVICE_IDENTITY_REQUIRED" || code === "NOT_PAIRED" || detailsCode === "NOT_PAIRED") {
    // Need pairing
    if (requestId) {
      record("pairing requestId", "INFO", requestId);
      console.log("\n╔══════════════════════════════════════════════════════════╗");
      console.log("║  DEVICE PAIRING REQUIRED                                 ║");
      console.log("╠══════════════════════════════════════════════════════════╣");
      console.log(`║  Request ID: ${requestId}`);
      console.log("║                                                          ║");
      console.log("║  Approve this device by running:                         ║");
      console.log(`║  openclaw devices approve ${requestId}`);
      console.log("║                                                          ║");
      console.log("║  Or open Control UI: http://127.0.0.1:18789             ║");
      console.log("╚══════════════════════════════════════════════════════════╝\n");
      record("pairing action required", "INFO", `openclaw devices approve ${requestId}`);

      // 5. Wait for approval with retry
      console.log("Waiting for device approval (polling every 3s, max 2 min)...\n");
      let approved = false;
      for (let i = 1; i <= MAX_RETRIES; i++) {
        await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
        process.stdout.write(`  Retry ${i}/${MAX_RETRIES}... `);
        const retryResult = await connectToGateway(identity, gatewayToken);
        if (retryResult.ok) {
          console.log("SUCCESS — hello-ok received!\n");
          approved = true;
          record("pairing retry", "PASS", `hello-ok after ${i} retries`);
          record("pairing flow", "PASS", "device approved and hello-ok received");
          console.log("Running minimal RPC...\n");
          await runMinimalRpc(retryResult.helloOk, gatewayToken, identity);
          break;
        }
        if (retryResult.hardFailure) {
          console.log("connection failed");
          continue;
        }
        const rErr = retryResult.gatewayError;
        const rCode = rErr?.details?.code || rErr?.code;
        console.log(`${rCode || "error"}`);
        if (rCode === "NOT_PAIRED" || rCode === "DEVICE_PAIRING_REQUIRED") {
          continue; // still waiting
        }
        // Some other error
        record("pairing retry", "WARN", `retry ${i}: ${rCode} — ${sanitizeText(rErr?.message || "")}`);
      }

      if (!approved) {
        record("pairing flow", "FAIL", "approval not received within timeout");
        record("how to fix", "INFO", `Re-run this script after approving: openclaw devices approve ${requestId}`);
      }
    } else {
      record("pairing flow", "FAIL", "NOT_PAIRED but no requestId in response");
      record("how to fix", "INFO", "Check openclaw devices list for pending requests");
    }
    printResults();
    return;
  }

  // Unrecognized error
  record("pairing flow", "FAIL", `unexpected: code=${code}; detailsCode=${detailsCode}; nextStep=${nextStep}`);
  record("raw error", "INFO", compactJson(err));
  printResults();
}

function printResults() {
  console.log("\n── Results ──\n");
  for (const r of results) {
    console.log(`[${r.status.padEnd(4, " ")}] ${r.name}`);
    if (r.detail) for (const line of r.detail.split(/\r?\n/).filter(Boolean)) console.log(`       ${line}`);
  }
  const failed = results.filter((r) => r.status === "FAIL");
  if (failed.length > 0) {
    console.error(`\n${failed.length} failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nDone.");
  }
}

if (typeof WebSocket === "undefined") {
  console.error("global WebSocket unavailable; use Node 22+");
  process.exit(1);
}

main();
