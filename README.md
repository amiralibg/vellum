# Vellum

A self-hosted place to upload Markdown or HTML and share it as a link.

Instead of attaching `proposal.md` or `pitch.html` to an email, you upload it to your own server and send `https://docs.yourdomain.com/p/acme-proposal`. The reader gets a properly rendered page. You get to change the file without changing the link, and you can see whether (and how far) it was read.

## Status

The first version is complete: Markdown, HTML and zip uploads, publish settings and the `/p/:slug` reader, with
password protection, link expiry, versions (upload and restore), unpublish and delete. Uploaded HTML is served
only from `USERCONTENT_URL`, sandboxed, behind short-lived signed links. Views are counted without cookies
(see "Analytics" below). It ships as one Docker image; see "Deploy".

## Development

Needs Node 22+, pnpm and Postgres (local, or `docker compose up -d postgres`).

```sh
pnpm install
cp .env.example .env    # then fill in SIGNING_SECRET and ENCRYPTION_KEY (openssl rand -base64 48)
pnpm dev                # dashboard on http://localhost:5180, API on :8000
pnpm test               # integration tests (needs the vellum_test database)
```

The owner account is created from `OWNER_EMAIL` / `OWNER_PASSWORD` on first boot. To change it later,
update the env and run `pnpm --filter @vellum/api owner:reset`.

| Path | What |
| --- | --- |
| `apps/api` | Express + Postgres API, and the server-rendered reader pages (`src/reader`) |
| `apps/web` | Vite + React dashboard |
| `packages/shared` | zod schemas and types shared by both |
| `packages/ui` | Design tokens and components (`theme.css`, ported from the mockups) and the Geist fonts |

The mockups stay the design source of truth:

```sh
open mockups/index.html
```

Every screen has a light theme and a dark theme with a pure black background. They follow the OS setting by default; the toggle in the bottom-left corner overrides it (saved in localStorage).

| Screen | File |
| --- | --- |
| Sign in | `mockups/login.html` |
| Documents (library + drop to upload) | `mockups/dashboard.html` |
| Publish settings | `mockups/upload.html` |
| Document detail (link, stats, versions) | `mockups/document.html` |
| Markdown reader | `mockups/view-markdown.html` |
| HTML document | `mockups/view-html.html` |
| Password / expired / not found | `mockups/view-locked.html` |

## MVP scope (proposed)

- Upload `.md`, `.html`, or a `.zip` with an `index.html` plus its assets
- Custom slug per document; the link stays the same when you upload a new version
- Access: anyone with the link, or a password
- Optional expiry date
- View tracking without cookies: views, unique readers, reading time, scroll depth per section
- Markdown rendering with a table of contents, print-to-PDF, and an optional "Reply" button
- Single owner account

## Deploy

```sh
docker build -t vellum .    # the API, the reader pages and the dashboard in one image
```

`docker-compose.prod.yml` runs the image with Postgres. [docs/deploy.md](docs/deploy.md) walks through deploying
it with Dokploy: DNS for both origins, the Environment tab, domains, backups and the owner reset
(`node dist/owner-reset.js` in the container).

## Analytics

- A view is counted when the reader page sends its first beacon (`POST /p/:slug/beacon`), never when the page is
  rendered, so link previews in WhatsApp, Slack or email don't count. Bots, headless browsers and the signed-in
  owner are not counted, and nothing is tracked when a document's "Track views" is off.
- The beacon goes through the same gate as the page: a locked, expired or unpublished document refuses it.
- No cookies and no IP addresses are stored. A visitor is a hash of IP + user agent + a salt that changes every
  day (UTC); salts older than two days are deleted, so visits can't be linked across days.
- **People** is unique visitors per day, summed: someone who reads on two days counts twice.
- **Read to the end** means the reader reached the last H2, or scrolled 90% of the document.
- Markdown documents also report scroll depth, the H2 sections reached and the time the tab was visible.
  HTML documents count opens only, since the page itself runs sandboxed on another origin.
- Country is stored only if a CDN in front sets `CF-IPCountry`. There's no GeoIP lookup.

## Security notes

Uploaded HTML runs whatever scripts it contains, so it must never share an origin with the dashboard:

- Serve uploaded HTML from a separate subdomain (e.g. `usercontent.docs.yourdomain.com`) inside a sandboxed iframe
- Strict CSP on the dashboard origin; session cookies scoped to the dashboard host only
- Sanitize rendered Markdown (no raw HTML passthrough unless explicitly allowed)
- Password-protected documents are checked on the server before any content is served

## Stack

Express 4 + TypeScript + Postgres for the API, React + Vite + Tailwind v4 for the dashboard, files on a mounted
volume (`DATA_DIR`). It ships as one Docker image deployed with Dokploy.
