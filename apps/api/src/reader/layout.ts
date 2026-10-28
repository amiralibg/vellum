import { html, raw, type RawHtml, toString } from "./html.js";

export interface PageMeta {
  title: string;
  description?: string;
  /** Absolute URL of the page, for og:url and canonical. */
  url?: string;
  siteName: string;
  noindex: boolean;
  /** Extra classes on <body>. */
  bodyClass?: string;
}

export interface LayoutOptions {
  meta: PageMeta;
  nonce: string;
  body: RawHtml;
  /** Load the reader script (progress bar, TOC, reading time). */
  readerScript?: boolean;
  /** View tracking: reader.js posts beacons with this token. Absent when the document doesn't track views. */
  view?: ViewBeacon;
}

export interface ViewBeacon {
  token: string;
  /** Same-origin path the beacons go to. */
  beacon: string;
}

// Reader pages follow the reader's OS theme; the owner's saved choice only applies to the dashboard.
const THEME_SCRIPT =
  '(()=>{const r=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)"),a=()=>{r.dataset.theme=m.matches?"dark":"light"};a();m.addEventListener("change",a)})()';

export function layout({ meta, nonce, body, readerScript, view }: LayoutOptions): string {
  const description = meta.description?.slice(0, 300);
  return (
    "<!doctype html>" +
    toString(html`<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${meta.noindex ? html`<meta name="robots" content="noindex, nofollow" />` : ""}
    <title>${meta.title}</title>
    ${description ? html`<meta name="description" content="${description}" />` : ""}
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${meta.title}" />
    ${description ? html`<meta property="og:description" content="${description}" />` : ""}
    ${meta.url ? html`<meta property="og:url" content="${meta.url}" /><link rel="canonical" href="${meta.url}" />` : ""}
    <meta property="og:site_name" content="${meta.siteName}" />
    <meta name="twitter:card" content="summary" />
    <link rel="preload" href="/assets/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/assets/reader/reader.css" />
    <script nonce="${nonce}">${raw(THEME_SCRIPT)}</script>
    ${readerScript ? html`<script src="/assets/reader/reader.js" defer></script>` : ""}
  </head>
  <body class="${meta.bodyClass ?? ""}"${view ? html` data-view="${view.token}" data-beacon="${view.beacon}"` : ""}>
    ${body}
  </body>
</html>`)
  );
}

