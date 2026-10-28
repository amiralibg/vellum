const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const long = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const numbers = new Intl.NumberFormat("en-US");
const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export const formatNumber = (n: number) => numbers.format(n);
export const formatLongDate = (iso: string) => long.format(new Date(iso));
export const formatShortDate = (iso: string) => short.format(new Date(iso));

/** "12 min ago", "2 hours ago", then "Oct 24" — as in the documents list. */
export function formatUpdated(iso: string, now = Date.now()): string {
  const diff = (now - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), "hour");
  if (diff < 172800) return "Yesterday";
  return new Date(iso).getFullYear() === new Date(now).getFullYear() ? short.format(new Date(iso)) : long.format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** "Today", "Yesterday", then "Oct 26", as in the versions list. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.getFullYear() === now.getFullYear() ? short.format(d) : long.format(d);
}

/** A date-only "2026-10-28" from the API, as "Oct 28". Read in UTC so it doesn't shift a day. */
export const formatIsoDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** Seconds as "3:40". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "12 min ago", "2 hours ago", "Yesterday, 18:40", then "Oct 24, 09:12", as in the recent views table. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const day = formatDay(iso, now);
  if (day === "Today") return rtf.format(-Math.floor(diff / 3600), "hour");
  return `${day}, ${clock.format(d)}`;
}

/** "Visitor 2", with the country when a CDN header gave one: "Visitor 2, DE". */
export function visitorLabel(v: { visitor: number; country: string | null }): string {
  return v.country ? `Visitor ${v.visitor}, ${v.country}` : `Visitor ${v.visitor}`;
}
