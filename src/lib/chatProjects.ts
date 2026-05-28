// TASK-028C: ChatProject types with file-based persistence via Rust command.
// Legacy localStorage fallback retained for migration compatibility.

import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_PROJECT_ID = "default";
export const ALL_PROJECTS_FILTER = "all";

export const SYSTEM_PROJECTS: ChatProject[] = [
  { id: "default", name: "默认", type: "system", createdAt: 0, updatedAt: 0 },
];

export interface ChatProject {
  id: string;
  name: string;
  type: "system" | "custom";
  color?: string;
  icon?: string;
  createdAt: number;
  updatedAt: number;
}

const LEGACY_STORAGE_KEY = "ai-agent-workspace-chat-projects";

// Phase 2: migrate localStorage → file
async function migrateIfNeeded(): Promise<void> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    const existing = await loadProjectsFromFile();
    if (existing.length > 0) return; // file already has data, don't overwrite
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      await saveProjectsToFile(parsed.filter((p: ChatProject) => p.type === "custom"));
      // Keep localStorage as legacy fallback; don't remove yet
    }
  } catch { /* ignore */ }
}

async function loadProjectsFromFile(): Promise<ChatProject[]> {
  try {
    const raw = await invoke<ChatProject[] | null>("read_chat_projects");
    if (Array.isArray(raw)) return raw;
    return [];
  } catch {
    return [];
  }
}

async function saveProjectsToFile(projects: ChatProject[]): Promise<void> {
  try {
    await invoke("write_chat_projects", { projects });
  } catch { /* ignore */ }
}

export async function loadProjects(): Promise<ChatProject[]> {
  try {
    // Phase 1: try file (primary)
    const fromFile = await loadProjectsFromFile();
    if (fromFile.length > 0) {
      return [...SYSTEM_PROJECTS, ...fromFile.filter(p => p.type === "custom")];
    }
    // Phase 2: try localStorage fallback
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Migrate to file (async, non-blocking)
        void migrateIfNeeded();
        return [...SYSTEM_PROJECTS, ...(parsed as ChatProject[]).filter(p => p.type === "custom")];
      }
    }
  } catch { /* ignore */ }
  return [...SYSTEM_PROJECTS];
}

export async function saveProjects(projects: ChatProject[]): Promise<void> {
  const customOnly = projects.filter(p => p.type === "custom");
  // Primary: save to file
  await saveProjectsToFile(customOnly);
  // Legacy fallback: keep localStorage in sync (short-term)
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(customOnly));
  } catch { /* ignore */ }
}

export function createProject(name: string, existing: ChatProject[]): ChatProject {
  const now = Date.now();
  return { id: `proj-${now}`, name, type: "custom", createdAt: now, updatedAt: now };
}
