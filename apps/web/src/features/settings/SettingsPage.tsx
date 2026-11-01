import { zodResolver } from "@hookform/resolvers/zod";
import {
  accountSettingsSchema,
  passwordChangeSchema,
  type Account,
  type AccountSettings,
  type PasswordChange,
} from "@vellum/shared";
import { useForm, useWatch } from "react-hook-form";
import { useEffect, useRef, useState } from "react";
import {
  useApiTokens,
  useChangePassword,
  useCreateApiToken,
  useMe,
  useRevokeApiToken,
  useUpdateSettings,
} from "../../api/hooks";
import { CopyField } from "../../components/CopyField";
import { FieldError } from "../../components/FieldError";
import { ErrorIcon, PlusIcon } from "../../components/icons";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Topbar } from "../../components/Topbar";
import { UsageBar, usageLines } from "../../components/Usage";
import { ApiError } from "../../lib/api";
import { formatLongDate, formatUpdated } from "../../lib/format";
import { setThemePreference } from "../../lib/theme";

export function SettingsPage() {
  const { data: account } = useMe();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar />
      <main id="main" className="page">
        <h1 className="display text-h1 max-[960px]:text-[44px]">Settings</h1>
        {account && (
          <>
            <SettingsForm account={account} />
            <UsageSection account={account} />
            <PasswordForm />
            <ApiTokensSection />
          </>
        )}
      </main>
    </>
  );
}

const THEMES = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

