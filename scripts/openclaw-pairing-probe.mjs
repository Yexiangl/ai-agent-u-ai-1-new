#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GATEWAY_WS_URL = process.env.OPENCLAW_GATEWAY_WS_URL || "ws://127.0.0.1:18789";
const TIMEOUT_MS = 10000;
const RPC_TIMEOUT_MS = 5000;
const IDENTITY_PATH = process.env.OPENCLAW_PAIRING_PROBE_IDENTITY
  || path.join(os.tmpdir(), "ai-agent-workspace-openclaw-pairing-probe-device.json");

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const results = [];
const events = [];

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
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/token|authorization|password|secret|apikey|apiKey|privateKey|signature$/i.test(key)) {
      output[key] = raw ? "[REDACTED]" : raw;
      continue;
    }
    output[key] = redact(raw);
  }
  return output;
}

function compactJson(value, max = 900) {
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
      if (deviceId === parsed.deviceId) return { ...parsed, deviceId };
    }
  } catch {
    // Missing or invalid probe identity: generate a new one below.
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
  return identity;
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
    params.token ?? "",
    params.nonce,
    params.platform ?? "",
    params.deviceFamily ?? "",
  ].join("|");
}

function signPayload(privateKeyPem, payload) {
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem)));
}

function readOptionalAuth() {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  const password = process.env.OPENCLAW_GATEWAY_PASSWORD?.trim();
  const auth = {};
  if (token) auth.token = token;
  if (password) auth.password = password;
  return Object.keys(auth).length > 0 ? auth : undefined;
}

