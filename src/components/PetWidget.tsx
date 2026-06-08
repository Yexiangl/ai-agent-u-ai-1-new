import { useEffect, useState } from "react";
import { Heart, Drumstick, Gamepad2, Sparkles, MessageSquare, Palette, Timer, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type PetState, type PetAction,
  createPet, applyDecay, interact, moodKey, MOOD_LABEL, MOOD_EMOJI,
  petAppearance, bondLevel, bondTitle, bondProgress, syncLifetimeTokens,
} from "@/lib/pet";
import { type PetAppearance, DEFAULT_APPEARANCE } from "@/lib/petAppearance";
import { PetAvatar } from "@/components/PetAvatar";
import { PetCustomizer } from "@/components/PetCustomizer";
import { usePetCompanion } from "@/lib/petCompanion";

function StatBar({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{Math.round(value)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${Math.max(2, value)}%` }} />
        </div>
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
      <div className="overflow-hidden rounded-3xl border border-violet-200/60 bg-card shadow-sm dark:border-violet-500/20">
        {adoptEditing ? (
          <div className="p-6">
            <PetCustomizer initial={adoptLook}
              onConfirm={(next) => { setAdoptLook(next); setAdoptEditing(false); }}
              onCancel={() => setAdoptEditing(false)} />
          </div>
        ) : (
          <div className="relative px-6 pb-6 pt-8 text-center">
            <div className="relative mx-auto h-28 w-28">
              <div className="pet-glow pointer-events-none absolute left-1/2 top-2 h-24 w-24 rounded-full bg-violet-400/25 blur-2xl dark:bg-violet-400/15" />
              <PetAvatar appearance={adoptLook} className="pet-float relative h-full w-full drop-shadow-sm" />
            </div>
            <h3 className="mt-3 text-base font-semibold">领养一只办公搭子</h3>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">挑只小伙伴陪你办公。你用 AI 越多，它和你越亲密，解锁新称号。</p>
            <div className="mx-auto mt-4 flex max-w-xs items-center gap-2">
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={12} placeholder="给它起个名字"
                onKeyDown={(e) => { if (e.key === "Enter" && nameDraft.trim()) onChange(createPet(nameDraft, adoptLook)); }}
                className="h-9 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-violet-400" />
              <Button size="sm" onClick={() => onChange(createPet(nameDraft, adoptLook))}><Sparkles className="h-4 w-4" />领养</Button>
            </div>
            <button onClick={() => setAdoptEditing(true)} className="mx-auto mt-2.5 flex items-center gap-1 text-xs text-violet-600 hover:underline dark:text-violet-300">
              <Palette className="h-3.5 w-3.5" />挑个形象
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-violet-200/60 bg-card shadow-sm dark:border-violet-500/20">
      {editing ? (
        <div className="p-5">
          <PetCustomizer initial={petAppearance(pet)} onConfirm={saveLook} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* Avatar stage */}
            <div className="relative flex w-full shrink-0 items-end justify-center overflow-hidden bg-gradient-to-b from-violet-100/80 via-violet-50/40 to-transparent px-6 pt-7 pb-5 dark:from-violet-500/15 dark:via-violet-500/5 sm:w-44">
              {/* soft glow */}
              <div className="pet-glow pointer-events-none absolute left-1/2 top-7 h-28 w-28 rounded-full bg-violet-400/30 blur-2xl dark:bg-violet-400/20" />
              <div
                className="group relative h-28 w-28 cursor-pointer select-none"
                onClick={() => doAction("pet")}
                title="摸摸头"
              >
                <PetAvatar key={reactKey} appearance={petAppearance(pet)} mood={mk} showMood className="pet-float pet-react h-full w-full drop-shadow-sm" />
                {(flash || companion.bubble) && (
                  <div className="absolute -top-2 left-1/2 z-10 max-w-[150px] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-medium text-white shadow-lg animate-fade-in">
                    {flash || companion.bubble}
                  </div>
                )}
              </div>
              {/* ground shadow */}
              <div className="pet-shadow pointer-events-none absolute bottom-3 left-1/2 h-2 w-20 -translate-x-1/2 rounded-full bg-violet-900/30 blur-[3px] dark:bg-black/40" />
            </div>

            {/* Info panel */}
            <div className="min-w-0 flex-1 space-y-3 p-5 sm:pl-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-bold">{pet.name}</span>
                <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-300">Lv.{level} · {title}</span>
                <button onClick={() => setEditing(true)} title="换个形象" className="ml-auto shrink-0 rounded-lg p-1 text-violet-500 transition-colors hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300">
                  <Palette className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{MOOD_EMOJI[mk]}</span>
                <span>现在{MOOD_LABEL[mk]}</span>
              </div>
              <div className="space-y-2">
                <StatBar label="亲密度" value={progress * 100} tone="bg-gradient-to-r from-violet-500 to-fuchsia-500" icon={<Heart className="h-3 w-3" />} />
                <StatBar label="饱食度" value={pet.satiety} tone="bg-amber-500" icon={<Drumstick className="h-3 w-3" />} />
                <StatBar label="活力" value={pet.energy} tone="bg-sky-500" icon={<Sparkles className="h-3 w-3" />} />
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-5 py-3">
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
