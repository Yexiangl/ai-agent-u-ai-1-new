import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn("min-h-32 w-full rounded-xl border bg-background p-3 text-sm outline-none transition-all focus:ring-2 focus:ring-ring", className)}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
