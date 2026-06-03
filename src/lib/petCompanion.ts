import { useEffect, useRef, useState } from "react";

// Office-companion behaviors (TASK-069): the pet proactively "speaks" via a
// bubble — hourly chime, sedentary nudge, and a focus-session companion. All
// timer-based and only run while the app is open (no background process).

export interface CompanionApi {
  bubble: string;              // current speech bubble text ("" = hidden)
  focusing: boolean;           // whether a focus session is active
  focusStartedAt: number | null;
  startFocus: () => void;
  endFocus: () => void;
  ping: () => void;            // call on user interaction to reset sedentary timer
}

const SEDENTARY_MS = 45 * 60_000;  // 45 min of no interaction → nudge
const BUBBLE_MS = 6_000;           // how long a bubble stays up

const SEDENTARY_LINES = [
  "坐好久啦，起来动动、喝口水吧~",
  "伸个懒腰?我陪你歇 30 秒~",
  "眼睛累不累?远眺一下窗外吧~",
];
const FOCUS_START_LINES = ["进入专注，我陪着你~", "开工!我在旁边盯着你哦~"];
const FOCUS_END_LINES = ["这一段辛苦啦，干得漂亮!", "专注结束，奖励自己摸摸我吧~"];

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

export function usePetCompanion(enabled: boolean): CompanionApi {
  const [bubble, setBubble] = useState("");
  const [focusing, setFocusing] = useState(false);
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(null);
  const lastInteractRef = useRef(Date.now());
  const bubbleTimer = useRef<number | null>(null);

  const say = (text: string) => {
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(""), BUBBLE_MS);
  };

  const ping = () => { lastInteractRef.current = Date.now(); };

  const startFocus = () => { setFocusing(true); setFocusStartedAt(Date.now()); say(pick(FOCUS_START_LINES)); };
  const endFocus = () => { setFocusing(false); setFocusStartedAt(null); say(pick(FOCUS_END_LINES)); };

  // Hourly chime: fire shortly after each top-of-the-hour.
  useEffect(() => {
    if (!enabled) return;
    let timeout: number;
    const scheduleNext = () => {
      const now = new Date();
      const msToHour = (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000;
      timeout = window.setTimeout(() => {
        const h = new Date().getHours();
        say(`现在 ${h} 点啦，喝口水歇一歇~`);
        scheduleNext();
      }, Math.max(1000, msToHour));
    };
    scheduleNext();
    return () => window.clearTimeout(timeout);
  }, [enabled]);

  // Sedentary nudge: every minute, check idle time since last interaction.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastInteractRef.current >= SEDENTARY_MS) {
        say(pick(SEDENTARY_LINES));
        lastInteractRef.current = Date.now(); // avoid repeat-spam
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  useEffect(() => () => { if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current); }, []);

  return { bubble, focusing, focusStartedAt, startFocus, endFocus, ping };
}

