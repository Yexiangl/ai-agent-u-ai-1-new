#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GATEWAY_WS_URL = process.env.OPENCLAW_GATEWAY_WS_URL || "ws://127.0.0.1:18789";
const TIMEOUT_MS = 10000;
const RPC_TIMEOUT_MS = 5000;
const IDENTITY_PATH = process.env.OPENCLAW_AUTH_PROBE_IDENTITY
  || path.join(os.tmpdir(), "ai-agent-workspace-openclaw-auth-probe-device.json");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const results = [];

function sanitizeText(text) {
  return String(text ?? "")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)[^\n]+/gi, "$1[REDACTED]")
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

function record(name, status, detail = "") {
  results.push({ name, status, detail: sanitizeText(detail) });
}

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

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
    if (parsed?.version === 1 && typeof parsed.publicKeyPem === "string" && typeof parsed.privateKeyPem === "string") {
      const deviceId = deriveDeviceId(parsed.publicKeyPem);
      if (deviceId === parsed.deviceId) return { ...parsed, deviceId, created: false };
    }
  } catch {
    // Generate below.
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const identity = {
    version: 1,
    deviceId: deriveDeviceId(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    createdAtMs: Date.now(),
  };
  fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(IDENTITY_PATH, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return { ...identity, created: true };
}

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

function createConnectFrame(id, nonce, identity, auth, opts) {
  const role = "operator";
  const scopes = ["operator.read"];
  const client = {
    id: opts?.clientId || "gateway-client",
    displayName: "AI Agent Workspace Auth Probe",
    version: "0.0.0-probe",
    platform: process.platform,
    mode: "backend",
  };
  const signedAtMs = Date.now();
  const effectiveNonce = opts?.overrideNonce ?? nonce;
  const signatureToken = auth.token ?? auth.deviceToken;
  const signaturePayload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: client.id,
    clientMode: client.mode,
    role,
    scopes,
    signedAtMs,
    signatureToken,
    nonce: effectiveNonce,
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
      auth,
      locale: "en-US",
      userAgent: "ai-agent-workspace-openclaw-auth-probe/0.0.0",
      device: {
        id: identity.deviceId,
        publicKey: base64UrlEncode(derivePublicKeyRaw(identity.publicKeyPem)),
        signature: signPayload(identity.privateKeyPem, signaturePayload),
        signedAt: signedAtMs,
        nonce: effectiveNonce,
      },
    },
  };
}

function summarizeArray(items, max = 12) {
  if (!Array.isArray(items)) return { count: 0, sample: [] };
  return { count: items.length, sample: items.filter((item) => typeof item === "string").slice(0, max) };
}

function summarizeHelloOk(helloOk) {
  const methods = summarizeArray(helloOk?.features?.methods);
  const helloEvents = summarizeArray(helloOk?.features?.events);
  return [
    `protocol=${helloOk?.protocol ?? "unknown"}`,
    `server.version=${helloOk?.server?.version ?? "unknown"}`,
    `methods.count=${methods.count}; methods.sample=${methods.sample.join(", ")}`,
    `events.count=${helloEvents.count}; events.sample=${helloEvents.sample.join(", ")}`,
    `auth=${compactJson({ role: helloOk?.auth?.role, scopes: helloOk?.auth?.scopes, hasDeviceToken: Boolean(helloOk?.auth?.deviceToken), extraDeviceTokens: Array.isArray(helloOk?.auth?.deviceTokens) ? helloOk.auth.deviceTokens.length : 0 })}`,
    `policy=${compactJson(helloOk?.policy)}`,
  ].join("\n");
}

