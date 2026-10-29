import type { ReactNode } from "react";
import { Link } from "react-router";
import { LogoIcon } from "../../components/icons";

/** The split screen of mockups/login.html: the pitch on the start side, `children` (a form) on the end side. */
export function AuthLayout({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const host = window.location.host;
  return (
    <main className="grid min-h-dvh grid-cols-[1.35fr_1fr] max-[880px]:grid-cols-1">
      <section
        className="flex flex-col justify-between border-e border-line px-12 py-10 max-[880px]:gap-10 max-[880px]:border-e-0 max-[880px]:border-b max-[880px]:px-6 max-[880px]:py-8"
        aria-labelledby="pitch-title"
      >
        <Link className="wordmark" to="/login">
          <LogoIcon />
          Vellum
        </Link>
        <div>
          <h1 id="pitch-title" className="display max-w-[11ch] text-[clamp(56px,7.4vw,var(--text-display))]">
            Send a link, <em className="text-text-secondary not-italic">not an attachment.</em>
          </h1>
          <p className="mt-6 max-w-[44ch] text-lg text-pretty text-text-secondary">
            Upload a proposal, pitch or report as Markdown or HTML. Vellum renders it and gives you one link to share, on
            your own server.
          </p>
          <div
            className="mt-10 inline-flex items-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-3 font-mono text-ui"
            aria-hidden="true"
          >
            <span>
              {host}/p/<b>your-proposal</b>
            </span>
          </div>
        </div>
        <p className="text-sm text-text-muted">Self-hosted · v0.1</p>
      </section>

      <section className="grid place-items-center bg-surface px-6 py-10" aria-labelledby={labelledBy}>
        <div className="grid w-full max-w-[360px] gap-5">{children}</div>
      </section>
    </main>
  );
}
