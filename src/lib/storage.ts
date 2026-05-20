import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_CONFIG, type AppConfig } from "@/lib/config";

const LOCAL_STORAGE_KEY = "ai-agent-workspace-config";

function mergeConfig(value: Partial<AppConfig> | null): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...value,
    selectedEngine: "hermes",
    memoryFiles: {
      ...DEFAULT_CONFIG.memoryFiles,
      ...(value?.memoryFiles ?? {})
    },
    tasks: value?.tasks ?? DEFAULT_CONFIG.tasks,
    enabledSkills: value?.enabledSkills ?? DEFAULT_CONFIG.enabledSkills
  };
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const stored = await invoke<Partial<AppConfig> | null>("read_config");
    return mergeConfig(stored);
  } catch (error) {
    console.warn("Failed to read Tauri config, falling back to localStorage", error);
  }

  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return DEFAULT_CONFIG;
  return mergeConfig(JSON.parse(raw) as Partial<AppConfig>);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    await invoke("write_config", { config });
    return;
  } catch (error) {
    console.warn("Failed to write Tauri config, falling back to localStorage", error);
  }
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
}

export async function clearConfig(): Promise<AppConfig> {
  try {
    await invoke("clear_config");
  } catch (error) {
    console.warn("Failed to clear Tauri config, falling back to localStorage", error);
  }
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  return DEFAULT_CONFIG;
}