function summarizeRpcPayload(method, payload) {
  if (method === "skills.status") {
    const skills = Array.isArray(payload?.skills) ? payload.skills : Array.isArray(payload?.entries) ? payload.entries : [];
    const sample = skills.map((item) => item?.name || item?.slug || item?.id || item?.key).filter(Boolean).slice(0, 10);
    return `skills.count=${skills.length}; skills.sample=${sample.join(", ")}; keys=${payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12).join(", ") : "none"}`;
  }
  if (method === "models.list") {
    const models = Array.isArray(payload?.models) ? payload.models : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const sample = models.map((item) => item?.id || item?.model || item?.name).filter(Boolean).slice(0, 10);
    return `models.count=${models.length}; models.sample=${sample.join(", ")}; keys=${payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12).join(", ") : "none"}`;
  }
  return compactJson(payload, 900);
}

const INVALID_TOKEN_VALUES = new Set([
  "retry_with_device_token",
  "update_auth_credentials",
  "true",
  "false",
  "[REDACTED]",
]);

function isInvalidTokenValue(raw) {
  if (typeof raw !== "string") return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (INVALID_TOKEN_VALUES.has(trimmed)) return true;
  if (trimmed.includes("REDACTED")) return true;
  return false;
}

function extractRetryDeviceToken(details, labelForDiagnostics) {
  if (!details || typeof details !== "object") return null;
  // STRICT extraction: only known field names. No heuristic scanning.
  // Heuristic scanning was picking up recommendedNextStep="retry_with_device_token"
  // as a false positive device token candidate.
  const knownFields = [
    "canRetryWithDeviceToken",
    "deviceToken",
    "retryDeviceToken",
    "authDeviceToken",
  ];
  const tag = labelForDiagnostics || "extract";
  for (const field of knownFields) {
    const candidate = details[field];
    if (typeof candidate === "string" && candidate.trim()) {
      if (isInvalidTokenValue(candidate)) {
        console.warn(`[${tag}] field ${field} rejected: value looks like system string, not a token`);
        continue;
      }
      return candidate.trim();
    }
  }
  return null;
}

function diagnoseCanRetryWithDeviceToken(details) {
  if (!details || typeof details !== "object") {
    record("canRetryWithDeviceToken present", "INFO", "false; details not an object");
    return;
  }
  const raw = details.canRetryWithDeviceToken;
  const present = raw !== undefined;
  const type = typeof raw;
  const isBool = type === "boolean";
  const isStr = type === "string";
  record("canRetryWithDeviceToken present", "INFO", String(present));
  record("canRetryWithDeviceToken typeof", "INFO", type);
  record("canRetryWithDeviceToken is_boolean", "INFO", String(isBool));
  record("canRetryWithDeviceToken is_string", "INFO", String(isStr));
  if (isStr) {
    const len = raw.length;
    record("canRetryWithDeviceToken length", "INFO", String(len));
    record("canRetryWithDeviceToken value_is_boolean_literal", "INFO", String(raw === "true" || raw === "false"));
    const looksLikeNextStep =
      raw === "retry_with_device_token"
      || raw === "update_auth_credentials"
      || /^[a-z_]+$/.test(raw) && len < 40;
    record("canRetryWithDeviceToken looks_like_next_step", "INFO", String(looksLikeNextStep));
    record("canRetryWithDeviceToken is_redacted_literal", "INFO", String(raw === "[REDACTED]" || raw.includes("REDACTED")));
    if (!looksLikeNextStep && raw !== "[REDACTED]" && !raw.includes("REDACTED")) {
      record("canRetryWithDeviceToken likely_valid_token", "INFO", "true");
    } else {
      record("canRetryWithDeviceToken likely_valid_token", "INFO", "false");
    }
  }
  if (isBool) {
    record("canRetryWithDeviceToken value", "INFO", String(raw));
  }
  const detailsKeys = Object.keys(details).filter(
    (k) => !/token|authorization|password|secret|apikey|api_key/i.test(k)
  );
  record("details non-sensitive keys", "INFO", JSON.stringify(detailsKeys));
}

