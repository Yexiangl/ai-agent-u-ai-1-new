import { useEffect, useMemo, useRef, useState } from "react";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";
import { Heart, Drumstick, Gamepad2, Sparkles, MessageSquare, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type PetState, type PetAction, type PetStage,
  createPet, applyDecay, interact, stageForLevel, expForLevel,
  moodKey, MOOD_LABEL, STAGE_LABEL,
} from "@/lib/pet";

import egg from "@/assets/pet-egg.json";
import baby from "@/assets/pet-baby.json";
import teen from "@/assets/pet-teen.json";
import adult from "@/assets/pet-adult.json";

const STAGE_ANIM: Record<PetStage, unknown> = { egg, baby, teen, adult };

// Stat bar with a label, value and tone color.
function StatBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span><span>{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
    </div>
  );
}

export function PetWidget({ pet, onChange, onAskAI }: {
  pet: PetState | null;
  onChange: (next: PetState | null) => void;
  onAskAI: (petName: string, mood: string, stage: string) => void;
}) {
  const [nameDraft, setNameDraft] = useState("");
  const [flash, setFlash] = useState("");
  const lottieRef = useRef<LottieRefCurrentProps>(null);

  // Apply offline decay once when the widget mounts with an existing pet, so the
  // pet reflects time passed while the app was closed.
  useEffect(() => {
    if (pet) {
      const decayed = applyDecay(pet);
      if (decayed !== pet) onChange(decayed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage = pet ? stageForLevel(pet.level) : "egg";
  const mk = pet ? moodKey(pet) : "content";
  const expNeed = pet ? expForLevel(pet.level) : 1;

  const flashMsg = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(""), 2200); };

  const doAction = (action: PetAction) => {
    if (!pet) return;
    const res = interact(pet, action);
    onChange(res.state);
    // Replay the animation as a little reaction.
    lottieRef.current?.stop(); lottieRef.current?.play();
    if (res.evolved) flashMsg(`进化啦！现在是${STAGE_LABEL[res.toStage]} 🎉`);
    else if (res.leveledUp) flashMsg(`升级到 Lv.${res.state.level} ✨`);
    else flashMsg(action === "feed" ? "吃得好满足～" : action === "play" ? "玩得好开心！" : "蹭蹭你～");
  };

  if (!pet) {
    return (
      <div className="rounded-3xl border border-violet-200/60 bg-gradient-to-br from-violet-50/70 via-background to-background p-6 text-center shadow-sm dark:border-violet-500/20">
        <div className="mx-auto h-28 w-28"><Lottie animationData={STAGE_ANIM.egg as object} loop /></div>
        <h3 className="mt-2 text-base font-semibold">领养一只摸鱼搭子</h3>
        <p className="mt-1 text-xs text-muted-foreground">给它起个名字，陪你一起摸鱼。喂养、玩耍让它慢慢长大。</p>
        <div className="mx-auto mt-3 flex max-w-xs items-center gap-2">
          <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={12} placeholder="给它起个名字"
            onKeyDown={(e) => { if (e.key === "Enter" && nameDraft.trim()) onChange(createPet(nameDraft)); }}
            className="h-9 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-violet-400" />
          <Button size="sm" onClick={() => onChange(createPet(nameDraft))}><Sparkles className="h-4 w-4" />领养</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-violet-200/60 bg-gradient-to-br from-violet-50/70 via-background to-background p-5 shadow-sm dark:border-violet-500/20">
      <div className="flex items-center gap-4">
        <div className="relative h-28 w-28 shrink-0 cursor-pointer select-none" onClick={() => doAction("pet")} title="摸摸头">
          <Lottie lottieRef={lottieRef} animationData={STAGE_ANIM[stage] as object} loop />
          {flash && <div className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium text-white shadow animate-fade-in">{flash}</div>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-bold">{pet.name}</span>
            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">Lv.{pet.level} · {STAGE_LABEL[stage]}</span>
            <span className="text-[11px] text-muted-foreground">心情：{MOOD_LABEL[mk]}</span>
          </div>
          <StatBar label="经验" value={(pet.exp / expNeed) * 100} tone="bg-violet-500" />
          <StatBar label="饱食度" value={pet.satiety} tone="bg-amber-500" />
          <StatBar label="活力" value={pet.energy} tone="bg-sky-500" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => doAction("feed")}><Drumstick className="h-4 w-4" />喂食</Button>
        <Button size="sm" variant="outline" onClick={() => doAction("play")}><Gamepad2 className="h-4 w-4" />玩耍</Button>
        <Button size="sm" variant="outline" onClick={() => doAction("pet")}><Heart className="h-4 w-4" />摸摸</Button>
        <Button size="sm" className="ml-auto" onClick={() => onAskAI(pet.name, MOOD_LABEL[mk], STAGE_LABEL[stage])}>
          <MessageSquare className="h-4 w-4" />聊两句
        </Button>
      </div>
    </div>
  );
}
