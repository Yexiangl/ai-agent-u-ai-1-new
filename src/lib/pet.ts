// Office-companion pet (办公陪伴宠物) data model + pure game logic. Kept separate
// from React so the rules are easy to reason about and test. Persistence reuses
// AppConfig.pet via the existing config storage; no new storage channel here.
//
// Core loop: the more you USE the assistant (cumulative tokens) the higher the
// bond level and the better the title. The animal form never changes — it's the
// companion you picked. satiety/energy/mood add a light daily-care texture.

export type PetMoodKey = "happy" | "content" | "hungry" | "sad" | "sleepy";

import { type PetAppearance, DEFAULT_APPEARANCE, normalizeAppearance } from "@/lib/petAppearance";

export interface PetState {
  name: string;
  bornAt: number;          // epoch ms when adopted
  lifetimeTokens: number;  // cumulative tokens spent together — only ever grows
  satiety: number;         // 0..100, decays over time
  energy: number;          // 0..100, decays over time
  mood: number;            // 0..100
  lastInteractAt: number;  // epoch ms of last feed/play/pet
  lastDecayAt: number;     // epoch ms when decay was last applied
  totalInteractions: number;
  appearance?: PetAppearance;
}

// ── Bond (亲密度) — driven by cumulative token usage ─────────────────────────
// Thresholds (in tokens) at which each bond level is reached. Gentle early,
// steeper later, so the first few levels feel quick and high levels feel earned.
const BOND_THRESHOLDS = [
  0,        // Lv.1
  5_000,    // Lv.2
  20_000,   // Lv.3
  60_000,   // Lv.4
  150_000,  // Lv.5
  350_000,  // Lv.6
  700_000,  // Lv.7
  1_300_000,// Lv.8
  2_300_000,// Lv.9
  4_000_000,// Lv.10
];

export const MAX_BOND_LEVEL = BOND_THRESHOLDS.length;

export const BOND_TITLES: Record<number, string> = {
  1: "新朋友", 2: "小跟班", 3: "搭子", 4: "好搭子", 5: "默契搭子",
  6: "贴心搭子", 7: "老伙计", 8: "老搭档", 9: "灵魂搭档", 10: "命定搭子",
};

