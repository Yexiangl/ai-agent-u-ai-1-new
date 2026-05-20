import { invoke } from "@tauri-apps/api/core";
import { type ChatMessage } from "@/lib/api";

export interface HermesStatus {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  configDir: string | null;
  configFile: string | null;
  skillsDir: string | null;
  memoryDir: string | null;
  checkedAt: string;
  error: string | null;
}

export interface HermesApiServerStatus {
  running: boolean;
  baseUrl: string | null;
  models: string[];
  checkedAt: string;
  error: string | null;
}

export interface HermesHelpResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface HermesChatResult {
  success: boolean;
  content?: string;
  model?: string;
  rawUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  sessionId?: string | null;
  elapsedMs?: number;
  url?: string;
  status?: number;
  body?: string;
  error?: string;
}

export interface HermesModelConfig {
  exists: boolean;
  configPath: string | null;
  model: string | null;
  provider: string | null;
  baseUrl: string | null;
  updatedAt: string | null;
  error: string | null;
}

export async function checkHermes(): Promise<HermesStatus> {
  return invoke<HermesStatus>("check_hermes_installed");
}

export async function getHermesStatus(): Promise<HermesStatus> {
  return checkHermes();
}

export async function checkHermesApiServer(): Promise<HermesApiServerStatus> {
  return invoke<HermesApiServerStatus>("check_hermes_api_server");
}

export async function getHermesHelp(): Promise<HermesHelpResult> {
  return invoke<HermesHelpResult>("get_hermes_help");
}

export async function hermesChatCompletion(model: string, messages: ChatMessage[]): Promise<HermesChatResult> {
  return invoke<HermesChatResult>("hermes_chat_completion", { model, messages });
}

export async function readHermesModelConfig(): Promise<HermesModelConfig> {
  return invoke<HermesModelConfig>("read_hermes_model_config");
}
