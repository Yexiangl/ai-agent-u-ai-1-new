export const DEFAULT_BASE_URL = "https://ai.f1class.icu/v1";

export const MODEL_OPTIONS = ["deepseek-v4-flash", "deepseek-v4-pro", "kimi-k2.6"] as const;

export type ModelName = (typeof MODEL_OPTIONS)[number];
export type AgentEngine = "hermes";

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  defaultModel: ModelName;
  selectedEngine: AgentEngine;
  hasCompletedOnboarding: boolean;
  lastConnectionStatus: ConnectionStatus;
  enabledSkills: string[];
  tasks: SavedTask[];
}

export interface ConnectionStatus {
  ok: boolean | null;
  message: string;
  latencyMs?: number;
  modelCount?: number;
  testedAt?: string;
}

export interface SavedTask {
  id: string;
  name: string;
  frequency: string;
  prompt: string;
  model: string;
  channel: string;
  enabled: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  baseUrl: DEFAULT_BASE_URL,
  apiKey: "",
  defaultModel: "deepseek-v4-flash",
  selectedEngine: "hermes",
  hasCompletedOnboarding: false,
  lastConnectionStatus: {
    ok: null,
    message: "尚未测试连接"
  },
  enabledSkills: [],
  tasks: []
};
