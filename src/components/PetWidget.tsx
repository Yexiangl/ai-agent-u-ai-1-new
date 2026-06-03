import { useEffect, useState } from "react";
import { Heart, Drumstick, Gamepad2, Sparkles, MessageSquare, Palette, Timer, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type PetState, type PetAction,
  createPet, applyDecay, interact, moodKey, MOOD_LABEL,
  petAppearance, bondLevel, bondTitle, bondProgress, syncLifetimeTokens,
} from "@/lib/pet";
import { type PetAppearance, DEFAULT_APPEARANCE } from "@/lib/petAppearance";
import { PetAvatar } from "@/components/PetAvatar";
import { PetCustomizer } from "@/components/PetCustomizer";
import { usePetCompanion } from "@/lib/petCompanion";

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

export function PetWidget({ pet, lifetimeTokens, onChange, onAskAI }: {
  pet: PetState | null;
  lifetimeTokens: number; // cumulative tokens from the usage ledger (truth)
  onChange: (next: PetState | null) => void;
  onAskAI: (petName: string, mood: string, title: string) => void;
}) {
  const [nameDraft, setNameDraft] = useState("");
  const [flash, setFlash] = useState("");
  const [editing, setEditing] = useState(false);
  const [reactKey, setReactKey] = useState(0);
  const [adoptLook, setAdoptLook] = useState<PetAppearance>({ ...DEFAULT_APPEARANCE });
  const [adoptEditing, setAdoptEditing] = useState(false);
  const companion = usePetCompanion(Boolean(pet));

  // On mount with an existing pet: apply offline decay + sync bond from ledger.
  useEffect(() => {
    if (!pet) return;
    let next = applyDecay(pet);
    const sync = syncLifetimeTokens(next, lifetimeTokens);
    next = sync.state;
    if (next !== pet) onChange(next);
    if (sync.leveledUp) flashMsg(`亲密度升到 Lv.${sync.toLevel} · ${bondTitle(sync.toLevel)} 🎉`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep bond in sync whenever the ledger total grows (e.g. after a new reply).
  useEffect(() => {
    if (!pet) return;
    const sync = syncLifetimeTokens(pet, lifetimeTokens);
    if (sync.state !== pet) {
      onChange(sync.state);
      if (sync.leveledUp) flashMsg(`亲密度升到 Lv.${sync.toLevel} · ${bondTitle(sync.toLevel)} 🎉`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifetimeTokens]);

  const mk = pet ? moodKey(pet) : "content";
  const level = pet ? bondLevel(pet.lifetimeTokens) : 1;
  const title = bondTitle(level);
  const progress = pet ? bondProgress(pet.lifetimeTokens) : 0;

  const flashMsg = (msg: string) => { setFlash(msg); window.setTimeout(() => setFlash(""), 2400); };

  const doAction = (action: PetAction) => {
    if (!pet) return;
    const res = interact(pet, action);
    onChange(res.state);
    setReactKey((k) => k + 1);
    companion.ping();
    flashMsg(action === "feed" ? "吃得好满足～" : action === "play" ? "玩得好开心！" : "蹭蹭你～");
  };

  const saveLook = (next: PetAppearance) => {
    if (pet) onChange({ ...pet, appearance: next });
    setEditing(false);
  };

  if (!pet) {
    return (
      <div className="rounded-3xl border border-violet-200/60 bg-gradient-to-br from-violet-50/70 via-background to-background p-6 text-center shadow-sm dark:border-violet-500/20">
        {adoptEditing ? (
          <PetCustomizer initial={adoptLook}
            onConfirm={(next) => { setAdoptLook(next); setAdoptEditing(false); }}
            onCancel={() => setAdoptEditing(false)} />
        ) : (
          <>
            <div className="mx-auto h-28 w-28"><PetAvatar appearance={adoptLook} className="h-full w-full" /></div>
            <h3 className="mt-2 text-base font-semibold">领养一只办公搭子</h3>
            <p className="mt-1 text-xs text-muted-foreground">挑只小伙伴陪你办公。你用 AI 越多，它和你越亲密，解锁新称号。</p>
            <div className="mx-auto mt-3 flex max-w-xs items-center gap-2">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={12} placeholder="给它起个名字"
                onKeyDown={(e) => { if (e.key === "Enter" && nameDraft.trim()) onChange(createPet(nameDraft, adoptLook)); }}
                className="h-9 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-violet-400" />
              <Button size="sm" onClick={() => onChange(createPet(nameDraft, adoptLook))}><Sparkles className="h-4 w-4" />领养</Button>
            </div>
            <button onClick={() => setAdoptEditing(true)} className="mx-auto mt-2 flex items-center gap-1 text-xs text-violet-600 hover:underline dark:text-violet-300">
              <Palette className="h-3.5 w-3.5" />挑个形象
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-violet-200/60 bg-gradient-to-br from-violet-50/70 via-background to-background p-5 shadow-sm dark:border-violet-500/20">
      {editing ? (
        <PetCustomizer initial={petAppearance(pet)} onConfirm={saveLook} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="relative h-28 w-28 shrink-0 cursor-pointer select-none" onClick={() => doAction("pet")} title="摸摸头">
              <PetAvatar key={reactKey} appearance={petAppearance(pet)} mood={mk} showMood className="h-full w-full pet-react" />
              {(flash || companion.bubble) && <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-10 max-w-[160px] whitespace-nowrap overflow-hidden text-ellipsis rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-medium text-white shadow animate-fade-in">{flash || companion.bubble}</div>}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-bold">{pet.name}</span>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">Lv.{level} · {title}</span>
                <span className="text-[11px] text-muted-foreground">{MOOD_LABEL[mk]}</span>
                <button onClick={() => setEditing(true)} title="换个形象" className="ml-auto text-violet-500 hover:text-violet-600 dark:hover:text-violet-300">
                  <Palette className="h-4 w-4" />
                </button>
              </div>
              <StatBar label="亲密度" value={progress * 100} tone="bg-violet-500" />
              <StatBar label="饱食度" value={pet.satiety} tone="bg-amber-500" />
              <StatBar label="活力" value={pet.energy} tone="bg-sky-500" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => doAction("feed")}><Drumstick className="h-4 w-4" />喂食</Button>
            <Button size="sm" variant="outline" onClick={() => doAction("play")}><Gamepad2 className="h-4 w-4" />玩耍</Button>
            <Button size="sm" variant="outline" onClick={() => doAction("pet")}><Heart className="h-4 w-4" />摸摸</Button>
            {companion.focusing ? (
              <Button size="sm" variant="outline" className="text-rose-600" onClick={() => { companion.endFocus(); companion.ping(); }}><Square className="h-4 w-4" />结束专注</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { companion.startFocus(); companion.ping(); }}><Timer className="h-4 w-4" />专注陪伴</Button>
            )}
            <Button size="sm" className="ml-auto" onClick={() => onAskAI(pet.name, MOOD_LABEL[mk], title)}>
              <MessageSquare className="h-4 w-4" />聊两句
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
