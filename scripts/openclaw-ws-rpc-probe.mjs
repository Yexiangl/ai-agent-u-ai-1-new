#!/usr/bin/env node

const GATEWAY_WS_URL = "ws://127.0.0.1:18789";
const TIMEOUT_MS = 8000;
const RPC_TIMEOUT_MS = 5000;

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
    if (/token|authorization|password|secret|apikey|apiKey|key$/i.test(key)) {
      output[key] = raw ? "[REDACTED]" : raw;
      continue;
    }
    output[key] = redact(raw);
  }
  return output;
}

function compactJson(value, max = 700) {
  const json = JSON.stringify(redact(value));
  return sanitizeText(json.length > max ? `${json.slice(0, max)}...` : json);
}

function record(name, status, detail = "") {
  results.push({ name, status, detail: sanitizeText(detail) });
}

function summarizeArray(items, max = 12) {
  if (!Array.isArray(items)) return { count: 0, sample: [] };
  return { count: items.length, sample: items.filter((item) => typeof item === "string").slice(0, max) };
}

function summarizeHelloOk(helloOk) {
  const methods = summarizeArray(helloOk?.features?.methods);
  const helloEvents = summarizeArray(helloOk?.features?.events);
  const auth = helloOk?.auth && typeof helloOk.auth === "object" ? {
    role: helloOk.auth.role,
    scopes: Array.isArray(helloOk.auth.scopes) ? helloOk.auth.scopes : [],
    hasDeviceToken: Boolean(helloOk.auth.deviceToken),
    extraDeviceTokens: Array.isArray(helloOk.auth.deviceTokens) ? helloOk.auth.deviceTokens.length : 0,
  } : null;
  const policy = helloOk?.policy && typeof helloOk.policy === "object" ? {
    maxPayload: helloOk.policy.maxPayload,
    maxBufferedBytes: helloOk.policy.maxBufferedBytes,
    tickIntervalMs: helloOk.policy.tickIntervalMs,
  } : null;

  return [
    `protocol=${helloOk?.protocol ?? "unknown"}`,
    `server.version=${helloOk?.server?.version ?? "unknown"}`,
    `server.connId=${helloOk?.server?.connId ? "present" : "missing"}`,
    `methods.count=${methods.count}; methods.sample=${methods.sample.join(", ")}`,
    `events.count=${helloEvents.count}; events.sample=${helloEvents.sample.join(", ")}`,
    `auth=${compactJson(auth)}`,
    `policy=${compactJson(policy)}`,
  ].join("\n");
}

function summarizeRpcPayload(method, payload) {
  if (method === "health" || method === "status") {
    const keys = payload && typeof payload === "object" ? Object.keys(payload).slice(0, 16) : [];
    return `keys=${keys.join(", ")}; summary=${compactJson(payload, 900)}`;
  }

  if (method === "skills.status") {
    const skills = Array.isArray(payload?.skills) ? payload.skills : Array.isArray(payload?.entries) ? payload.entries : [];
    const skillNames = skills
      .map((item) => item?.name || item?.slug || item?.id || item?.key)
      .filter(Boolean)
      .slice(0, 10);
    return `skills.count=${skills.length}; skills.sample=${skillNames.join(", ")}; keys=${payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12).join(", ") : "none"}`;
  }

  if (method === "models.list") {
    const models = Array.isArray(payload?.models) ? payload.models : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const modelIds = models
      .map((item) => item?.id || item?.model || item?.name)
      .filter(Boolean)
      .slice(0, 10);
    return `models.count=${models.length}; models.sample=${modelIds.join(", ")}; keys=${payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12).join(", ") : "none"}`;
  }

  return compactJson(payload, 900);
}

function parseFrame(data) {
  const text = typeof data === "string" ? data : String(data);
  return JSON.parse(text);
}

function createConnectFrame(id) {
  return {
    type: "req",
    id,
    method: "connect",
    params: {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "gateway-client",
        displayName: "AI Agent Workspace WS RPC Probe",
        version: "0.0.0-probe",
        platform: process.platform,
        mode: "backend",
      },
      role: "operator",
      scopes: ["operator.read"],
      caps: [],
      commands: [],
      permissions: {},
      locale: "en-US",
      userAgent: "ai-agent-workspace-openclaw-ws-rpc-probe/0.0.0",
    },
  };
}

async function probe() {
  if (typeof WebSocket === "undefined") {
    throw new Error("global WebSocket is unavailable in this Node runtime; use Node 22+ or 24+.");
  }

  const pending = new Map();
  let requestSeq = 0;
  let helloOk = null;
  let challenge = null;
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
    const timer = setTimeout(() => reject(new Error("WebSocket probe timeout")), TIMEOUT_MS);
    socket = new WebSocket(GATEWAY_WS_URL);

    socket.addEventListener("open", () => {
      record("WebSocket TCP connect", "PASS", GATEWAY_WS_URL);
    });

    socket.addEventListener("message", (event) => {
      let frame;
      try {
        frame = parseFrame(event.data);
      } catch (error) {
        record("Frame parse", "WARN", error instanceof Error ? error.message : String(error));
        return;
      }

      if (frame?.type === "event") {
        events.push(frame.event);
        if (frame.event === "connect.challenge") {
          challenge = frame.payload;
          record("connect.challenge", "PASS", compactJson({
            type: frame.type,
            event: frame.event,
            payloadKeys: frame.payload && typeof frame.payload === "object" ? Object.keys(frame.payload) : [],
            nonce: frame.payload?.nonce ? "present" : "missing",
            ts: frame.payload?.ts ?? null,
          }));
          const connectFrame = createConnectFrame(nextId("connect"));
          pending.set(connectFrame.id, {
            method: "connect",
            resolve: (payload) => {
              helloOk = payload;
              record("connect hello-ok", "PASS", summarizeHelloOk(payload));
              clearTimeout(timer);
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
          record("connect frame", "PASS", compactJson(connectFrame));
          socket.send(JSON.stringify(connectFrame));
        } else if (events.length <= 12) {
          record(`event ${frame.event}`, "INFO", compactJson({ event: frame.event, payloadKeys: frame.payload && typeof frame.payload === "object" ? Object.keys(frame.payload) : [] }));
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
      record("connect hello-ok", "WARN", `not received; connect rejected with ${compactJson(frame.error, 900)}`);
      record("RPC health/status", "SKIP", "connect did not reach hello-ok; RPC calls require an authenticated/paired session");
      record("RPC skills.status", "SKIP", "connect did not reach hello-ok; RPC calls require an authenticated/paired session");
      record("RPC models.list", "SKIP", "connect did not reach hello-ok; RPC calls require an authenticated/paired session");
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
      const frame = error?.frame;
      record(`RPC ${method}`, "WARN", frame ? compactJson(frame.error, 900) : error instanceof Error ? error.message : String(error));
    }
  };

  if (methods.has("health")) await callIfAvailable("health");
  else await callIfAvailable("status");
  await callIfAvailable("skills.status");
  await callIfAvailable("models.list", { view: "configured" });

  record("Observed events", "INFO", `count=${events.length}; sample=${events.slice(0, 12).join(", ")}`);
  if (challenge && !challenge.nonce) record("Challenge nonce", "WARN", "connect.challenge payload did not include nonce");

  socket.close();
  return true;
}

async function main() {
  console.log("OpenClaw Gateway WebSocket RPC probe");
  console.log("Read-only checks only. This script does not read .env, does not print tokens, and does not modify OpenClaw config.\n");

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
      for (const line of result.detail.split(/\r?\n/).filter(Boolean)) {
        console.log(`       ${line}`);
      }
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
