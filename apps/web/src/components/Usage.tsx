import type { Usage } from "@vellum/shared";
import { formatBytes, formatNumber } from "../lib/format";

/** "3 of 50 documents", "12.4 MB of 500 MB". No limit (admins) shows the count alone. */
export function usageLines(u: Usage): { documents: string; storage: string } {
  const docs = (n: number) => `${formatNumber(n)} ${n === 1 ? "document" : "documents"}`;
  return {
    documents: u.maxDocuments === null ? docs(u.documents) : `${formatNumber(u.documents)} of ${docs(u.maxDocuments)}`,
    storage:
      u.maxStorageBytes === null
        ? formatBytes(u.storageBytes)
        : `${formatBytes(u.storageBytes)} of ${formatBytes(u.maxStorageBytes)}`,
  };
}

/** A hairline bar under a usage line. Decorative: the text says the same. */
export function UsageBar({ used, max }: { used: number; max: number | null }) {
  if (max === null) return null;
  const pct = Math.min(100, Math.round((100 * used) / max));
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
      <div className="h-full rounded-full bg-mark" style={{ width: `${pct}%` }} />
    </div>
  );
}
