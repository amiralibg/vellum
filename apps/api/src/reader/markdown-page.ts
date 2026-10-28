import type { Heading } from "@vellum/shared";
import { formatDate, formatNumber, initial } from "./format.js";
import { html, raw } from "./html.js";
import { layout, type ViewBeacon } from "./layout.js";

export interface MarkdownPageProps {
  nonce: string;
  url: string;
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  /** For link previews; empty leaves the description tags out. */
  metaDescription: string;
  bodyHtml: string;
  headings: Heading[];
  wordCount: number;
  readingMinutes: number;
  updatedAt: Date;
  noindex: boolean;
  allowDownload: boolean;
  replyEmail: string;
  view?: ViewBeacon;
  owner: { name: string; replyNote: string };
}

export function markdownPage(p: MarkdownPageProps): string {
  const ownerName = p.owner.name;
  const reply = p.replyEmail
    ? `mailto:${p.replyEmail}?subject=${encodeURIComponent(`Re: ${p.title}`)}`
    : "";

  const body = html`
    <div class="progress" aria-hidden="true"></div>
    <a class="skip-link" href="#doc">Skip to content</a>

    <header class="reader-bar">
      <div class="who">
        <span class="avatar" aria-hidden="true">${initial(ownerName)}</span>
        <span>Shared by <b>${ownerName}</b> · Updated ${formatDate(p.updatedAt)}</span>
      </div>
      <div class="reader-actions">
        <button class="btn btn-ghost print" type="button" data-print>Print or save as PDF</button>
        ${p.allowDownload ? html`<a class="btn btn-ghost" href="/p/${p.slug}/download" download>Download .md</a>` : ""}
      </div>
    </header>

    <div class="reader">
      ${
        p.headings.length
          ? html`<nav class="toc" aria-label="On this page">
              <p class="eyebrow">On this page</p>
              <ol>
                ${p.headings.map(
                  (h, i) => html`<li><a href="#${h.id}" aria-current="${i === 0 ? "true" : "false"}">${h.text}</a></li>`,
                )}
              </ol>
            </nav>`
          : html`<div class="toc" aria-hidden="true"></div>`
      }

      <main id="doc">
        <article class="prose">
          ${p.eyebrow ? html`<p class="eyebrow">${p.eyebrow}</p>` : ""}
          <h1>${p.title}</h1>
          ${p.description ? html`<p class="dek">${p.description}</p>` : ""}
          <p class="byline">${p.readingMinutes} min read · ${formatNumber(p.wordCount)} words</p>

          ${raw(p.bodyHtml)}

          ${
            reply
              ? html`<div class="end">
                  <p>Questions about this document?${p.owner.replyNote ? html`<span>${p.owner.replyNote}</span>` : ""}</p>
                  <a class="btn btn-primary btn-lg" href="${reply}">Reply to ${ownerName}</a>
                </div>`
              : ""
          }
        </article>
      </main>

      <aside class="side-note" aria-label="Reading time">
        <p class="eyebrow">Reading</p>
        <p><span class="num" data-minutes-left="${p.readingMinutes}">${p.readingMinutes}</span> min left</p>
      </aside>
    </div>

    <footer class="colophon">Shared with Vellum</footer>
  `;

  return layout({
    nonce: p.nonce,
    meta: {
      title: p.title,
      description: p.metaDescription,
      url: p.url,
      siteName: ownerName,
      noindex: p.noindex,
      bodyClass: "is-reader",
    },
    body,
    readerScript: true,
    view: p.view,
  });
}
