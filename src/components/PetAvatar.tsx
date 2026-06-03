import { type PetMoodKey, MOOD_EMOJI } from "@/lib/pet";
import { type PetAppearance, type PetSpecies } from "@/lib/petAppearance";

// Pet avatar = a Fluent Emoji Flat SVG (MIT) for the chosen species. The face is
// fixed; mood is shown as a small emoji bubble beside it (no per-mood art).

import cat from "@/assets/pets/cat.svg";
import dog from "@/assets/pets/dog.svg";
import fox from "@/assets/pets/fox.svg";
import panda from "@/assets/pets/panda.svg";
import rabbit from "@/assets/pets/rabbit.svg";
import hamster from "@/assets/pets/hamster.svg";
import penguin from "@/assets/pets/penguin.svg";
import frog from "@/assets/pets/frog.svg";
import dino from "@/assets/pets/dino.svg";
import unicorn from "@/assets/pets/unicorn.svg";

export const SPECIES_SRC: Record<PetSpecies, string> = {
  cat, dog, fox, panda, rabbit, hamster, penguin, frog, dino, unicorn,
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
