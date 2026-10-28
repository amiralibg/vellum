import type { ExpiryPreset } from "@vellum/shared";

export const DAY_MS = 86_400_000;
export const PRESET_DAYS: Partial<Record<ExpiryPreset, number>> = { "7d": 7, "30d": 30 };

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO moment as the value of an <input type="date">, in the owner's time zone. */
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Close on Nov 27" means the link still works all of Nov 27, in the owner's time zone. */
export function endOfDay(dateInput: string): string | null {
  const [y, m, d] = dateInput.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

export const tomorrowInput = () => toDateInput(new Date(Date.now() + DAY_MS).toISOString());
