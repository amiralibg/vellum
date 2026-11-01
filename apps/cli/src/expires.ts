import type { ExpiryPreset } from "@vellum/shared";
import { CliError } from "./errors.js";

export interface Expiry {
  expiryPreset: ExpiryPreset;
  expiresAt?: string;
}

/**
 * `--expires`: 7d, 30d, never, a day (2026-12-01, which closes at the end of that day, local
 * time) or a full ISO timestamp.
 */
export function parseExpires(input: string, now = new Date()): Expiry {
  const value = input.trim().toLowerCase();
  if (value === "7d" || value === "30d" || value === "never") return { expiryPreset: value };

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let at: Date;
  if (day) {
    const [, y, m, d] = day.map(Number) as [number, number, number, number];
    at = new Date(y, m - 1, d, 23, 59, 59);
    if (at.getMonth() !== m - 1 || at.getDate() !== d) throw invalid(input);
  } else {
    at = new Date(input.trim());
    if (Number.isNaN(at.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(input.trim())) throw invalid(input);
  }
  if (at.getTime() <= now.getTime()) throw new CliError(`--expires ${input} is in the past. Pick a future date.`, 2);
  return { expiryPreset: "date", expiresAt: at.toISOString() };
}

const invalid = (input: string) =>
  new CliError(`--expires takes 7d, 30d, never or a date like 2026-12-01, not “${input}”.`, 2);
