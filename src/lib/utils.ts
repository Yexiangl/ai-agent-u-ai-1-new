import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function maskKey(value: string) {
  if (!value) return "未配置";
  if (value.length <= 12) return "••••••••";
  return `${value.slice(0, 7)}••••••••••••${value.slice(-4)}`;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
