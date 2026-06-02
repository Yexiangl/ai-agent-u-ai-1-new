import { invoke } from "@tauri-apps/api/core";

// ClawHub public catalog client. All requests go through Rust commands that cache
// responses and honor 429/Retry-After so we behave as a polite third-party directory.

export interface ClawHubSkill {
  slug: string;
  displayName: string;
  summary: string;
  version: string;
  ownerHandle: string;
  ownerDisplayName?: string;
  downloads: number;
  stars: number;
  installs: number;
  updatedAt: number;
  url: string;
  changelog?: string;
  moderation?: {
    verdict: string;
    isSuspicious: boolean;
    isMalwareBlocked: boolean;
  };
  metadata?: {
    os?: string[];
    systems?: string[];
  };
}

export interface ClawHubBrowseResult {
  ok: boolean;
  items: ClawHubSkill[];
  nextCursor: string | null;
}

export interface ClawHubSearchResult {
  ok: boolean;
  items: ClawHubSkill[];
}

export interface ClawHubSkillDetailResult {
  ok: boolean;
  skill: ClawHubSkill;
}

export interface LocalSkill {
  name: string;
  description: string;
  emoji: string;
  source: string;
  homepage: string;
  bundled: boolean;
  eligible: boolean;
  disabled: boolean;
  modelVisible: boolean;
}

export interface LocalSkillsListResult {
  ok: boolean;
  managedSkillsDir: string;
  total: number;
  ready: number;
  skills: LocalSkill[];
}

export interface ClawHubInstallResult {
  ok: boolean;
  action: string;
  slug: string;
}

export interface ClawHubUninstallResult {
  ok: boolean;
  action: string;
  slug: string;
}

// Browse the public ClawHub catalog with sort + pagination.
// sort: "downloads" (default), "stars", "trending", "updated", "newest"
export async function clawhubBrowse(
  sort?: string,
  limit?: number,
  cursor?: string,
): Promise<ClawHubBrowseResult> {
  return invoke<ClawHubBrowseResult>("clawhub_browse", { sort, limit, cursor });
}

// Relevance search across the public ClawHub catalog.
export async function clawhubSearch(query: string, limit?: number): Promise<ClawHubSearchResult> {
  return invoke<ClawHubSearchResult>("clawhub_search", { query, limit });
}

// Full detail for one skill slug, including moderation/security snapshot.
export async function clawhubSkillDetail(slug: string): Promise<ClawHubSkillDetailResult> {
  return invoke<ClawHubSkillDetailResult>("clawhub_skill_detail", { slug });
}

// List skills installed/available on the local machine via the OpenClaw CLI.
export async function openclawSkillsList(): Promise<LocalSkillsListResult> {
  return invoke<LocalSkillsListResult>("openclaw_skills_list");
}

// Install a ClawHub skill by its real slug via the OpenClaw CLI.
export async function clawhubInstallSkill(slug: string, displayName: string): Promise<ClawHubInstallResult> {
  return invoke<ClawHubInstallResult>("clawhub_install_skill", { slug, displayName });
}

// Uninstall a ClawHub-managed skill (removes ~/.openclaw/skills/<slug>).
export async function clawhubUninstallSkill(slug: string): Promise<ClawHubUninstallResult> {
  return invoke<ClawHubUninstallResult>("clawhub_uninstall_skill", { slug });
}

export interface TranslateResult {
  ok: boolean;
  text: string;
  cached?: boolean;
}

// Translate English skill text into Simplified Chinese via the configured model proxy.
export async function translateText(text: string): Promise<TranslateResult> {
  return invoke<TranslateResult>("translate_text", { text });
}
