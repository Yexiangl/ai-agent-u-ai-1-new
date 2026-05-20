import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function maskKey(value: string) {
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 7)}••••••••••••${value.slice(-4)}`;
}
