import type { DocumentStatus } from "@vellum/shared";
import { formatShortDate } from "../lib/format";
import { ClockIcon, DraftDot, ExpiredDot, LiveDot } from "./icons";

const DAY = 86_400_000;

export function Status({ status, expiresAt }: { status: DocumentStatus; expiresAt: string | null }) {
  if (status === "draft") {
    return (
      <span className="status status-off">
        <DraftDot />
        Draft
      </span>
    );
  }
  if (status === "unpublished") {
    return (
      <span className="status status-off">
        <DraftDot />
        Unpublished
      </span>
    );
  }
  if (expiresAt) {
    const left = new Date(expiresAt).getTime() - Date.now();
    if (left <= 0) {
      return (
        <span className="status status-off">
          <ExpiredDot />
          Expired {formatShortDate(expiresAt)}
        </span>
      );
    }
    if (left < 7 * DAY) {
      const days = Math.ceil(left / DAY);
      return (
        <span className="status status-warn">
          <ClockIcon />
          Expires in {days === 1 ? "1 day" : `${days} days`}
        </span>
      );
    }
  }
  return (
    <span className="status status-live">
      <LiveDot />
      Live
    </span>
  );
}
