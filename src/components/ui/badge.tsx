import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "default" | "success" | "info" | "warning" | "danger" | "muted";

const tones: Record<BadgeTone, string> = {
  default: "bg-primary/10 text-primary border-primary/20",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400",
  info: "bg-sky-500/10 text-sky-700 border-sky-500/20 dark:text-sky-400",
  warning: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
  danger: "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-400",
  muted: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
};

export function Badge({ className, tone = "default", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />;
}
