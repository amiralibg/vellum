import { initial } from "./format.js";
import { html } from "./html.js";
import { layout, type ViewBeacon } from "./layout.js";

export interface HtmlPageProps {
  nonce: string;
  url: string;
  slug: string;
  title: string;
  /** For link previews; empty leaves the description tags out. */
  metaDescription: string;
  /** USERCONTENT_URL/u/<token>/index.html */
  frameSrc: string;
  noindex: boolean;
  allowDownload: boolean;
  replyEmail: string;
  view?: ViewBeacon;
  owner: { name: string };
}

/**
 * An uploaded HTML document: the author's page fills the window from the usercontent origin,
 * and Vellum's only footprint is the collapsible pill (mockups/view-html.html).
 */
export function htmlPage(p: HtmlPageProps): string {
  const reply = p.replyEmail ? `mailto:${p.replyEmail}?subject=${encodeURIComponent(`Re: ${p.title}`)}` : "";
  const body = html`
    <iframe
      class="site-frame"
      src="${p.frameSrc}"
      title="${p.title}"
      sandbox="allow-scripts allow-popups"
      referrerpolicy="no-referrer"
    ></iframe>

    <div class="pill" data-collapsed="false">
      <div class="who">
        <span class="avatar" aria-hidden="true">${initial(p.owner.name)}</span>
        <span>Shared by ${p.owner.name}</span>
      </div>
      ${p.allowDownload || reply ? html`<span class="sep act" aria-hidden="true"></span>` : ""}
      ${p.allowDownload ? html`<a class="btn btn-ghost act" href="/p/${p.slug}/download" download>Download</a>` : ""}
      ${reply ? html`<a class="btn btn-ghost act" href="${reply}">Reply</a>` : ""}
      <button class="btn btn-ghost btn-icon" type="button" aria-label="Hide sharing bar" aria-expanded="true" data-pill-toggle>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6.5 4 4 4-4 4" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  `;
  return layout({
    nonce: p.nonce,
    meta: {
      title: p.title,
      description: p.metaDescription,
      url: p.url,
      siteName: p.owner.name,
      noindex: p.noindex,
      bodyClass: "is-site",
    },
    body,
    readerScript: true,
    view: p.view,
  });
}
