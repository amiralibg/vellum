// Append-only. Each entry runs once, in order, inside a transaction.
export const migrations: { name: string; sql: string }[] = [
  {
    name: "001_init",
    sql: /* sql */ `
CREATE TABLE owner (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email         text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  theme         text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  reply_note    text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           text PRIMARY KEY,           -- sha256 of the cookie token
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE TABLE documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  kind               text NOT NULL CHECK (kind IN ('markdown', 'html')),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'unpublished')),
  current_version_id uuid,
  title              text NOT NULL,
  description        text NOT NULL DEFAULT '',
  eyebrow            text NOT NULL DEFAULT '',
  access             text NOT NULL DEFAULT 'link' CHECK (access IN ('link', 'password')),
  password_hash      text,
  password_enc       text,                  -- AES-GCM, so the owner can see it again
  password_rev       integer NOT NULL DEFAULT 0,
  expires_at         timestamptz,
  expiry_preset      text NOT NULL DEFAULT 'never' CHECK (expiry_preset IN ('never', '7d', '30d', 'date')),
  allow_download     boolean NOT NULL DEFAULT false,
  noindex            boolean NOT NULL DEFAULT true,
  track_views        boolean NOT NULL DEFAULT true,
  reply_email        text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz
);

CREATE TABLE document_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  number          integer NOT NULL,
  original_name   text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN ('md', 'html', 'zip')),
  size_bytes      integer NOT NULL,
  word_count      integer NOT NULL DEFAULT 0,
  reading_minutes integer NOT NULL DEFAULT 0,
  headings        jsonb NOT NULL DEFAULT '[]',
  rendered_html   text,                     -- Markdown only
  entry_path      text,                     -- HTML/zip only
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, number)
);

ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_versions (id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX documents_updated_at_idx ON documents (updated_at DESC);
`,
  },
  {
    // Eyebrow and dek come from the file, so they belong to the version: restoring v1 brings its own back.
    name: "002_version_front_matter",
    sql: /* sql */ `
ALTER TABLE document_versions
  ADD COLUMN eyebrow     text NOT NULL DEFAULT '',
  ADD COLUMN description text NOT NULL DEFAULT '';

UPDATE document_versions v SET eyebrow = d.eyebrow, description = d.description
FROM documents d WHERE d.current_version_id = v.id;
`,
  },
  {
    // Views are written by the reader's beacon, never on render. No IPs: a visitor is a hash of
    // IP + user agent + a salt that changes every day, so the same person can't be linked across days.
    name: "003_analytics",
    sql: /* sql */ `
CREATE TABLE daily_salts (
  day  date PRIMARY KEY,
  salt bytea NOT NULL
);

CREATE TABLE views (
  id             uuid PRIMARY KEY,           -- from the view token, so later beacons update the same row
  document_id    uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  version_id     uuid NOT NULL REFERENCES document_versions (id) ON DELETE CASCADE,
  day            date NOT NULL,              -- the salt's day (UTC); visitor_hash only compares within it
  visitor_hash   text NOT NULL,
  device         text NOT NULL,
  browser        text NOT NULL,
  country        text,                       -- only from a CDN header such as CF-IPCountry
  max_scroll     smallint NOT NULL DEFAULT 0, -- percent of the document
  sections       text[] NOT NULL DEFAULT '{}', -- H2 ids reached
  reached_end    boolean NOT NULL DEFAULT false,
  active_seconds integer NOT NULL DEFAULT 0, -- while the tab was visible
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL
);

CREATE INDEX views_document_created_idx ON views (document_id, created_at DESC);
CREATE INDEX views_created_idx ON views (created_at);
`,
  },
  {
    // Invite-only accounts. The single owner becomes the first admin, and keeps its sessions and documents.
    name: "004_users",
    sql: /* sql */ `
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,             -- lowercased
  password_hash  text NOT NULL,
  display_name   text NOT NULL,
  theme          text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  reply_note     text NOT NULL DEFAULT '',
  is_admin       boolean NOT NULL DEFAULT false,
  disabled_at    timestamptz,               -- signed out, and every document answers 404
  max_documents  integer,                   -- NULL: USER_MAX_DOCUMENTS. Admins have no limits.
  max_storage_mb integer,                   -- NULL: USER_MAX_STORAGE_MB
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (email);

INSERT INTO users (email, password_hash, display_name, theme, reply_note, is_admin, created_at)
SELECT lower(email), password_hash, display_name, theme, reply_note, true, created_at FROM owner;

ALTER TABLE sessions ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;
UPDATE sessions SET user_id = (SELECT id FROM users LIMIT 1);
DELETE FROM sessions WHERE user_id IS NULL;
ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX sessions_user_idx ON sessions (user_id);

ALTER TABLE documents ADD COLUMN user_id uuid REFERENCES users (id);
UPDATE documents SET user_id = (SELECT id FROM users LIMIT 1);
ALTER TABLE documents ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX documents_user_updated_idx ON documents (user_id, updated_at DESC);

-- Bytes on disk: the original plus the unpacked site. NULL until measured (server boot backfills it).
ALTER TABLE document_versions ADD COLUMN stored_bytes bigint;

DROP TABLE owner;

-- A link anyone can open once to create an account. Only the token's sha256 is kept.
CREATE TABLE invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  note       text NOT NULL DEFAULT '',     -- who it's for: the invite page greets them by it
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  used_by    uuid REFERENCES users (id),
  revoked_at timestamptz
);

-- A one-time link an admin hands to a user who forgot their password. No email is sent.
CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
`,
  },
];
