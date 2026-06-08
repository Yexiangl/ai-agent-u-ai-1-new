// Pet appearance model: which animal the companion is. Art comes from hand-made
// chibi PNGs under src/assets/pets/. No recoloring/accessories — the appearance
// is simply the chosen species.

export type PetSpecies = "cat" | "dog" | "dino";

export interface PetAppearance {
  species: PetSpecies;
}

export const SPECIES_LABEL: Record<PetSpecies, string> = {
  cat: "猫咪", dog: "狗狗", dino: "小恐龙",
};

export const SPECIES_LIST: PetSpecies[] = ["cat", "dog", "dino"];

export const DEFAULT_APPEARANCE: PetAppearance = { species: "cat" };

// Normalize a possibly-partial/legacy appearance into a valid one. Old saves
// used species ids that no longer exist (fox/panda/etc.) — fall back to cat.
export function normalizeAppearance(raw: Partial<PetAppearance> | null | undefined): PetAppearance {
  const species = SPECIES_LIST.includes(raw?.species as PetSpecies)
    ? (raw!.species as PetSpecies)
    : DEFAULT_APPEARANCE.species;
  return { species };
}