function SettingsForm({ account }: { account: Account }) {
  const save = useUpdateSettings();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
    reset,
  } = useForm<AccountSettings>({
    resolver: zodResolver(accountSettingsSchema),
    defaultValues: { displayName: account.displayName, theme: account.theme, replyNote: account.replyNote },
  });

  // Preview the theme as soon as it's picked; it's saved with the form.
  const theme = useWatch({ control, name: "theme" });
  useEffect(() => setThemePreference(theme), [theme]);
  // Leaving without saving puts the saved theme back.
  const savedTheme = useRef(account.theme);
  savedTheme.current = account.theme;
  useEffect(() => () => setThemePreference(savedTheme.current), []);

  return (
    <form
      className="mt-10 grid max-w-[520px] gap-8"
      noValidate
      onSubmit={handleSubmit((values) =>
        save.mutate(values, {
          onSuccess: (o) => {
            reset({ displayName: o.displayName, theme: o.theme, replyNote: o.replyNote });
            toast("Settings saved");
          },
        }),
      )}
    >
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-medium">Theme</legend>
        <div className="segmented" role="radiogroup">
          {THEMES.map((t) => (
            <span key={t.value} className="contents">
              <input type="radio" id={`t-${t.value}`} value={t.value} {...register("theme")} />
              <label htmlFor={`t-${t.value}`}>{t.label}</label>
            </span>
          ))}
        </div>
        <p className="hint">For this dashboard. People reading your documents see their own system theme.</p>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input
          className="input"
          id="name"
          autoComplete="name"
          aria-invalid={errors.displayName ? "true" : undefined}
          aria-describedby="name-hint"
          {...register("displayName")}
        />
        {errors.displayName ? (
          <FieldError id="name-hint">{errors.displayName.message}</FieldError>
        ) : (
          <p className="hint" id="name-hint">
            Readers see “Shared by {account.displayName}” on every document.
          </p>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="note">
          Reply note
        </label>
        <input
          className="input"
          id="note"
          placeholder="I usually reply within a day."
          aria-describedby="note-hint"
          {...register("replyNote")}
        />
        <p className="hint" id="note-hint">
          Shown under “Questions about this document?” next to the Reply button.
        </p>
      </div>

      <div className="field">
        <span className="label">Sign-in email</span>
        <p className="mono text-text-secondary">{account.email}</p>
        <p className="hint">You can’t change your email here. An admin can help.</p>
      </div>

      {save.isError && (
        <p className="error" role="alert">
          <ErrorIcon />
          {save.error.message}
        </p>
      )}

      <div>
        <button className="btn btn-primary" type="submit" disabled={save.isPending || !isDirty}>
          Save settings
        </button>
      </div>
    </form>
  );
}

function UsageSection({ account }: { account: Account }) {
  const u = account.usage;
  const lines = usageLines(u);
  return (
    <section className="mt-12 grid max-w-[520px] gap-6" aria-labelledby="usage-h">
      <h2 id="usage-h" className="group-title">
        Your space
      </h2>
      <dl className="m-0 grid grid-cols-2 gap-6 max-[520px]:grid-cols-1">
        <div>
          <dt className="text-sm text-text-secondary">Documents</dt>
          <dd className="num m-0 mt-1 text-body">{lines.documents}</dd>
          <UsageBar used={u.documents} max={u.maxDocuments} />
        </div>
        <div>
          <dt className="text-sm text-text-secondary">Storage</dt>
          <dd className="num m-0 mt-1 text-body">{lines.storage}</dd>
          <UsageBar used={u.storageBytes} max={u.maxStorageBytes} />
        </div>
      </dl>
      <p className="hint">
        {account.isAdmin
          ? "Admins have no limits."
          : "Storage counts every version of every document. Ask an admin if you need more room."}
      </p>
    </section>
  );
}

function PasswordForm() {
  const change = useChangePassword();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<PasswordChange>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const fieldError = change.error instanceof ApiError && Object.keys(change.error.fields).length > 0;

  return (
    <form
      className="mt-12 grid max-w-[520px] gap-6"
      aria-labelledby="password-h"
      noValidate
      onSubmit={handleSubmit((input) =>
        change.mutate(input, {
          onSuccess: () => {
            reset();
            toast("Password changed. Other devices were signed out");
          },
          onError: (err) => {
            if (!(err instanceof ApiError)) return;
            for (const [field, message] of Object.entries(err.fields)) {
              if (field in input) setError(field as keyof PasswordChange, { message }, { shouldFocus: true });
            }
          },
        }),
      )}
    >
      <h2 id="password-h" className="group-title">
        Password
      </h2>
      <div className="field">
        <label className="label" htmlFor="current-password">
          Current password
        </label>
        <input
          className="input"
          id="current-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.currentPassword ? "true" : undefined}
          aria-describedby={errors.currentPassword ? "current-password-error" : undefined}
          {...register("currentPassword")}
        />
        {errors.currentPassword && <FieldError id="current-password-error">{errors.currentPassword.message}</FieldError>}
      </div>
      <div className="field">
        <label className="label" htmlFor="new-password">
          New password
        </label>
        <input
          className="input"
          id="new-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.newPassword ? "true" : undefined}
          aria-describedby={errors.newPassword ? "new-password-error" : "new-password-hint"}
          {...register("newPassword")}
        />
        {errors.newPassword ? (
          <FieldError id="new-password-error">{errors.newPassword.message}</FieldError>
        ) : (
          <p className="hint" id="new-password-hint">
            At least 8 characters. Your other devices are signed out; this one stays signed in.
          </p>
        )}
      </div>
      {change.isError && !fieldError && (
        <p className="error" role="alert">
          <ErrorIcon />
          {change.error.message}
        </p>
      )}
      <div>
        <button className="btn btn-secondary" type="submit" disabled={change.isPending}>
          {change.isPending ? "Changing…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

/** Tokens let the `vellum` CLI (and the agents that run it) upload as this account. */
function ApiTokensSection() {
  const { data: tokens } = useApiTokens();
  const revoke = useRevokeApiToken();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  return (
    <section className="mt-12 grid max-w-[520px] gap-4" aria-labelledby="tokens-h">
      <h2 id="tokens-h" className="group-title">
        API tokens
      </h2>
      <p className="hint m-0">
        The <code className="mono">vellum</code> command line tool uses a token to upload and publish documents as
        you, so your agents can share a file without you opening Vellum. A token can’t delete documents, see stats or
        change your account.
      </p>
      {tokens && tokens.length > 0 && (
        <ul className="m-0 list-none border-t border-line p-0">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-line py-3">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="mt-1 text-sm text-text-muted">
                  Made {formatLongDate(t.createdAt)} ·{" "}
                  {t.lastUsedAt ? `last used ${formatUpdated(t.lastUsedAt).toLowerCase()}` : "never used"}
                </div>
              </div>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate(t.id, { onSuccess: () => toast(`“${t.name}” revoked. It no longer works`) })
                }
              >
                Revoke<span className="visually-hidden"> token {t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <p className="error" role="alert">
          <ErrorIcon />
          {revoke.error.message}
        </p>
      )}
      <div>
        <button className="btn btn-secondary" type="button" onClick={() => setCreating(true)}>
          <PlusIcon />
          New token
        </button>
      </div>
      <TokenDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}

function TokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateApiToken();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const close = () => {
    onClose();
    setName("");
    setToken(null);
    create.reset();
  };
  const nameError = create.error instanceof ApiError ? create.error.fields.name : undefined;
  return (
    <Modal open={open} onClose={close} labelledBy="token-h" describedBy="token-d">
      <h2 id="token-h">{token ? "Copy your token" : "New API token"}</h2>
      {token ? (
        <>
          <p id="token-d">
            Run <code className="mono">vellum login --url {window.location.origin}</code> and paste it, or set it as{" "}
            <code className="mono">VELLUM_TOKEN</code>. You won’t see this token again.
          </p>
          <div className="mt-6">
            <CopyField id="token-value" label="Token" url={token} />
          </div>
          <form method="dialog" className="actions">
            <button className="btn btn-ink" type="submit" autoFocus>
              Done
            </button>
          </form>
        </>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(name, { onSuccess: (t) => setToken(t.token) });
          }}
        >
          <p id="token-d">Name it after where it will be used, so you know which one to revoke.</p>
          <div className="field mt-6">
            <label className="label" htmlFor="token-name">
              Name
            </label>
            <input
              className="input"
              id="token-name"
              value={name}
              maxLength={60}
              placeholder="claude-laptop"
              autoComplete="off"
              aria-invalid={nameError ? "true" : undefined}
              aria-describedby={nameError ? "token-name-error" : "token-name-hint"}
              onChange={(e) => setName(e.target.value)}
            />
            {nameError ? (
              <FieldError id="token-name-error">{nameError}</FieldError>
            ) : (
              <p className="hint" id="token-name-hint">
                Shown next to every version it uploads, as “via {name.trim() || "claude-laptop"}”.
              </p>
            )}
          </div>
          {create.isError && !nameError && (
            <p className="error mt-4" role="alert">
              <ErrorIcon />
              {create.error.message}
            </p>
          )}
          <div className="actions">
            <button className="btn btn-secondary" type="button" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-ink" type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create token"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
