import { zodResolver } from "@hookform/resolvers/zod";
import {
  accountSettingsSchema,
  passwordChangeSchema,
  type Account,
  type AccountSettings,
  type PasswordChange,
} from "@vellum/shared";
import { useForm, useWatch } from "react-hook-form";
import { useEffect, useRef } from "react";
import { useChangePassword, useMe, useUpdateSettings } from "../../api/hooks";
import { FieldError } from "../../components/FieldError";
import { ErrorIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { Topbar } from "../../components/Topbar";
import { UsageBar, usageLines } from "../../components/Usage";
import { ApiError } from "../../lib/api";
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
