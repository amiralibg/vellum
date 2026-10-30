import { zodResolver } from "@hookform/resolvers/zod";
import {
  DOCUMENT_PASSWORD_MIN,
  documentSettingsSchema,
  type DocumentDetail,
  type DocumentSettings,
  type DocumentSettingsPatch,
  type ExpiryPreset,
} from "@vellum/shared";
import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import {
  useDocument,
  usePreview,
  usePublish,
  useSlugAvailability,
  useUpdateDocument,
  useUploadVersion,
} from "../../api/hooks";
import { FieldError } from "../../components/FieldError";
import { CheckIcon, ErrorIcon, LogoIcon } from "../../components/icons";
import { AccountMenu } from "../../components/Topbar";
import { useToast } from "../../components/Toast";
import { ApiError } from "../../lib/api";
import { useDebounced } from "../../lib/useDebounced";
import { DAY_MS, endOfDay, PRESET_DAYS, toDateInput, tomorrowInput } from "../../lib/expiry";
import { formatBytes, formatLongDate, formatNumber } from "../../lib/format";
import { acceptFor } from "../documents/useUploadFlow";

// The server checks these too; checking here keeps the error beside the field without a round trip.
const formSchema = documentSettingsSchema.superRefine((v, ctx) => {
  if (v.access !== "password") return;
  if (!v.password) {
    ctx.addIssue({ code: "custom", path: ["password"], message: "Choose a password readers will type to open it." });
  } else if (v.password.length < DOCUMENT_PASSWORD_MIN) {
    ctx.addIssue({ code: "custom", path: ["password"], message: `Use at least ${DOCUMENT_PASSWORD_MIN} characters.` });
  }
});

const EXPIRY_OPTIONS: { value: ExpiryPreset; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "date", label: "Date…" },
];

export function PublishPage() {
  const { id = "" } = useParams();
  const { data: doc, isError, error } = useDocument(id);

  if (isError) {
    return (
      <main className="page">
        <p className="error" role="alert">
          <ErrorIcon />
          {error.message}
        </p>
        <Link className="btn btn-secondary mt-6" to="/">
          Back to documents
        </Link>
      </main>
    );
  }
  if (!doc) return null;
  return <PublishForm doc={doc} />;
}

