// TASK-021C: Agent run state types for cross-page task tracking.
// Runtime store lives in App() component via useRef + useState.

export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";

export type AgentRun = {
  runId: string;              // = requestId (crypto.randomUUID())
  sessionId: string;          // session where this run belongs
  status: AgentRunStatus;
  startedAt: number;
  finishedAt?: number;
  modelName: string;          // "openclaw/default"
  source: "OpenClaw Agent";
  error?: string;             // failure reason (never contains token)
  localCancel?: boolean;      // true if user clicked stop
};
