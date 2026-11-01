# Vellum

A self-hosted place where people upload Markdown or HTML and share it as a link they control.

## Language

### Documents

**Document**:
One shareable piece of writing, Markdown or HTML, that lives at a single Link and keeps every Version.
_Avoid_: File, page, upload, post

**Version**:
One uploaded file of a Document; exactly one is current, and the others can be restored.
_Avoid_: Revision, upload

**Link**:
The public reader address of a Document, `/p/<slug>`, which stays the same across Versions.
_Avoid_: URL, share link, permalink

**Slug**:
The part of a Link that names the Document; one namespace for every account, first come first served.
_Avoid_: Handle, path, ID

**Draft** / **Live** / **Unpublished**:
A Document's status: never shared yet, readable at its Link, or taken down after being Live.
_Avoid_: Private, public, archived

### People

**Account**:
A person who signs in to Vellum and owns their Documents; joins by Invite.
_Avoid_: User (in prose), owner, author

**Admin**:
An Account that can manage other Accounts but can't see their Documents.

**API token**:
A named, revocable secret an Account creates so tools such as the CLI can act as that Account without its password.
_Avoid_: API key, access token, PAT
