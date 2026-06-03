// Pet appearance model: which animal the companion is. Art comes from Fluent
// Emoji Flat SVGs (MIT) under src/assets/pets/. No recoloring/accessories —
// the appearance is simply the chosen species.

export type PetSpecies =
  | "cat" | "dog" | "fox" | "panda" | "rabbit"
  | "hamster" | "penguin" | "frog" | "dino" | "unicorn";

export interface PetAppearance {
  species: PetSpecies;
}

export const SPECIES_LABEL: Record<PetSpecies, string> = {
  cat: "猫咪", dog: "狗狗", fox: "小狐狸", panda: "熊猫", rabbit: "兔兔",
  hamster: "仓鼠", penguin: "企鹅", frog: "青蛙", dino: "小恐龙", unicorn: "独角兽",
};

export const SPECIES_LIST: PetSpecies[] = [
  "cat", "dog", "fox", "panda", "rabbit", "hamster", "penguin", "frog", "dino", "unicorn",
];

export const DEFAULT_APPEARANCE: PetAppearance = { species: "cat" };

// Normalize a possibly-partial/legacy appearance into a valid one. Old saves
// used species ids that no longer exist (blob/robot/etc.) — fall back to cat.
export function normalizeAppearance(raw: Partial<PetAppearance> | null | undefined): PetAppearance {
  const species = SPECIES_LIST.includes(raw?.species as PetSpecies)
    ? (raw!.species as PetSpecies)
    : DEFAULT_APPEARANCE.species;
  return { species };
}
