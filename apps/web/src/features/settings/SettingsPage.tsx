import { zodResolver } from "@hookform/resolvers/zod";
import { ownerSettingsSchema, type Owner, type OwnerSettings } from "@vellum/shared";
import { useForm, useWatch } from "react-hook-form";
import { useEffect, useRef } from "react";
import { useMe, useUpdateSettings } from "../../api/hooks";
import { FieldError } from "../../components/FieldError";
import { ErrorIcon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import { Topbar } from "../../components/Topbar";
import { setThemePreference } from "../../lib/theme";

export function SettingsPage() {
  const { data: owner } = useMe();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar />
      <main id="main" className="page">
        <h1 className="display text-h1 max-[960px]:text-[44px]">Settings</h1>
        {owner && <SettingsForm owner={owner} />}
      </main>
    </>
  );
}

const THEMES = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

function SettingsForm({ owner }: { owner: Owner }) {
  const save = useUpdateSettings();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
    reset,
  } = useForm<OwnerSettings>({
    resolver: zodResolver(ownerSettingsSchema),
    defaultValues: { displayName: owner.displayName, theme: owner.theme, replyNote: owner.replyNote },
  });

  // Preview the theme as soon as it's picked; it's saved with the form.
  const theme = useWatch({ control, name: "theme" });
  useEffect(() => setThemePreference(theme), [theme]);
  // Leaving without saving puts the saved theme back.
  const savedTheme = useRef(owner.theme);
  savedTheme.current = owner.theme;
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
            Readers see “Shared by {owner.displayName}” on every document.
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
        <p className="mono text-text-secondary">{owner.email}</p>
        <p className="hint">Change it with OWNER_EMAIL and the owner:reset command on the server.</p>
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