export function bondLevel(lifetimeTokens: number): number {
  let lvl = 1;
  for (let i = 0; i < BOND_THRESHOLDS.length; i++) {
    if (lifetimeTokens >= BOND_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

export function bondTitle(level: number): string {
  return BOND_TITLES[Math.min(MAX_BOND_LEVEL, Math.max(1, level))] ?? "搭子";
}

// Progress (0..1) toward the next bond level, for a progress bar.
export function bondProgress(lifetimeTokens: number): number {
  const lvl = bondLevel(lifetimeTokens);
  if (lvl >= MAX_BOND_LEVEL) return 1;
  const cur = BOND_THRESHOLDS[lvl - 1];
  const next = BOND_THRESHOLDS[lvl];
  return Math.max(0, Math.min(1, (lifetimeTokens - cur) / (next - cur)));
}

// Tokens still needed to reach the next level (0 if maxed).
export function tokensToNextBond(lifetimeTokens: number): number {
  const lvl = bondLevel(lifetimeTokens);
  if (lvl >= MAX_BOND_LEVEL) return 0;
  return BOND_THRESHOLDS[lvl] - lifetimeTokens;
}

export function createPet(name: string, appearance?: PetAppearance): PetState {
  const now = Date.now();
  return {
    name: name.trim() || "搭子",
    bornAt: now,
    lifetimeTokens: 0,
    satiety: 80, energy: 80, mood: 80,
    lastInteractAt: now, lastDecayAt: now, totalInteractions: 0,
    appearance: normalizeAppearance(appearance ?? DEFAULT_APPEARANCE),
  };
}

// Always-valid appearance for a pet, falling back to defaults for legacy saves.
export function petAppearance(pet: PetState): PetAppearance {
  return normalizeAppearance(pet.appearance);
}

// Migrate a legacy PetState (old level/exp/stage model) into the new shape so
// existing users keep their pet. Missing fields get sane defaults.
export function migratePet(raw: Partial<PetState> & Record<string, unknown>): PetState {
  const now = Date.now();
  return {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "搭子",
    bornAt: typeof raw.bornAt === "number" ? raw.bornAt : now,
    lifetimeTokens: typeof raw.lifetimeTokens === "number" ? raw.lifetimeTokens : 0,
    satiety: typeof raw.satiety === "number" ? raw.satiety : 80,
    energy: typeof raw.energy === "number" ? raw.energy : 80,
    mood: typeof raw.mood === "number" ? raw.mood : 80,
    lastInteractAt: typeof raw.lastInteractAt === "number" ? raw.lastInteractAt : now,
    lastDecayAt: typeof raw.lastDecayAt === "number" ? raw.lastDecayAt : now,
    totalInteractions: typeof raw.totalInteractions === "number" ? raw.totalInteractions : 0,
    appearance: normalizeAppearance(raw.appearance as PetAppearance | undefined),
  };
}

// Per-hour decay rates. Applied proportionally to elapsed time when the page
// opens, so there is no background timer and the pet "lives" while app is shut.
const SATIETY_DECAY_PER_HOUR = 8;
const ENERGY_DECAY_PER_HOUR = 6;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function applyDecay(pet: PetState, now: number = Date.now()): PetState {
  const hours = Math.max(0, (now - pet.lastDecayAt) / 3_600_000);
  if (hours <= 0) return pet;
  const satiety = clamp(pet.satiety - hours * SATIETY_DECAY_PER_HOUR);
  const energy = clamp(pet.energy - hours * ENERGY_DECAY_PER_HOUR);
  const target = (satiety + energy) / 2;
  const mood = clamp(pet.mood + (target - pet.mood) * Math.min(1, hours / 6));
  return { ...pet, satiety, energy, mood, lastDecayAt: now };
}

export function moodKey(pet: PetState): PetMoodKey {
  if (pet.satiety < 25) return "hungry";
  if (pet.energy < 25) return "sleepy";
  if (pet.mood >= 70) return "happy";
  if (pet.mood >= 40) return "content";
  return "sad";
}

export const MOOD_LABEL: Record<PetMoodKey, string> = {
  happy: "开心", content: "平静", hungry: "饿了", sad: "有点低落", sleepy: "困了",
};

// Emoji shown in the mood bubble next to the (fixed-expression) avatar.
export const MOOD_EMOJI: Record<PetMoodKey, string> = {
  happy: "😊", content: "🙂", hungry: "🍙", sad: "🌧️", sleepy: "😴",
};

export type PetAction = "feed" | "play" | "pet";

export interface PetInteractionResult {
  state: PetState;
}

// Care interactions adjust the daily-care stats (not bond — bond comes from token use).
export function interact(pet: PetState, action: PetAction, now: number = Date.now()): PetInteractionResult {
  const decayed = applyDecay(pet, now);
  let { satiety, energy, mood } = decayed;
  if (action === "feed") { satiety = clamp(satiety + 30); mood = clamp(mood + 6); }
  else if (action === "play") { energy = clamp(energy - 12); mood = clamp(mood + 16); satiety = clamp(satiety - 6); }
  else { mood = clamp(mood + 10); } // pet/摸摸头

  const next: PetState = {
    ...decayed, satiety, energy, mood,
    lastInteractAt: now, lastDecayAt: now,
    totalInteractions: decayed.totalInteractions + 1,
  };
  return { state: next };
}

// Sync cumulative tokens from the usage ledger. Returns the updated pet plus
// whether the bond level went up (so the UI can celebrate). Only ever raises
// lifetimeTokens (monotonic), so it's safe to call with any ledger total.
export interface PetTokenSyncResult {
  state: PetState;
  leveledUp: boolean;
  fromLevel: number;
  toLevel: number;
}

export function syncLifetimeTokens(pet: PetState, ledgerTotal: number): PetTokenSyncResult {
  const fromLevel = bondLevel(pet.lifetimeTokens);
  const lifetimeTokens = Math.max(pet.lifetimeTokens, ledgerTotal);
  const toLevel = bondLevel(lifetimeTokens);
  return {
    state: lifetimeTokens === pet.lifetimeTokens ? pet : { ...pet, lifetimeTokens },
    leveledUp: toLevel > fromLevel,
    fromLevel, toLevel,
  };
}

