import { invoke } from "@tauri-apps/api/core";
import { type ChatMessage } from "@/lib/api";

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

export interface HermesNativeMemoryFile {
  id: string;
  title: string;
  path: string;
  relativePath: string;
  kind: "memory" | "user" | "soul" | "agents" | "heartbeat" | "identity" | "tools" | "unknown";
  exists: boolean;
  size: number;
  updatedAt: string | null;
  contentPreview: string;
  content: string;
  readOnly: boolean;
}

export interface StoredChatMessage extends ChatMessage {
  requestId?: string;
  source?: "Hermes Agent" | "OpenClaw Agent";
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
  projectId?: string;       // TASK-023C-B: session → project grouping, default "default"
  sourceType?: "chat" | "skill" | "file" | "debug" | "onboarding";  // source tag
}

export interface OpenClawWorkspaceMemoryResult {
  available: boolean;
  source: string;
  files: HermesNativeMemoryFile[];
  checkedAt: string;
  warnings: string[];
}

export async function readOpenClawWorkspaceMemory(): Promise<OpenClawWorkspaceMemoryResult> {
  return invoke<OpenClawWorkspaceMemoryResult>("read_openclaw_workspace_memory");
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

export async function pickAndUploadFile(): Promise<{ files: Array<{ name: string; path: string; size: number; modified: string | null }> }> {
  return invoke("pick_and_upload_file");
}

export async function extractAiFileText(path: string): Promise<{ text: string; truncated: boolean; fileType: string; fileName: string; rowCount?: number; sheetCount?: number; slideCount?: number }> {
  return invoke("extract_ai_file_text", { path });
}

export async function saveGeneratedFile(filename: string, content: string): Promise<{ ok: boolean; path: string }> {
  return invoke("save_generated_file", { filename, content });
}
