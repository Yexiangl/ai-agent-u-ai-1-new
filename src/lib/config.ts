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
  memoryFiles: Record<string, string>;
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

export const DEFAULT_MEMORY_FILES: Record<string, string> = {
  "business.md": "# 业务说明\n\nAI Agent 工作台用于管理本地 Hermes Agent、技能包、记忆文件和客户常用任务。\n\n- 交付方式：U 盘交付版\n- Agent 服务：本机 Hermes API Server\n- 模型供应：通过 Hermes 配置专属模型供应 Token 和模型来源",
  "faq.md": "# 常见问题\n\nQ: U 盘拔掉后还能用吗？\nA: App 可复制到电脑运行，U 盘主要用于交付、激活和教程资料。\n\nQ: API Key 保存在哪里？\nA: 当前保存到应用数据目录，后续可升级为加密存储。",
  "reply-style.md": "# 回复风格\n\n- 清晰直接\n- 面向普通客户，避免过多技术术语\n- 涉及 API Key、危险操作时提醒用户确认\n- 不编造不存在的售后承诺",
  "price-list.md": "# 价格表\n\n- 入门版：基础模型调用 + 教程\n- 专业版：更高额度 + 定时任务 UI\n- 团队版：多客户管理 UI + 技能包展示"
};

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
  memoryFiles: DEFAULT_MEMORY_FILES,
  tasks: []
};