function PublishForm({ doc }: { doc: DocumentDetail }) {
  const navigate = useNavigate();
  const toast = useToast();
  const preview = usePreview(doc.id);
  const update = useUpdateDocument(doc.id);
  const publish = usePublish(doc.id);
  const replace = useUploadVersion(doc.id);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const isLive = doc.status === "live";
  const [showReply, setShowReply] = useState(Boolean(doc.replyEmail));

  const {
    register,
    handleSubmit,
    control,
    setError,
    clearErrors,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<DocumentSettings>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: doc.title,
      slug: doc.slug,
      access: doc.access,
      password: doc.password ?? "",
      expiryPreset: doc.expiryPreset,
      expiresAt: doc.expiresAt,
      trackViews: doc.trackViews,
      allowDownload: doc.allowDownload,
      noindex: doc.noindex,
      replyEmail: doc.replyEmail,
    },
  });
  const title = useWatch({ control, name: "title" });
  const slug = useWatch({ control, name: "slug" });
  const access = useWatch({ control, name: "access" });
  const expiryPreset = useWatch({ control, name: "expiryPreset" });
  const expiresAt = useWatch({ control, name: "expiresAt" });
  const expiryDirty = Boolean(dirtyFields.expiryPreset || dirtyFields.expiresAt);
  const debouncedSlug = useDebounced(slug.trim().toLowerCase(), 250);
  const availability = useSlugAvailability(debouncedSlug, doc.id);

  const busy = update.isPending || publish.isPending;
  const serverError = update.error ?? publish.error;

  const save = async (values: DocumentSettings, then: "draft" | "publish" | "save") => {
    const { password, expiryPreset: preset, expiresAt: closes, ...rest } = values;
    const patch: DocumentSettingsPatch = { ...rest, replyEmail: showReply ? values.replyEmail : "" };
    if (values.access === "password") patch.password = password;
    // Re-sending an unchanged "30 days" would restart the count, so expiry goes only when it was edited.
    if (expiryDirty) {
      if (preset === "date" && (!closes || Date.parse(closes) <= Date.now())) {
        setError("expiresAt", { message: "Pick a date in the future." }, { shouldFocus: true });
        return;
      }
      Object.assign(patch, { expiryPreset: preset, expiresAt: preset === "date" ? closes : null });
    }
    try {
      const saved = await update.mutateAsync(patch);
      if (then === "draft") return navigate("/");
      const live = then === "publish" ? await publish.mutateAsync() : saved;
      try {
        if (then === "publish") {
          await navigator.clipboard.writeText(live.url);
          toast("Published. Link copied");
        } else toast("Changes saved");
      } catch {
        toast("Published");
      }
      navigate(`/documents/${doc.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [field, message] of Object.entries(err.fields)) {
          if (field in values) setError(field as keyof DocumentSettings, { message });
        }
      }
    }
  };

  const host = location.host;
  const closesAt =
    expiryPreset === "date"
      ? expiresAt
      : expiryPreset === "never"
        ? null
        : !expiryDirty && doc.publishedAt && doc.expiresAt
          ? doc.expiresAt
          : new Date(Date.now() + PRESET_DAYS[expiryPreset]! * DAY_MS).toISOString();
  const slugStatus =
    errors.slug?.message ??
    (availability.data && availability.data.slug === debouncedSlug && !availability.data.available
      ? availability.data.reason === "taken"
        ? "Another document already uses this link."
        : "Use lowercase letters, numbers and single hyphens."
      : "");

  return (
    <div className="flex min-h-dvh flex-col">
      <a className="skip-link" href="#settings">
        Skip to settings
      </a>
      <header className="topbar">
        <div className="topbar-inner" style={{ maxWidth: "none" }}>
          <Link className="wordmark" to="/" aria-label="Vellum, back to documents">
            <LogoIcon />
          </Link>
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to="/">Documents</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{doc.publishedAt ? doc.slug : "New document"}</span>
          </nav>
          <span className="spacer" />
          <AccountMenu />
        </div>
      </header>

      <main className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_420px] max-[1000px]:grid-cols-1">
        <section
          className="border-e border-line bg-sunken px-10 py-8 max-[1000px]:border-e-0 max-[1000px]:border-b max-[1000px]:px-4 max-[1000px]:py-6"
          aria-label="Preview"
        >
          <div className={clsx("mx-auto mb-4 flex items-center justify-between", doc.kind !== "html" && "max-w-[760px]")}>
            <span className="eyebrow">Preview · as your reader sees it</span>
            <div className="segmented" role="radiogroup" aria-label="Preview width">
              <input type="radio" name="w" id="w-desk" checked={width === "desktop"} onChange={() => setWidth("desktop")} />
              <label htmlFor="w-desk">Desktop</label>
              <input type="radio" name="w" id="w-mob" checked={width === "mobile"} onChange={() => setWidth("mobile")} />
              <label htmlFor="w-mob">Mobile</label>
            </div>
          </div>
          {doc.kind === "html" ? (
            <PreviewFrame
              key={preview.data?.frameUrl ?? "loading"}
              src={preview.data?.frameUrl ?? undefined}
              title={`Preview of ${title || doc.title}`}
              width={width}
            />
          ) : (
            <article
              className={clsx(
                "sheet mx-auto rounded-md bg-surface outline outline-line transition-[max-width] duration-200 ease-out",
                width === "desktop" ? "max-w-[760px] px-16 pt-16 pb-12 max-[1000px]:px-6 max-[1000px]:py-8" : "max-w-[390px] px-6 py-8",
              )}
            >
              {preview.data?.eyebrow && <p className="eyebrow">{preview.data.eyebrow}</p>}
              <h1>{title || "Untitled document"}</h1>
              {preview.data?.description && <p className="dek">{preview.data.description}</p>}
              <hr className="rule" />
              {/* Sanitized on the server when the file was uploaded (no raw HTML, no scripts). */}
              <div className="body" dangerouslySetInnerHTML={{ __html: preview.data?.html ?? "" }} />
            </article>
          )}
        </section>

        <aside className="flex min-w-0 flex-col bg-canvas" id="settings">
          <form
            className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 px-8 pt-8 pb-10"
            noValidate
            onSubmit={handleSubmit((v) => save(v, isLive ? "save" : "publish"))}
            id="publish-form"
          >
            <h1 className="text-h3 leading-[1.2] font-medium tracking-[-0.01em]">Publish settings</h1>

            <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
              <div className="mini" aria-hidden="true" style={{ width: 32, padding: 4 }}>
                <div className="l" />
                <div className="l m" />
                <div className="l s" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-ui">{doc.version.originalName}</div>
                <div className="text-xs text-text-muted">
                  {replace.isPending
                    ? "Uploading the new version…"
                    : fileSummary(doc)}
                </div>
              </div>
              <input
                ref={replaceInput}
                type="file"
                id="replace-file"
                accept={acceptFor(doc.kind)}
                className="peer absolute size-px opacity-0"
                disabled={replace.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) replace.mutate(file, { onSuccess: () => toast("New version uploaded. The link stays the same.") });
                }}
              />
              <label
                className="btn btn-ghost peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
                htmlFor="replace-file"
                aria-label={`Replace ${doc.version.originalName} with a new version`}
              >
                Replace
              </label>
            </div>
            {replace.isError && (
              <p className="error -mt-3" role="alert">
                <ErrorIcon />
                {replace.error.message}
              </p>
            )}

            <div className="field">
              <label className="label" htmlFor="title">
                Title
              </label>
              <input
                className="input"
                id="title"
                aria-invalid={errors.title ? "true" : undefined}
                aria-describedby="title-hint"
                {...register("title")}
              />
              {errors.title ? (
                <FieldError id="title-hint">{errors.title.message}</FieldError>
              ) : (
                <p className="hint" id="title-hint">
                  {doc.kind === "html" ? "Taken from the page’s <title>." : "Taken from the first heading."} Shown in the
                  browser tab and link previews.
                </p>
              )}
            </div>

            <div className="field">
              <label className="label" htmlFor="slug">
                Link
              </label>
              <div className="input-group">
                <span className="prefix">{host}/p/</span>
                <input
                  className="input"
                  id="slug"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-invalid={slugStatus ? "true" : undefined}
                  aria-describedby="slug-status"
                  {...register("slug")}
                />
              </div>
              <div id="slug-status" aria-live="polite">
                {slugStatus ? (
                  <FieldError id="slug-error">{slugStatus}</FieldError>
                ) : availability.data?.available && availability.data.slug === debouncedSlug ? (
                  <p className="flex items-center gap-1.5 text-sm text-status-live">
                    <CheckIcon className="size-3.5" />
                    {debouncedSlug === doc.slug && doc.publishedAt ? "This is the current link" : "This link is available"}
                  </p>
                ) : null}
              </div>
              {isLive && slug !== doc.slug && (
                <p className="hint">People who already have the old link will see “not found”.</p>
              )}
            </div>

            <p className="group-title">Access</p>

            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-medium">Who can open it</legend>
              <div className="segmented flex" role="radiogroup">
                <input type="radio" id="a-link" value="link" {...register("access")} />
                <label className="flex-1 justify-center" htmlFor="a-link">
                  Anyone with the link
                </label>
                <input type="radio" id="a-pass" value="password" {...register("access")} />
                <label className="flex-1 justify-center" htmlFor="a-pass">
                  Password
                </label>
              </div>
            </fieldset>

            {access === "password" && (
              <div className="field">
                <label className="label" htmlFor="pw">
                  Password
                </label>
                <input
                  className="input"
                  id="pw"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  aria-invalid={errors.password ? "true" : undefined}
                  aria-describedby="pw-hint"
                  {...register("password")}
                />
                {errors.password ? (
                  <FieldError id="pw-hint">{errors.password.message}</FieldError>
                ) : (
                  <p className="hint" id="pw-hint">
                    Send it separately from the link.
                  </p>
                )}
              </div>
            )}

            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-medium">Link expires</legend>
              <div className="segmented flex" role="radiogroup">
                {EXPIRY_OPTIONS.map((o) => (
                  <span key={o.value} className="contents">
                    <input type="radio" id={`e-${o.value}`} value={o.value} {...register("expiryPreset")} />
                    <label className="flex-1 justify-center" htmlFor={`e-${o.value}`}>
                      {o.label}
                    </label>
                  </span>
                ))}
              </div>
              {expiryPreset === "date" && (
                <>
                  <label className="visually-hidden" htmlFor="exp-date">
                    Last day the link works
                  </label>
                  <input
                    className="input"
                    id="exp-date"
                    type="date"
                    min={tomorrowInput()}
                    value={toDateInput(expiresAt)}
                    aria-invalid={errors.expiresAt ? "true" : undefined}
                    aria-describedby="exp-hint"
                    onChange={(e) => {
                      setValue("expiresAt", endOfDay(e.target.value), { shouldDirty: true });
                      clearErrors("expiresAt");
                    }}
                  />
                </>
              )}
              {errors.expiresAt ? (
                <FieldError id="exp-hint">{errors.expiresAt.message}</FieldError>
              ) : (
                <p className="hint" id="exp-hint">
                  <ExpiryHint preset={expiryPreset} closesAt={closesAt} />
                </p>
              )}
            </fieldset>

            <p className="group-title">Options</p>

            <label className="check">
              <input type="checkbox" {...register("trackViews")} />
              <span>Track views</span>
              <span className="hint">Counts opens and how far people read. No cookies.</span>
            </label>
            <label className="check">
              <input type="checkbox" {...register("allowDownload")} />
              <span>Allow downloading the original file</span>
            </label>
            <label className="check">
              <input type="checkbox" {...register("noindex")} />
              <span>Hide from search engines</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={showReply} onChange={(e) => setShowReply(e.target.checked)} />
              <span>Show a Reply button</span>
              <span className="hint">
                Opens the reader’s email app with a message to you
                {doc.kind === "html" ? ", from the bar above the page." : ", from the end of the document."}
              </span>
            </label>
            {showReply && (
              <div className="field ps-7">
                <label className="label" htmlFor="reply">
                  Reply email
                </label>
                <input
                  className="input"
                  id="reply"
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  aria-invalid={errors.replyEmail ? "true" : undefined}
                  aria-describedby={errors.replyEmail ? "reply-error" : undefined}
                  {...register("replyEmail")}
                />
                {errors.replyEmail && <FieldError id="reply-error">{errors.replyEmail.message}</FieldError>}
              </div>
            )}

            {serverError && !Object.keys((serverError as ApiError).fields ?? {}).length && (
              <p className="error" role="alert">
                <ErrorIcon />
                {serverError.message}
              </p>
            )}
          </form>

          <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-canvas px-8 py-4">
            {isLive ? (
              <Link className="btn btn-secondary" to={`/documents/${doc.id}`}>
                Cancel
              </Link>
            ) : (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={busy}
                onClick={handleSubmit((v) => save(v, "draft"))}
              >
                Save as draft
              </button>
            )}
            <button className="btn btn-primary" type="submit" form="publish-form" disabled={busy}>
              {isLive ? "Save changes" : busy ? "Publishing…" : "Publish and copy link"}
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}

// The desktop preview lays the page out at a real laptop width and scales it down to fit,
// so breakpoints and proportions match what readers see instead of a tablet-width column.
const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 390;

function PreviewFrame({ src, title, width }: { src?: string; title: string; width: "desktop" | "mobile" }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry!.contentRect;
      setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameWidth = width === "desktop" ? DESKTOP_WIDTH : MOBILE_WIDTH;
  const scale = size.w ? Math.min(1, size.w / frameWidth) : 1;
  return (
    <div
      ref={box}
      className="relative h-[calc(100dvh-180px)] min-h-[520px] w-full overflow-hidden max-[1000px]:h-[520px]"
    >
      <iframe
        src={src}
        title={title}
        sandbox="allow-scripts allow-popups"
        referrerPolicy="no-referrer"
        className="absolute top-0 left-1/2 block origin-top rounded-md bg-surface outline outline-line"
        style={{
          width: frameWidth,
          height: size.h ? size.h / scale : "100%",
          transform: `translateX(-50%) scale(${scale})`,
        }}
      />
    </div>
  );
}

function ExpiryHint({ preset, closesAt }: { preset: ExpiryPreset; closesAt: string | null }) {
  if (preset === "never") return <>The link works until you unpublish it.</>;
  if (!closesAt) return <>Pick the last day the link works.</>;
  const date = <span className="num">{formatLongDate(closesAt)}</span>;
  if (Date.parse(closesAt) <= Date.now()) return <>Closed on {date}. Choose another option to share it again.</>;
  return <>Closes on {date}. Readers after that see an “expired” page.</>;
}

function fileSummary(doc: DocumentDetail): string {
  const size = formatBytes(doc.version.sizeBytes);
  if (doc.version.sourceType === "zip") return `${size} · Zip with index.html`;
  if (doc.version.sourceType === "html") return `${size} · HTML`;
  return `${size} · Markdown · ${formatNumber(doc.version.wordCount)} words`;
}
