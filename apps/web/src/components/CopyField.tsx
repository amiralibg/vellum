import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";

/**
 * A link to hand over by hand (invites, password links), shown once, with a Copy button.
 * It confirms in place: inside a modal <dialog>, the page's toast sits under the backdrop.
 */
export function CopyField({ id, label, url }: { id: string; label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          className="input mono min-w-0 flex-1 text-ui"
          id={id}
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}