function diagnoseDeviceToken(label, rawToken) {
  if (!rawToken || typeof rawToken !== "string") {
    record(`device-token ${label} type`, "INFO", `type=${typeof rawToken}; not a string`);
    return;
  }
  const len = rawToken.length;
  const isRedactedLiteral = rawToken === "[REDACTED]" || rawToken.includes("REDACTED");
  const sha256Full = crypto.createHash("sha256").update(rawToken).digest("hex");
  const sha256Prefix = sha256Full.slice(0, 8);
  // Non-sensitive structure hints only.
  const hasDot = rawToken.includes(".");
  const segments = rawToken.split(".").length;
  const firstChar = rawToken.charAt(0);
  const lastChar = rawToken.charAt(rawToken.length - 1);
  const prefix2 = rawToken.slice(0, 2);
  record(`device-token ${label} type`, "INFO", "string");
  record(`device-token ${label} length`, "INFO", String(len));
  record(`device-token ${label} sha256_prefix`, "INFO", sha256Prefix);
  record(`device-token ${label} is_redacted_literal`, "INFO", String(isRedactedLiteral));
  record(`device-token ${label} structure`, "INFO", `segments=${segments}; hasDot=${hasDot}; firstChar=${sanitizeText(firstChar)}; lastChar=${sanitizeText(lastChar)}; prefix2=${sanitizeText(prefix2)}`);
}

function shouldRetryWithDeviceToken(error) {
  if (!error || typeof error !== "object") return false;
  const details = error?.details;
  if (!details || typeof details !== "object") return false;
  return details.recommendedNextStep === "retry_with_device_token"
    || details.canRetryWithDeviceToken === true
    || typeof details.canRetryWithDeviceToken === "string"
    || details.code === "AUTH_TOKEN_MISMATCH";
}

