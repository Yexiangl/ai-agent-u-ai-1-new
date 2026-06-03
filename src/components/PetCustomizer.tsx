import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { PetAvatar } from "@/components/PetAvatar";
import {
  type PetAppearance, type PetSpecies,
  SPECIES_LIST, SPECIES_LABEL, normalizeAppearance,
} from "@/lib/petAppearance";

// Appearance editor — pick which animal the companion is. No colors/accessories.
export function PetCustomizer({ initial, onConfirm, onCancel }: {
  initial: PetAppearance;
  onConfirm: (next: PetAppearance) => void;
  onCancel: () => void;
}) {
  const [species, setSpecies] = useState<PetSpecies>(() => normalizeAppearance(initial).species);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="h-24 w-24 shrink-0 rounded-2xl bg-gradient-to-br from-violet-50 to-background p-2 dark:from-violet-500/10">
          <PetAvatar appearance={{ species }} className="h-full w-full" />
        </div>
        <p className="text-xs text-muted-foreground">挑一只陪你办公的小伙伴。形象固定不变，陪你用得越久，亲密度越高。</p>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {SPECIES_LIST.map((s) => (
          <button key={s} onClick={() => setSpecies(s)}
            className={cn("flex flex-col items-center gap-1 rounded-xl border p-1.5 transition-colors",
              species === s ? "border-violet-500 bg-violet-500/10" : "border-border hover:border-violet-300")}>
            <span className="h-11 w-11"><PetAvatar appearance={{ species: s }} animate={false} className="h-full w-full" /></span>
            <span className="text-[11px]">{SPECIES_LABEL[s]}</span>
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onCancel}><X className="h-4 w-4" />取消</Button>
        <Button size="sm" onClick={() => onConfirm({ species })}><Check className="h-4 w-4" />保存</Button>
      </div>
    </div>
  );
}
