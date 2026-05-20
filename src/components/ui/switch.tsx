import { cn } from "@/lib/utils";

export function Switch({ checked, onCheckedChange, className }: { checked: boolean; onCheckedChange?: (checked: boolean) => void; className?: string }) {
  return (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange?.(!checked)} className={cn("relative h-6 w-11 overflow-hidden rounded-full border transition-colors", checked ? "bg-primary" : "bg-muted", className)}>
      <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
}
