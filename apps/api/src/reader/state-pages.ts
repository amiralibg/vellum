import type { ExpiryPreset } from "@vellum/shared";
import { initial } from "./format.js";
import { html, type RawHtml } from "./html.js";
import { layout } from "./layout.js";

/** The gate-style pages from mockups/view-locked.html: locked, wrong password, expired, 404. */

interface Sharer {
  name: string;
  /** The document's reply email. The ask-for button is left out without one. */
  replyEmail: string;
}

function from(sharer: Sharer, ask: { label: string; subject: string; style: "ghost" | "secondary" }): RawHtml {
  const mailto = sharer.replyEmail
    ? `mailto:${sharer.replyEmail}?subject=${encodeURIComponent(ask.subject)}`
    : "";
  return html`<div class="from">
    <span class="avatar" aria-hidden="true">${initial(sharer.name)}</span>
    <span>Shared by ${sharer.name}</span>
    ${mailto ? html`<a class="btn btn-${ask.style}" href="${mailto}">${ask.label}</a>` : ""}
  </div>`;
}

const ERROR_ICON = html`<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="7" cy="7" r="5.25" /><path d="M7 4.25v3.25" stroke-linecap="round" /><circle cx="7" cy="9.75" r="0.5" fill="currentColor" /></svg>`;

export interface LockedPageProps {
  nonce: string;
  slug: string;
  title: string;
  url: string;
  noindex: boolean;
  sharer: Sharer;
  /** Shown under the field after a failed attempt. */
  error?: string;
  /** What the reader typed, kept so they can fix a typo. */
  attempt?: string;
}

export function lockedPage(p: LockedPageProps): string {
  const body = html`
    <main class="gate-page">
      <section class="gate">
        <div class="mini" aria-hidden="true">
          <div class="t">${p.title.split(/\s+[—–-]\s+/).pop()}</div>
          <div class="l"></div><div class="l m"></div><div class="l"></div><div class="l s"></div>
          <div class="blk"></div><div class="l"></div>
        </div>
        <p class="eyebrow">Protected document</p>
        <h1 class="display">${p.title}</h1>
        <p class="sub">${p.sharer.name} shared this with a password. It should have come with the link.</p>
        <form action="/p/${p.slug}/unlock" method="post" novalidate>
          <label class="label" for="pw">Password</label>
          <div class="row">
            <input
              class="input"
              id="pw"
              name="password"
              type="password"
              autocomplete="off"
              required
              value="${p.attempt ?? ""}"
              ${p.error ? html`autofocus aria-invalid="true" aria-describedby="pw-error"` : ""}
            />
            <button class="btn btn-primary btn-lg" type="submit">Open document</button>
          </div>
          ${p.error ? html`<p class="error" id="pw-error">${ERROR_ICON} ${p.error}</p>` : ""}
        </form>
        ${from(p.sharer, { label: "Ask for access", subject: `Access to ${p.title}`, style: "ghost" })}
      </section>
    </main>
    <footer class="colophon">Shared with Vellum</footer>
  `;
  return layout({
    nonce: p.nonce,
    // Title only: a password document's description stays out of link previews.
    meta: { title: p.title, url: p.url, siteName: p.sharer.name, noindex: p.noindex, bodyClass: "is-gate" },
    body,
  });
}

export interface ExpiredPageProps {
  nonce: string;
  title: string;
  expiresAt: Date;
  preset: ExpiryPreset;
  noindex: boolean;
  sharer: Sharer;
}

const longDate = (d: Date, withYear: boolean) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(d);

export function expiredPage(p: ExpiredPageProps): string {
  const withYear = p.expiresAt.getUTCFullYear() !== new Date().getUTCFullYear();
  const closed = longDate(p.expiresAt, withYear);
  const when =
    p.preset === "7d" ? "after 7 days" : p.preset === "30d" ? "after 30 days" : `on ${closed}`;
  const body = html`
    <main class="gate-page">
      <section class="gate">
        <p class="eyebrow">Link expired</p>
        <h1 class="display">This link closed on ${closed}</h1>
        <p class="sub">
          ${p.sharer.name} set “${p.title}” to stop being shared ${when}. If you still need it, ask for a new link.
        </p>
        ${from(p.sharer, { label: "Ask for a new link", subject: `New link for ${p.title}`, style: "secondary" })}
      </section>
    </main>
    <footer class="colophon">Shared with Vellum</footer>
  `;
  return layout({
    nonce: p.nonce,
    meta: { title: "Link expired", siteName: p.sharer.name, noindex: true, bodyClass: "is-gate" },
    body,
  });
}

export function notFoundPage(p: { nonce: string; address: string; siteName: string }): string {
  const body = html`
    <main class="gate-page">
      <section class="gate">
        <p class="eyebrow">404</p>
        <h1 class="display">Nothing is shared at this address</h1>
        <p class="sub">
          The link may have a typo, or the document was unpublished. Check the address with the person who sent it.
        </p>
        <p class="mono address">${p.address}</p>
      </section>
    </main>
    <footer class="colophon">Shared with Vellum</footer>
  `;
  return layout({
    nonce: p.nonce,
    meta: { title: "Not found", siteName: p.siteName, noindex: true, bodyClass: "is-gate" },
    body,
  });
}
