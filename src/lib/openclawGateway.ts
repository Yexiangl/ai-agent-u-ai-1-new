import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { invoke } from "@tauri-apps/api/core";

// Required for @noble/ed25519 sync methods (getPublicKey, sign).
// Without this, sync API throws: hashes.sha512 not set
ed.hashes.sha512 = sha512;

// ── Types ──

export interface OpenClawGatewayStatus {
  reachable: boolean;
  connected: boolean;
  helloOk: boolean;
  protocol?: number;
  serverVersion?: string;
  methodsCount?: number;
  eventsCount?: number;
  error?: string;
  errorCode?: string;
  errorDetailsCode?: string;
  pairingRequired?: boolean;
  requestId?: string;
  recommendedNextStep?: string;
  authReason?: string;
}

export interface OpenClawGatewayEvent {
  type: string;
  payload?: unknown;
  sessionKey?: string;
  runId?: string;
}

export type OpenClawGatewayEventHandler = (event: OpenClawGatewayEvent) => void;
export type OpenClawGatewayUnsubscribe = () => void;

export interface DeviceIdentity {
  deviceId: string;       // sha256(publicKeyRaw) hex — derived via SubtleCrypto or noble
  publicKeyRaw: Uint8Array;
  privateKey: Uint8Array;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Device identity (persistent, stored in Tauri app_data_dir) ──
// Identity is created once by Rust command and persisted to disk (0600 permissions).
// privateKey enters JS layer for signing only. P1: migrate signing to Rust.
// Each App installation gets a stable identity; re-pairing survives restarts.

interface RustDeviceIdentity {
  deviceId: string;
  publicKeyHex: string;
  privateKeyHex: string;
  created: boolean;
}

async function loadPersistentIdentity(): Promise<DeviceIdentity | null> {
  try {
    const raw = await invoke<RustDeviceIdentity>("get_or_create_openclaw_device_identity");
    if (!raw || !raw.deviceId || !raw.publicKeyHex || !raw.privateKeyHex) return null;
    const publicKeyRaw = hexToBytes(raw.publicKeyHex);
    const privateKey = hexToBytes(raw.privateKeyHex);
    return { deviceId: raw.deviceId, publicKeyRaw, privateKey };
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function loadOrCreateIdentity(): Promise<DeviceIdentity> {
  const existing = await loadPersistentIdentity();
  if (existing) return existing;
  // No fallback — if Rust persistent identity fails, we cannot proceed.
  // Ephemeral identity causes new NOT_PAIRED on every restart.
  throw new Error("无法读取 OpenClaw 设备身份。请确认应用数据目录可读写。");
}

// ── Crypto helpers ──

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signPayload(privateKey: Uint8Array, payload: string): string {
  const data = new TextEncoder().encode(payload);
  const sig = ed.sign(data, privateKey);
  return base64UrlEncode(sig);
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string; clientId: string; clientMode: string;
  role: string; scopes: string[]; signedAtMs: number;
  signatureToken: string; nonce: string; platform: string;
}): string {
  return [
    "v3", params.deviceId, params.clientId, params.clientMode,
    params.role, params.scopes.join(","), String(params.signedAtMs),
    params.signatureToken, params.nonce, params.platform, "",
  ].join("|");
}

// ── Gateway Client ──

export class OpenClawGatewayClient {
  private socket: WebSocket | null = null;
  private seq = 0;
  private pending: Map<string, PendingRequest> = new Map();
  private eventListeners: Set<OpenClawGatewayEventHandler> = new Set();
  private state: "disconnected" | "connecting" | "connected" = "disconnected";
  private identity: DeviceIdentity | null = null;
  private identityPromise: Promise<DeviceIdentity> | null = null;
  private _capabilities: { methods: string[]; events: string[]; protocol: number; serverVersion?: string } | null = null;

  constructor(
    private readonly url: string = "ws://127.0.0.1:18789",
    private readonly gatewayToken: string,
    private readonly connectTimeoutMs: number = 15000,
    private readonly rpcTimeoutMs: number = 15000,
  ) {}

  private async ensureIdentity(): Promise<DeviceIdentity> {
    if (this.identity) return this.identity;
    if (!this.identityPromise) {
      this.identityPromise = loadOrCreateIdentity().then((id) => {
        this.identity = id;
        return id;
      });
    }
    return this.identityPromise;
  }

  get isConnected(): boolean {
    return this.state === "connected" && (this.socket?.readyState ?? WebSocket.CLOSED) === WebSocket.OPEN;
  }

  get capabilities() {
    return this._capabilities;
  }

  async connect(): Promise<OpenClawGatewayStatus> {
    if (this.state === "connected" && this.isConnected) {
      return {
        reachable: true, connected: true, helloOk: true,
        protocol: this._capabilities?.protocol,
        serverVersion: this._capabilities?.serverVersion,
        methodsCount: this._capabilities?.methods.length,
        eventsCount: this._capabilities?.events.length,
      };
    }

    this.state = "connecting";
    // Load persistent identity before first connect attempt
    await this.ensureIdentity();
    const caps = this;
    // Generate connect ID ONCE — used both for the connect frame and the response match.
    // Previous bug: two different IDs were generated, causing response mismatch → timeout.
    const connectId = `connect-${Date.now()}-${++this.seq}`;
    let challengeReceived = false;
    let frameSent = false;
    let lastFrameSummary = "none";

    return new Promise<OpenClawGatewayStatus>((resolve) => {
      const timer = setTimeout(() => {
        const detail = `challenge=${challengeReceived}; frameSent=${frameSent}; lastFrame=${lastFrameSummary}`;
        caps.cleanup();
        resolve({ reachable: false, connected: false, helloOk: false, error: `connect timeout (${detail})` });
      }, this.connectTimeoutMs);

      let ws: WebSocket;
      try { ws = new WebSocket(this.url); } catch (err) {
        clearTimeout(timer); this.state = "disconnected";
        resolve({ reachable: false, connected: false, helloOk: false, error: `WebSocket: ${String(err)}` });
        return;
      }
      this.socket = ws;

      ws.addEventListener("message", (event) => {
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch {
          lastFrameSummary = `parse_error`;
          return;
        }

        // Track non-sensitive frame summary for debugging
        if (frame.type === "event") {
          lastFrameSummary = `event:${String(frame.event || "?")}`;
        } else if (frame.type === "res") {
          lastFrameSummary = frame.ok ? "res:ok" : `res:err(${String((frame.error as Record<string, unknown>)?.code || "?")})`;
        }

        if (frame.type === "event") {
          caps.dispatch({
            type: String(frame.event || "unknown"),
            payload: frame.payload,
            sessionKey: typeof frame.sessionKey === "string" ? frame.sessionKey : undefined,
            runId: typeof frame.runId === "string" ? frame.runId : undefined,
          });

          if (frame.event === "connect.challenge") {
            challengeReceived = true;
            const nonce = typeof (frame.payload as Record<string, unknown>)?.nonce === "string"
              ? String((frame.payload as Record<string, unknown>).nonce) : "";
            if (!nonce) {
              clearTimeout(timer); caps.cleanup();
              resolve({ reachable: true, connected: false, helloOk: false, error: "no nonce in challenge" });
              return;
            }
            // Use the SAME connectId for the frame — matches the pending entry
            const connectFrame = caps.buildConnectFrameWithId(connectId, nonce);
            ws.send(JSON.stringify(connectFrame));
            frameSent = true;
          }
          return;
        }

        if (frame.type === "res") {
          // Direct connect response handling — matches by connectId
          if (String(frame.id || "") === connectId) {
            clearTimeout(timer);
            if (frame.ok) {
              caps.state = "connected";
              const p = frame.payload as Record<string, unknown>;
              const f = (p.features || {}) as Record<string, unknown>;
              const methods = Array.isArray(f.methods) ? f.methods as string[] : [];
              const events = Array.isArray(f.events) ? f.events as string[] : [];
              const srv = (p.server || {}) as Record<string, unknown>;
              caps._capabilities = { methods, events, protocol: typeof p.protocol === "number" ? p.protocol : 4, serverVersion: typeof srv.version === "string" ? srv.version : undefined };
              resolve({ reachable: true, connected: true, helloOk: true, protocol: caps._capabilities.protocol, serverVersion: caps._capabilities.serverVersion, methodsCount: methods.length, eventsCount: events.length });
            } else {
              caps.cleanup();
              const fe = frame.error as Record<string, unknown> | undefined;
              const fd = (fe?.details || {}) as Record<string, unknown>;
              const detailsCode = typeof fd.code === "string" ? fd.code : undefined;
              const isPairing = detailsCode === "NOT_PAIRED" || detailsCode === "DEVICE_PAIRING_REQUIRED";
              resolve({
                reachable: true, connected: false, helloOk: false,
                error: fe ? `${String(fe.code || "ERR")}: ${String(fe.message || "unknown")}` +
                  (isPairing ? ` [deviceId: ${caps.identity?.deviceId.slice(0, 12) ?? "?"}...]` : "")
                  : "connect rejected",
                errorCode: typeof fe?.code === "string" ? fe.code : undefined,
                errorDetailsCode: detailsCode,
                pairingRequired: isPairing,
                requestId: typeof fd.requestId === "string" ? fd.requestId : undefined,
                recommendedNextStep: typeof fd.recommendedNextStep === "string" ? fd.recommendedNextStep : undefined,
                authReason: typeof fd.authReason === "string" ? fd.authReason : undefined,
              });
            }
            return;
          }

          // RPC response (non-connect)
          const item = caps.pending.get(String(frame.id || ""));
          if (!item) return;
          caps.pending.delete(String(frame.id || ""));
          clearTimeout(item.timer);
          if (frame.ok) item.resolve(frame.payload);
          else {
            const err = new Error(String((frame.error as Record<string, unknown>)?.message || "RPC error"));
            ((err as unknown) as Record<string, unknown>).gatewayError = frame.error;
            item.reject(err);
          }
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(timer); caps.cleanup();
        resolve({ reachable: false, connected: false, helloOk: false, error: "WebSocket error" });
      });
    });
  }

  disconnect(): void { this.cleanup(); }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.isConnected) throw new Error("Gateway not connected");
    return new Promise<T>((resolve, reject) => {
      const id = `${method}-${Date.now()}-${++this.seq}`;
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, this.rpcTimeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer: t });
      this.socket!.send(JSON.stringify({ type: "req", id, method, params: params ?? {} }));
    });
  }

  onEvent(listener: OpenClawGatewayEventHandler): OpenClawGatewayUnsubscribe {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  // ── Private ──

  private buildConnectFrameWithId(connectId: string, nonce: string): Record<string, unknown> {
    const id = this.identity!;
    const role = "operator"; const scopes = ["operator.read"];
    const signedAtMs = Date.now();
    const payload = buildDeviceAuthPayloadV3({
      deviceId: id.deviceId, clientId: "gateway-client", clientMode: "backend",
      role, scopes, signedAtMs, signatureToken: this.gatewayToken, nonce, platform: "unknown",
    });
    return {
      type: "req", id: connectId, method: "connect",
      params: {
        minProtocol: 4, maxProtocol: 4,
        client: { id: "gateway-client", displayName: "AI Agent Workspace", version: "0.1.9", platform: "unknown", mode: "backend" },
        role, scopes, caps: [], commands: [], permissions: {},
        auth: { token: this.gatewayToken },
        locale: "en-US", userAgent: "ai-agent-workspace/0.1.9",
        device: { id: id.deviceId, publicKey: base64UrlEncode(id.publicKeyRaw), signature: signPayload(id.privateKey, payload), signedAt: signedAtMs, nonce },
      },
    };
  }

  private buildConnectFrame(nonce: string): Record<string, unknown> {
    return this.buildConnectFrameWithId(`connect-${Date.now()}-${++this.seq}`, nonce);
  }

  private dispatch(event: OpenClawGatewayEvent): void {
    for (const l of Array.from(this.eventListeners)) { try { l(event); } catch { /* ignore */ } }
  }

  private cleanup(): void {
    this.state = "disconnected";
    for (const [, item] of Array.from(this.pending)) clearTimeout(item.timer);
    this.pending.clear();
    try { this.socket?.close(); } catch { /* ignore */ }
    this.socket = null;
  }
}