function createConnectFrame(id, nonce, identity) {
  const auth = readOptionalAuth();
  const role = "operator";
  const scopes = ["operator.read"];
  const client = {
    id: "gateway-client",
    displayName: "AI Agent Workspace Pairing Probe",
    version: "0.0.0-probe",
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
    token: auth?.token ?? undefined,
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
      auth,
      locale: "en-US",
      userAgent: "ai-agent-workspace-openclaw-pairing-probe/0.0.0",
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
    `auth=${compactJson({ role: helloOk?.auth?.role, scopes: helloOk?.auth?.scopes, hasDeviceToken: Boolean(helloOk?.auth?.deviceToken) })}`,
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

async function probe() {
  if (typeof WebSocket === "undefined") throw new Error("global WebSocket is unavailable in this Node runtime; use Node 22+ or 24+.");

  const identity = loadOrCreateIdentity();
  const auth = readOptionalAuth();
  record("Probe identity", "INFO", `deviceId=${identity.deviceId}; persisted=${IDENTITY_PATH}; authProvided=${auth ? Object.keys(auth).join("+") : "none"}`);

  const pending = new Map();
  let requestSeq = 0;
  let helloOk = null;
  let socket;
  const nextId = (prefix) => `${prefix}-${Date.now()}-${++requestSeq}`;

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
    const timer = setTimeout(() => reject(new Error("WebSocket pairing probe timeout")), TIMEOUT_MS);
    socket = new WebSocket(GATEWAY_WS_URL);

    socket.addEventListener("open", () => record("WebSocket TCP connect", "PASS", GATEWAY_WS_URL));

    socket.addEventListener("message", (event) => {
      let frame;
      try {
        frame = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch (error) {
        record("Frame parse", "WARN", error instanceof Error ? error.message : String(error));
        return;
      }

      if (frame?.type === "event") {
        events.push(frame.event);
        if (frame.event === "connect.challenge") {
          const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce.trim() : "";
          record("connect.challenge", nonce ? "PASS" : "FAIL", compactJson({ payloadKeys: frame.payload && typeof frame.payload === "object" ? Object.keys(frame.payload) : [], nonce: nonce ? "present" : "missing", ts: frame.payload?.ts }));
          if (!nonce) return;
          const connectFrame = createConnectFrame(nextId("connect"), nonce, identity);
          pending.set(connectFrame.id, {
            method: "connect",
            resolve: (payload) => {
              helloOk = payload;
              clearTimeout(timer);
              record("connect hello-ok", "PASS", summarizeHelloOk(payload));
              resolve(payload);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
            timer: setTimeout(() => {
              pending.delete(connectFrame.id);
              reject(new Error("connect response timeout"));
            }, RPC_TIMEOUT_MS),
          });
          record("connect frame", "PASS", compactJson({
            type: connectFrame.type,
            method: connectFrame.method,
            params: {
              ...connectFrame.params,
              auth: connectFrame.params.auth ? "present-redacted" : undefined,
              device: {
                id: connectFrame.params.device.id,
                publicKey: "present",
                signature: "present",
                signedAt: connectFrame.params.device.signedAt,
                nonce: "present",
              },
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
          err.frame = frame;
          item.reject(err);
        }
      }
    });

    socket.addEventListener("error", () => reject(new Error("WebSocket connection error")));
    socket.addEventListener("close", (event) => {
      if (!helloOk) reject(new Error(`WebSocket closed before hello-ok code=${event.code}; reason=${sanitizeText(event.reason || "none")}`));
    });
  });

  try {
    await connected;
  } catch (error) {
    const frame = error?.frame;
    if (frame) {
      record("connect hello-ok", "WARN", `not received; connect rejected with ${compactJson(frame.error, 1000)}`);
      const details = frame.error?.details;
      if (details?.requestId) record("Pairing request", "INFO", `requestId=${details.requestId}; reason=${details.reason ?? "unknown"}; requestedRole=${details.requestedRole ?? "unknown"}; requestedScopes=${Array.isArray(details.requestedScopes) ? details.requestedScopes.join(",") : "none"}`);
      if (frame.error?.details?.code === "AUTH_TOKEN_MISSING") record("Auth hint", "INFO", "Gateway requires auth. Rerun with OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD in the environment; the script will not print it.");
      if (frame.error?.code === "NOT_PAIRED") record("Pairing hint", "INFO", "Run `openclaw devices list` to inspect pending requests, then `openclaw devices approve <requestId>` after verifying details. This script does not approve automatically.");
      return true;
    }
    record("connect", "FAIL", error instanceof Error ? error.message : String(error));
    return false;
  }

  const methods = Array.isArray(helloOk?.features?.methods) ? new Set(helloOk.features.methods) : new Set();
  const callIfAvailable = async (method, params = {}) => {
    if (!methods.has(method)) {
      record(`RPC ${method}`, "SKIP", "method not advertised in hello-ok.features.methods");
      return;
    }
    try {
      const payload = await request(method, params);
      record(`RPC ${method}`, "PASS", summarizeRpcPayload(method, payload));
    } catch (error) {
      record(`RPC ${method}`, "WARN", error?.frame ? compactJson(error.frame.error, 1000) : error instanceof Error ? error.message : String(error));
    }
  };

  if (methods.has("health")) await callIfAvailable("health");
  else await callIfAvailable("status");
  await callIfAvailable("skills.status");
  await callIfAvailable("models.list", { view: "configured" });
  record("Observed events", "INFO", `count=${events.length}; sample=${events.slice(0, 12).join(", ")}`);
  socket.close();
  return true;
}

async function main() {
  console.log("OpenClaw Gateway pairing/auth probe");
  console.log("Read-only checks only. This script does not read .env, does not print tokens, does not approve devices, and does not modify OpenClaw config.\n");

  let ok = false;
  try {
    ok = await probe();
  } catch (error) {
    record("Probe", "FAIL", error instanceof Error ? error.message : String(error));
  }

  for (const result of results) {
    const prefix = result.status.padEnd(4, " ");
    console.log(`[${prefix}] ${result.name}`);
    if (result.detail) {
      for (const line of result.detail.split(/\r?\n/).filter(Boolean)) console.log(`       ${line}`);
    }
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
