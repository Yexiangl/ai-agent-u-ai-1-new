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
  accepted?: boolean;
  requestId?: string;
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

export interface HermesChatChunk {
  requestId: string;
  content: string;
  reasoningContent?: string;
  type: "content" | "reasoning";
}

export interface HermesToolProgress {
  requestId: string;
  event: string;
  data: string;
}

export interface HermesChatDone {
  requestId: string;
  content: string;
  reasoningContent?: string;
  model: string;
  rawUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  sessionId: string | null;
  elapsedMs: number;
  partial?: boolean;
  stopped?: boolean;
  warning?: string;
  streamError?: string | null;
  diagnostics?: {
    contentType: string;
    transferEncoding?: string;
    isSse: boolean;
    fallbackToNonStreamJson?: boolean;
    firstByteMs?: number | null;
    bytesChunkCount?: number;
    sseEventCount?: number;
    dataLineCount?: number;
    chunkCount: number;
    contentChunkCount: number;
    reasoningChunkCount: number;
    toolEventCount: number;
    emptyDeltaCount?: number;
    parseErrorCount?: number;
    streamReadError?: boolean;
    streamError?: string;
    streamErrorDebug?: string;
    streamErrorSourceChain?: string;
    partial?: boolean;
    receivedDone: boolean;
  };
}

export interface HermesStreamDiagnostics {
  requestId: string;
  diagnostics: Record<string, unknown>;
}

export interface HermesChatError {
  requestId: string;
  error: string;
  url: string | null;
  model: string | null;
  status: number | null;
  body: string | null;
}

export async function hermesChatCompletion(requestId: string, model: string, messages: ChatMessage[]): Promise<HermesChatResult> {
  return invoke<HermesChatResult>("hermes_chat_completion", { requestId, model, messages });
}

export async function cancelHermesChatCompletion(requestId: string): Promise<{ cancelled: boolean; requestId: string }> {
  return invoke("cancel_hermes_chat_completion", { requestId });
}

export interface HermesModelConfig {
  exists: boolean;
  configPath: string | null;
  model: string | null;
  provider: string | null;
  baseUrl: string | null;
  reasoningEffort: string | null;
  updatedAt: string | null;
  error: string | null;
}

export interface HermesNativeMemoryFile {
  id: string;
  title: string;
  path: string;
  relativePath: string;
  kind: "memory" | "user" | "soul" | "unknown";
  exists: boolean;
  size: number;
  updatedAt: string | null;
  contentPreview: string;
  content: string;
  readOnly: boolean;
}

export interface HermesNativeMemoryResult {
  homeDir: string;
  found: boolean;
  files: HermesNativeMemoryFile[];
  checkedAt: string;
  error: string | null;
}

export interface StoredChatMessage extends ChatMessage {
  requestId?: string;
  source?: "Hermes Agent";
  elapsedMs?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  modelName?: string;
  sessionId?: string | null;
  reasoningContent?: string;
  toolEvents?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
  hermesSessionId?: string | null;
  model: string;
  totalTokens?: number;
  lastMessagePreview?: string;
  pinned?: boolean;
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

export async function readHermesModelConfig(): Promise<HermesModelConfig> {
  return invoke<HermesModelConfig>("read_hermes_model_config");
}

export async function readHermesNativeMemory(): Promise<HermesNativeMemoryResult> {
  return invoke<HermesNativeMemoryResult>("read_hermes_native_memory");
}

export async function readChatSessions(): Promise<ChatSession[]> {
  return invoke<ChatSession[]>("read_chat_sessions");
}

export async function writeChatSessions(sessions: ChatSession[]): Promise<void> {
  return invoke<void>("write_chat_sessions", { sessions });
}

export async function clearChatSessions(): Promise<void> {
  return invoke<void>("clear_chat_sessions");
}

export interface HermesCronOverview {
  cronDirExists: boolean;
  outputDirExists: boolean;
  outputFileCount: number;
  hermesAvailable: boolean;
  checkedAt: string;
}

export interface HermesCronCliStatus {
  schedulerRunning: boolean;
  schedulerStatus: string;
  jobs: Array<{ raw: string }>;
  hermesAvailable: boolean;
}

export async function readHermesCronOverview(): Promise<HermesCronOverview> {
  return invoke<HermesCronOverview>("read_hermes_cron_overview");
}

export async function readHermesCronCliStatus(): Promise<HermesCronCliStatus> {
  return invoke<HermesCronCliStatus>("read_hermes_cron_cli_status");
}

export interface ApplyHermesModelResult {
  success: boolean;
  appliedModel: string;
  appliedProvider: string;
  baseUrl: string;
  apiMode: string;
  backupPaths: string[];
  verifiedConfig: HermesModelConfig | null;
}

export async function applyHermesModelConfig(token: string, model: string): Promise<ApplyHermesModelResult> {
  return invoke<ApplyHermesModelResult>("apply_hermes_model_config", { token, model });
}

export interface ApplyReasoningResult {
  success: boolean;
  appliedEffort: string;
  verifiedConfig: HermesModelConfig | null;
}

export async function applyHermesReasoningConfig(effort: string): Promise<ApplyReasoningResult> {
  return invoke<ApplyReasoningResult>("apply_hermes_reasoning_config", { effort });
}

export interface AiFileEntry {
  name: string;
  category: string;
  path: string;
  size: number;
  modified: string | null;
  extension: string;
}

export interface AiFilesListResult {
  files: AiFileEntry[];
}

export async function ensureAiFilesDirs(): Promise<{ ok: boolean; root: string }> {
  return invoke("ensure_ai_files_dirs");
}

export async function listAiFiles(category?: string): Promise<AiFilesListResult> {
  return invoke<AiFilesListResult>("list_ai_files", { category: category ?? null });
}

export async function deleteAiFile(path: string): Promise<{ ok: boolean }> {
  return invoke("delete_ai_file", { path });
}

export async function openAiFileLocation(path: string): Promise<{ ok: boolean }> {
  return invoke("open_ai_file_location", { path });
}
