# Vellum

A self-hosted place to upload Markdown or HTML and share it as a link.

Instead of attaching `proposal.md` or `pitch.html` to an email, you upload it to your own server and send `https://docs.yourdomain.com/p/acme-proposal`. The reader gets a properly rendered page. You get to change the file without changing the link, and you can see whether (and how far) it was read.

## Status

Design phase. The only thing in the repo right now is a set of static HTML mockups.

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

## Security notes

Uploaded HTML runs whatever scripts it contains, so it must never share an origin with the dashboard:

- Serve uploaded HTML from a separate subdomain (e.g. `usercontent.docs.yourdomain.com`) inside a sandboxed iframe
- Strict CSP on the dashboard origin; session cookies scoped to the dashboard host only
- Sanitize rendered Markdown (no raw HTML passthrough unless explicitly allowed)
- Password-protected documents are checked on the server before any content is served

## Planned stack

Not decided yet. The current plan is an Express + TypeScript API, a React frontend, SQLite (or Postgres) for metadata, and files on a mounted volume. It ships as one Docker image deployed with Dokploy.
