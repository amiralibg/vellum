---
name: vellum
description: Publish a Markdown file, HTML page, zip or site folder to the user's Vellum and hand back its link. Use when the user asks to share, publish or upload something to Vellum, wants a shareable link for a document or report, or asks to update a document they already shared there.
---

# Publishing to Vellum

`vellum upload` publishes a file to the user's own Vellum and opens it in their browser. The link goes on stdout; the status line goes to stderr.

```sh
vellum upload report.md --title "Q3 report"
vellum upload ./site                         # a folder with an index.html is zipped for you
vellum upload report.md --slug q3-report     # updates the user's document at /p/q3-report
```

1. **Get the content into a file Vellum takes**: `.md`, `.html`, a `.zip` with an `index.html`, or a folder with an `index.html`. For anything else, write it out as Markdown or HTML first.
2. **Choose new document or new version.** When the user means a document they shared before, find its slug with `vellum list` and pass `--slug`, so the link they sent keeps working. Otherwise pass no slug; `--title` names the document and its link.
3. **Upload** with the options the user asked for (`vellum upload --help` lists them: password, expiry, draft). The browser opens by itself; add `--no-open` only when the user asks or no one is at the screen.
4. **Reply with the link** from stdout, as a link the user can click. Done means the user has the link.

If `vellum` says it's not signed in or the token isn't valid, stop and tell the user to make a token in Vellum → Settings → API tokens and run `vellum login`. Creating tokens is theirs to do.

A slug that belongs to another account is refused: choose a different one, or leave `--slug` off.
