// Virtual pet (养成系桌宠) data model + pure game logic. Kept separate from React so
// the progression rules are easy to reason about and unit-test. Persistence reuses
// AppConfig.pet via the existing config storage; no new storage channel is introduced.

export type PetStage = "egg" | "baby" | "teen" | "adult";
export type PetMoodKey = "happy" | "content" | "hungry" | "sad" | "sleepy";

export interface PetState {
  name: string;
  bornAt: number;        // epoch ms when hatched/created
  level: number;         // 1..N
  exp: number;           // exp within the current level
  satiety: number;       // 0..100, decays over time
  energy: number;        // 0..100, decays over time
  mood: number;          // 0..100, derived-ish but stored for smoothing
  lastInteractAt: number; // epoch ms of last feed/play/pet
  lastDecayAt: number;    // epoch ms when decay was last applied
  totalInteractions: number;
}

export interface PetInteractionResult {
  state: PetState;
  leveledUp: boolean;
  evolved: boolean;
  fromStage: PetStage;
  toStage: PetStage;
}

// Exp needed to advance FROM the given level to the next. Gentle curve so early
// progress feels quick and later levels feel earned.
export function expForLevel(level: number): number {
  return 40 + (level - 1) * 30;
}

// Stage is derived purely from level so it can never desync from progress.
export function stageForLevel(level: number): PetStage {
  if (level >= 12) return "adult";
  if (level >= 6) return "teen";
  if (level >= 2) return "baby";
  return "egg";
}

export const STAGE_LABEL: Record<PetStage, string> = {
  egg: "宝宝蛋", baby: "幼年期", teen: "成长期", adult: "成年期",
};

export function createPet(name: string): PetState {
  const now = Date.now();
  return {
    name: name.trim() || "团子",
    bornAt: now, level: 1, exp: 0,
    satiety: 80, energy: 80, mood: 80,
    lastInteractAt: now, lastDecayAt: now, totalInteractions: 0,
  };
}

// Per-hour decay rates. Applied proportionally to elapsed time when the page opens,
// so there is no background timer and the pet "lives" even while the app is closed.
const SATIETY_DECAY_PER_HOUR = 8;
const ENERGY_DECAY_PER_HOUR = 6;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

// Apply time-based decay since lastDecayAt. Returns a new state (pure).
export function applyDecay(pet: PetState, now: number = Date.now()): PetState {
  const hours = Math.max(0, (now - pet.lastDecayAt) / 3_600_000);
  if (hours <= 0) return pet;
  const satiety = clamp(pet.satiety - hours * SATIETY_DECAY_PER_HOUR);
  const energy = clamp(pet.energy - hours * ENERGY_DECAY_PER_HOUR);
  // Mood drifts toward the average of needs so neglect makes the pet sad.
  const target = (satiety + energy) / 2;
  const mood = clamp(pet.mood + (target - pet.mood) * Math.min(1, hours / 6));
  return { ...pet, satiety, energy, mood, lastDecayAt: now };
}

// Derived mood bucket for choosing animation/expression and copy.
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

export type PetAction = "feed" | "play" | "pet";

// Grant exp + adjust stats for an interaction, handling multi-level-ups and evolution.
export function interact(pet: PetState, action: PetAction, now: number = Date.now()): PetInteractionResult {
  const decayed = applyDecay(pet, now);
  const fromStage = stageForLevel(decayed.level);
  let { satiety, energy, mood } = decayed;
  let expGain = 0;
  if (action === "feed") { satiety = clamp(satiety + 30); mood = clamp(mood + 6); expGain = 8; }
  else if (action === "play") { energy = clamp(energy - 12); mood = clamp(mood + 16); satiety = clamp(satiety - 6); expGain = 14; }
  else { mood = clamp(mood + 10); expGain = 6; } // pet/摸摸头

  let level = decayed.level;
  let exp = decayed.exp + expGain;
  let leveledUp = false;
  while (exp >= expForLevel(level)) { exp -= expForLevel(level); level += 1; leveledUp = true; }

  const toStage = stageForLevel(level);
  const next: PetState = {
    ...decayed, satiety, energy, mood, level, exp,
    lastInteractAt: now, lastDecayAt: now,
    totalInteractions: decayed.totalInteractions + 1,
  };
  return { state: next, leveledUp, evolved: fromStage !== toStage, fromStage, toStage };
}
