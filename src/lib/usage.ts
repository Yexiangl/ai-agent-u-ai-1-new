// Persistent usage ledger (TASK-070). An append-only record of token usage per
// completed turn, stored in usage-log.json — independent of chat-sessions.json.
// Deleting chats does NOT erase usage, so totals reflect true lifetime spend.
import { invoke } from "@tauri-apps/api/core";

export interface UsageRecord {
  id: string;        // unique per turn (requestId) — used for dedupe
  ts: number;        // epoch ms when recorded
  model?: string | null;
  prompt: number;    // prompt/input tokens
  completion: number; // completion/output tokens
  total: number;     // total tokens
}

export async function readUsageLog(): Promise<UsageRecord[]> {
  try {
    const arr = await invoke<UsageRecord[]>("read_usage_log");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function appendUsageRecord(record: UsageRecord): Promise<void> {
  // Skip empty turns so the ledger only holds real consumption.
  if (!record.id || record.total <= 0) return;
  try { await invoke<void>("append_usage_log", { record }); } catch { /* best-effort */ }
}

export async function clearUsageLog(): Promise<void> {
  try { await invoke<void>("clear_usage_log"); } catch { /* ignore */ }
}

export interface UsageTotals {
  total: number;
  prompt: number;
  completion: number;
  today: number;
  week: number;
  count: number;        // number of recorded turns
  lastUse: number;      // epoch ms of most recent record
  byModel: Map<string, number>;
}

export function aggregateUsage(records: UsageRecord[]): UsageTotals {
  const now = Date.now();
  const dayMs = 86_400_000;
  const t: UsageTotals = { total: 0, prompt: 0, completion: 0, today: 0, week: 0, count: records.length, lastUse: 0, byModel: new Map() };
  for (const r of records) {
    t.total += r.total || 0;
    t.prompt += r.prompt || 0;
    t.completion += r.completion || 0;
    if (now - r.ts < dayMs) t.today += r.total || 0;
    if (now - r.ts < 7 * dayMs) t.week += r.total || 0;
    if (r.ts > t.lastUse) t.lastUse = r.ts;
    if (r.model) t.byModel.set(r.model, (t.byModel.get(r.model) ?? 0) + (r.total || 0));
  }
  return t;
}

export function lifetimeTotalTokens(records: UsageRecord[]): number {
  return records.reduce((sum, r) => sum + (r.total || 0), 0);
}

// One-time backfill: turn historical chat-session usage into ledger records so
// existing users keep their accumulated totals. Stable ids (`mig:<key>`) make
// the append dedupe idempotent, so this is safe to call more than once.
interface MigratableMessage {
  role: string;
  requestId?: string;
  modelName?: string | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}
interface MigratableSession {
  id?: string;
  updatedAt?: number;
  messages?: MigratableMessage[];
}

export function buildBackfillRecords(sessions: MigratableSession[]): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const s of sessions) {
    const baseTs = Number(s.updatedAt) * 1000 || Date.now();
    (s.messages || []).forEach((m, i) => {
      if (m.role !== "assistant") return;
      const total = m.usage?.total_tokens ?? 0;
      if (total <= 0) return;
      const key = m.requestId || `${s.id ?? "s"}:${i}`;
      out.push({
        id: `mig:${key}`,
        ts: baseTs,
        model: m.modelName ?? null,
        prompt: m.usage?.prompt_tokens ?? 0,
        completion: m.usage?.completion_tokens ?? 0,
        total,
      });
    });
  }
  return out;
}


