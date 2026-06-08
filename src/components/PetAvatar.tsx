import { type PetMoodKey, MOOD_EMOJI } from "@/lib/pet";
import { type PetAppearance, type PetSpecies } from "@/lib/petAppearance";

// Pet avatar = a hand-made chibi PNG for the chosen species. The face is fixed;
// mood is shown as a small emoji bubble beside it (no per-mood art).

import cat from "@/assets/pets/cat.png";
import dog from "@/assets/pets/dog.png";
import dino from "@/assets/pets/dino.png";

export const SPECIES_SRC: Record<PetSpecies, string> = {
  cat, dog, dino,
};

export function PetAvatar({ appearance, mood, className, animate = true, showMood = false }: {
  appearance: PetAppearance;
  mood?: PetMoodKey;
  className?: string;
  animate?: boolean;
  showMood?: boolean;
}) {
  const src = SPECIES_SRC[appearance.species] ?? cat;
  return (
    <div className={`relative ${className ?? ""}`}>
      <img
        src={src}
        alt="宠物形象"
        draggable={false}
        className={`h-full w-full select-none object-contain ${animate ? "pet-breathe" : ""}`}
      />
      {showMood && mood && (
        <span
          className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-background text-base shadow ring-1 ring-border"
          title="当前心情"
        >
          {MOOD_EMOJI[mood]}
        </span>
      )}
    </div>
  );
}