async function connectOnce({ label, identity, auth, keepSocketOnError }) {
  const pending = new Map();
  const events = [];
  let seq = 0;
  let helloOk = null;
  let socket;
  let challengeNonce = null;
  const nextId = (prefix) => `${prefix}-${Date.now()}-${++seq}`;

  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId(method.replace(/[^a-z0-9]/gi, "-"));
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`RPC timeout for ${method}`));
    }, RPC_TIMEOUT_MS);
    pending.set(id, { method, resolve, reject, timer });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });

  const connected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} WebSocket auth probe timeout`)), TIMEOUT_MS);
    socket = new WebSocket(GATEWAY_WS_URL);

    socket.addEventListener("open", () => record(`${label} WebSocket TCP connect`, "PASS", GATEWAY_WS_URL));

    socket.addEventListener("message", (event) => {
      let frame;
      try {
        frame = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch (error) {
        record(`${label} frame parse`, "WARN", error instanceof Error ? error.message : String(error));
        return;
      }

      if (frame?.type === "event") {
        events.push(frame.event);
        if (frame.event === "connect.challenge") {
          const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce.trim() : "";
          challengeNonce = nonce;
          record(`${label} connect.challenge`, nonce ? "PASS" : "FAIL", compactJson({ payloadKeys: frame.payload && typeof frame.payload === "object" ? Object.keys(frame.payload) : [], nonce: nonce ? "present" : "missing", ts: frame.payload?.ts }));
          if (!nonce) return;
          const connectFrame = createConnectFrame(nextId("connect"), nonce, identity, auth);
          pending.set(connectFrame.id, {
            method: "connect",
            resolve: (payload) => {
              helloOk = payload;
              clearTimeout(timer);
              record(`${label} connect hello-ok`, "PASS", summarizeHelloOk(payload));
              resolve(payload);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
            timer: setTimeout(() => {
              pending.delete(connectFrame.id);
              reject(new Error(`${label} connect response timeout`));
            }, RPC_TIMEOUT_MS),
          });
          record(`${label} connect frame`, "PASS", compactJson({
            type: connectFrame.type,
            method: connectFrame.method,
            params: {
              ...connectFrame.params,
              auth: {
                token: auth.token ? "present-redacted" : undefined,
                deviceToken: auth.deviceToken ? "present-redacted" : undefined,
              },
              device: { id: connectFrame.params.device.id, publicKey: "present", signature: "present", signedAt: connectFrame.params.device.signedAt, nonce: "present" },
            },
          }));
          socket.send(JSON.stringify(connectFrame));
        }
        return;
      }

      if (frame?.type === "res") {
        const item = pending.get(frame.id);
        if (!item) return;
        pending.delete(frame.id);
        clearTimeout(item.timer);
        if (frame.ok) item.resolve(frame.payload);
        else {
          const err = new Error(`${item.method} failed: ${frame.error?.code ?? "UNKNOWN"}: ${frame.error?.message ?? "unknown error"}`);
          err.gatewayError = frame.error;
          // Pre-extract device token from RAW payload before any sanitize/redact.
          // This guarantees the token is captured even if downstream code calls
          // compactJson or redact on the error object.
          if (frame.error?.details && typeof frame.error.details === "object") {
            err._extractedDeviceToken = extractRetryDeviceToken(frame.error.details, "raw-res");
          }
          item.reject(err);
        }
      }
    });

    socket.addEventListener("error", () => reject(new Error(`${label} WebSocket connection error`)));
    socket.addEventListener("close", (event) => {
      if (!helloOk) reject(new Error(`${label} WebSocket closed before hello-ok code=${event.code}; reason=${sanitizeText(event.reason || "none")}`));
    });
  });

  try {
    await connected;
    return { ok: true, helloOk, request, socket, events };
  } catch (error) {
    if (!keepSocketOnError) {
      try { socket?.close(); } catch { /* noop */ }
    }
    if (error.gatewayError) {
      record(`${label} connect hello-ok`, "WARN", `not received; connect rejected with ${compactJson(error.gatewayError, 1000)}`);
      if (error.gatewayError?.details?.requestId) {
        record(`${label} pairing request`, "INFO", `requestId=${error.gatewayError.details.requestId}; reason=${error.gatewayError.details.reason ?? "unknown"}; requestedRole=${error.gatewayError.details.requestedRole ?? "unknown"}; requestedScopes=${Array.isArray(error.gatewayError.details.requestedScopes) ? error.gatewayError.details.requestedScopes.join(",") : "none"}`);
      }
      // Use pre-extracted device token from raw payload if available,
      // otherwise try extraction now as fallback.
      const deviceToken = error._extractedDeviceToken
        || extractRetryDeviceToken(error.gatewayError?.details, `${label}-catch`);
      const meta = keepSocketOnError ? { socket, challengeNonce } : {};
      return { ok: false, gatewayError: error.gatewayError, retryDeviceToken: deviceToken, ...meta };
    }
    record(`${label} connect`, "FAIL", error instanceof Error ? error.message : String(error));
    if (keepSocketOnError) {
      return { ok: false, hardFailure: true, socket, challengeNonce };
    }
    return { ok: false, hardFailure: true };
  }
}

async function connectSameSocket({ label, socket, nonce: existingNonce, identity, auth }) {
  const nextId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: new Error(`${label} same-socket connect timeout`) });
    }, RPC_TIMEOUT_MS);

    let connectId; // assigned before use

    const handler = (event) => {
      let frame;
      try {
        frame = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }
      if (frame?.type !== "res") return;
      if (frame.id !== connectId) return;

      socket.removeEventListener("message", handler);
      clearTimeout(timer);

      if (frame.ok) {
        record(`${label} same-socket hello-ok`, "PASS", summarizeHelloOk(frame.payload));
        resolve({ ok: true, helloOk: frame.payload });
      } else {
        record(`${label} same-socket hello-ok`, "WARN", `not received; rejected with ${compactJson(frame.error, 1000)}`);
        resolve({ ok: false, gatewayError: frame.error });
      }
    };

    socket.addEventListener("message", handler);

    connectId = nextId("connect-same-socket");
    const connectFrame = createConnectFrame(connectId, existingNonce, identity, auth, { overrideNonce: existingNonce, clientId: "gateway-client-same-socket" });

    record(`${label} same-socket connect frame`, "PASS", compactJson({
      type: connectFrame.type,
      method: connectFrame.method,
      id: connectFrame.id,
      params: {
        ...connectFrame.params,
        auth: {
          token: auth.token ? "present-redacted" : undefined,
          deviceToken: auth.deviceToken ? "present-redacted" : undefined,
          type: auth.type || undefined,
        },
        device: { id: connectFrame.params.device.id, publicKey: "present", signature: "present", signedAt: connectFrame.params.device.signedAt, nonce: "present" },
      },
    }));

    socket.send(JSON.stringify(connectFrame));
  });
}

async function runMinimalRpc(connection) {
  const methods = Array.isArray(connection.helloOk?.features?.methods) ? new Set(connection.helloOk.features.methods) : new Set();
  const callIfAvailable = async (method, params = {}) => {
    if (!methods.has(method)) {
      record(`RPC ${method}`, "SKIP", "method not advertised in hello-ok.features.methods");
      return;
    }
    try {
      const payload = await connection.request(method, params);
      record(`RPC ${method}`, "PASS", summarizeRpcPayload(method, payload));
    } catch (error) {
      record(`RPC ${method}`, "WARN", error.gatewayError ? compactJson(error.gatewayError, 1000) : error instanceof Error ? error.message : String(error));
    }
  };

  if (methods.has("health")) await callIfAvailable("health");
  else await callIfAvailable("status");
  await callIfAvailable("skills.status");
  await callIfAvailable("models.list", { view: "configured" });
  record("Observed events", "INFO", `count=${connection.events.length}; sample=${connection.events.slice(0, 12).join(", ")}`);
  try { connection.socket?.close(); } catch { /* noop */ }
}

async function probe(gatewayToken) {
  if (typeof WebSocket === "undefined") throw new Error("global WebSocket is unavailable in this Node runtime; use Node 22+ or 24+.");

  const identity = loadOrCreateIdentity();
  record("Probe identity", "INFO", `deviceId=${identity.deviceId}; created=${identity.created}; persisted=${IDENTITY_PATH}; token_present=true`);

  // --- Step 0: Gateway token diagnostics (non-sensitive) ---
  {
    const tlen = gatewayToken.length;
    const ttrim = gatewayToken.trim().length;
    const sha = crypto.createHash("sha256").update(gatewayToken).digest("hex");
    record("gateway_token_present", "INFO", "true");
    record("gateway_token_length", "INFO", String(tlen));
    record("gateway_token_trimmed_length", "INFO", String(ttrim));
    record("gateway_token_has_newline", "INFO", String(tlen !== ttrim));
    record("gateway_token_sha256_prefix", "INFO", sha.slice(0, 8));
  }

  // --- Step 1: Initial connect with gateway token (keep socket open on error) ---
  const first = await connectOnce({ label: "initial", identity, auth: { token: gatewayToken }, keepSocketOnError: true });
  if (first.ok) {
    await runMinimalRpc(first);
    return true;
  }
  if (first.hardFailure) return false;

  // --- Step 2: Diagnostics on error details ---
  if (first.gatewayError?.details) {
    diagnoseCanRetryWithDeviceToken(first.gatewayError.details);
  }

  // --- Step 2b: Extract device token ---
  const retryDeviceToken = first.retryDeviceToken
    || extractRetryDeviceToken(first.gatewayError?.details, "probe-fallback");
  if (!retryDeviceToken) {
    record("device token retry", "SKIP", `device_token_present=false; reason=canRetryWithDeviceToken_not_a_token`);
    if (first.socket) try { first.socket.close(); } catch { /* noop */ }
    return true;
  }
  record("device token retry", "INFO", "device_token_present=true");
  diagnoseDeviceToken("extracted", retryDeviceToken);

  // --- Step 3: Same-socket retry (keep first WS open, send new connect with deviceToken) ---
  let sameSocketResult = null;
  if (first.socket && first.challengeNonce) {
    record("same-socket retry", "INFO", `attempting same-socket retry with challengeNonce present`);
    sameSocketResult = await connectSameSocket({
      label: "same-socket",
      socket: first.socket,
      nonce: first.challengeNonce,
      identity,
      auth: { deviceToken: retryDeviceToken },
    });
    record("same-socket retry attempted", "INFO", "true");
    record("same-socket retry hello_ok", sameSocketResult.ok ? "PASS" : "FAIL",
      sameSocketResult.ok ? "hello-ok received"
      : sameSocketResult.gatewayError
        ? `code=${sameSocketResult.gatewayError.code}; message=${sanitizeText(sameSocketResult.gatewayError.message || "")}; nextStep=${sameSocketResult.gatewayError.details?.recommendedNextStep || "none"}`
        : sameSocketResult.error?.message || "unknown");
    try { first.socket.close(); } catch { /* noop */ }
  } else {
    record("same-socket retry", "SKIP", "same_socket_retry_attempted=false; socket or nonce missing");
    if (first.socket) try { first.socket.close(); } catch { /* noop */ }
  }

  // --- Step 4: New-socket retry with auth.deviceToken (control) ---
  record("new-socket retry", "INFO", "new_socket_retry_attempted=true; connecting new WS with auth.deviceToken");
  const second = await connectOnce({ label: "new-socket device-token retry", identity, auth: { deviceToken: retryDeviceToken } });
  if (second.ok) {
    record("new-socket retry hello_ok", "PASS", "hello-ok received on new-socket retry");
    await runMinimalRpc(second);
    return true;
  }
  if (second.gatewayError) {
    record("new-socket retry hello_ok", "FAIL",
      `code=${second.gatewayError.code}; message=${sanitizeText(second.gatewayError.message || "")}; nextStep=${second.gatewayError.details?.recommendedNextStep || "none"}`);
  } else {
    record("new-socket retry hello_ok", "FAIL", "hard failure");
  }

  // --- Step 5: Auth shape variants (each on new WS) ---
  const authShapes = [
    { label: "auth.token=deviceToken", auth: { token: retryDeviceToken } },
    { label: "auth.type=device", auth: { type: "device", token: retryDeviceToken } },
  ];

  for (const shape of authShapes) {
    record(`auth-shape ${shape.label}`, "INFO", "attempting");
    const result = await connectOnce({ label: `auth-shape ${shape.label}`, identity, auth: shape.auth });
    if (result.ok) {
      record(`auth-shape ${shape.label} hello_ok`, "PASS", "hello-ok received");
      try { result.socket?.close(); } catch { /* noop */ }
    } else if (result.gatewayError) {
      record(`auth-shape ${shape.label} hello_ok`, "FAIL",
        `code=${result.gatewayError.code}; message=${sanitizeText(result.gatewayError.message || "")}; nextStep=${result.gatewayError.details?.recommendedNextStep || "none"}`);
    } else {
      record(`auth-shape ${shape.label} hello_ok`, "FAIL", "hard failure");
    }
  }

  return !second.hardFailure;
}

async function main() {
  console.log("OpenClaw Gateway token auth + hello-ok probe");
  console.log("Read-only checks only. This script does not read .env, does not print tokens, does not write tokens, and does not modify OpenClaw config.\n");

  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!gatewayToken) {
    record("Token", "SKIP", "token_present=false; 需要临时提供 OPENCLAW_GATEWAY_TOKEN 才能验证 hello-ok");
    for (const result of results) {
      console.log(`[${result.status.padEnd(4, " ")}] ${result.name}`);
      if (result.detail) console.log(`       ${result.detail}`);
    }
    console.log("\nProbe skipped without hard failure.");
    return;
  }

  let ok = false;
  try {
    ok = await probe(gatewayToken);
  } catch (error) {
    record("Probe", "FAIL", error instanceof Error ? error.message : String(error));
  }

  for (const result of results) {
    console.log(`[${result.status.padEnd(4, " ")}] ${result.name}`);
    if (result.detail) for (const line of result.detail.split(/\r?\n/).filter(Boolean)) console.log(`       ${line}`);
  }

  const failed = results.filter((result) => result.status === "FAIL");
  if (!ok || failed.length > 0) {
    console.error(`\nProbe finished with ${failed.length || 1} failure(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("\nProbe completed without hard failures.");
}

main();
