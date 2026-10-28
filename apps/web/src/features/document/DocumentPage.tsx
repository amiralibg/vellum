import type { DocumentDetail } from "@vellum/shared";
import clsx from "clsx";
import { useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useDeleteDocument,
  useDocument,
  useRestoreVersion,
  useUnpublish,
  useUploadVersion,
  useVersions,
} from "../../api/hooks";
import { ClockIcon, CopyIcon, ErrorIcon, LockIcon } from "../../components/icons";
import { Status } from "../../components/Status";
import { useCopyLink, useToast } from "../../components/Toast";
import { Topbar } from "../../components/Topbar";
import { DAY_MS } from "../../lib/expiry";
import { formatBytes, formatDay, formatLongDate, formatNumber, formatShortDate } from "../../lib/format";
import { acceptFor } from "../documents/useUploadFlow";
import { Analytics } from "./Analytics";

export function DocumentPage() {
  const { id = "" } = useParams();
  const { data: doc, isError, error } = useDocument(id);
  const copy = useCopyLink();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar />
      <main id="main" className="page">
        {isError ? (
          <p className="error" role="alert">
            <ErrorIcon />
            {error.message}
          </p>
        ) : !doc ? null : (
          <>
            <nav className="crumbs mb-6" aria-label="Breadcrumb">
              <Link to="/">Documents</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page" className="!font-normal">
                {doc.slug}
              </span>
            </nav>

            <div className="flex flex-wrap items-start justify-between gap-8">
              <div>
                <h1 className="display max-w-[18ch] text-[48px] max-[1000px]:text-[36px]">{doc.title}</h1>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-secondary [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&_svg]:size-3.5">
                  <Status status={doc.status} expiresAt={doc.status === "live" ? doc.expiresAt : null} />
                  {doc.access === "password" ? (
                    <span>
                      <LockIcon />
                      Password
                    </span>
                  ) : (
                    <span>Anyone with the link</span>
                  )}
                  {/* Status already says "Expires in N days" in the last week, and "Expired" after. */}
                  {doc.status === "live" && doc.expiresAt && Date.parse(doc.expiresAt) - Date.now() >= 7 * DAY_MS && (
                    <span>
                      <ClockIcon />
                      Expires {formatShortDate(doc.expiresAt)}
                    </span>
                  )}
                  <span className="badge">{doc.kind === "markdown" ? "MD" : "HTML"}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {doc.status === "live" && (
                  <a className="btn btn-secondary" href={doc.url} target="_blank" rel="noopener">
                    Open as reader
                  </a>
                )}
                <Link className="btn btn-secondary" to={`/documents/${doc.id}/publish`}>
                  Edit settings
                </Link>
              </div>
            </div>

            <div className="mt-10 mb-12 flex items-center gap-4 rounded-md border border-dashed border-line-strong bg-surface py-4 ps-6 pe-4 max-[1000px]:flex-wrap max-[1000px]:p-4">
              <p
                className="min-w-0 flex-1 font-mono text-[22px] leading-[1.3] tracking-[-0.02em] [overflow-wrap:anywhere] max-[1000px]:basis-full max-[1000px]:text-body"
                id="share-url"
              >
                <span className="text-text-muted">{doc.url.slice(0, doc.url.length - doc.slug.length)}</span>
                {doc.slug}
              </p>
              {doc.password && (
                <p className="border-s border-line px-4 text-sm whitespace-nowrap text-text-secondary max-[1000px]:border-0 max-[1000px]:p-0">
                  Password
                  <b className="block font-mono text-ui leading-[1.4] font-medium text-text">{doc.password}</b>
                </p>
              )}
              {doc.status === "live" ? (
                <button
                  className="btn btn-primary btn-lg max-[1000px]:ms-auto"
                  type="button"
                  aria-describedby="share-url"
                  onClick={() => copy(doc.url)}
                >
                  <CopyIcon />
                  Copy link
                </button>
              ) : (
                <Link className="btn btn-primary btn-lg max-[1000px]:ms-auto" to={`/documents/${doc.id}/publish`}>
                  Publish
                </Link>
              )}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-16 max-[1000px]:grid-cols-[minmax(0,1fr)]">
              <Analytics doc={doc} />

              <aside className="grid content-start gap-10" aria-label="Document details">
                <Versions doc={doc} />

                <div>
                  <h2 className="mb-4 text-ui leading-[1.3] font-medium">Details</h2>
                  <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm [&_dd]:m-0 [&_dd]:text-end [&_dt]:text-text-muted">
                    <dt>Created</dt>
                    <dd>{formatLongDate(doc.createdAt)}</dd>
                    <dt>Size</dt>
                    <dd>
                      {formatBytes(doc.version.sizeBytes)}
                      {doc.kind === "markdown" ? ` · ${formatNumber(doc.version.wordCount)} words` : ""}
                    </dd>
                    <dt>Download original</dt>
                    <dd>{doc.allowDownload ? "On" : "Off"}</dd>
                    <dt>Search engines</dt>
                    <dd>{doc.noindex ? "Hidden" : "Allowed"}</dd>
                    <dt>Track views</dt>
                    <dd>{doc.trackViews ? "On" : "Off"}</dd>
                    <dt>Reply button</dt>
                    <dd className="truncate">{doc.replyEmail || "Off"}</dd>
                  </dl>
                </div>

                <Danger doc={doc} />
              </aside>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Versions({ doc }: { doc: DocumentDetail }) {
  const versions = useVersions(doc.id);
  const upload = useUploadVersion(doc.id);
  const restore = useRestoreVersion(doc.id);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const error = upload.error ?? restore.error ?? versions.error;

  return (
    <div>
      <h2 className="mb-4 text-ui leading-[1.3] font-medium">Versions</h2>
      <ul className="m-0 list-none border-t border-line p-0" aria-busy={versions.isPending || undefined}>
        {(versions.data ?? []).map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 border-b border-line py-3 text-ui">
            <span className={clsx("min-w-0 [overflow-wrap:anywhere]", !v.current && "text-text-secondary")}>
              v{v.number} · {v.originalName}
              {v.current && <span className="badge ms-1">{doc.status === "live" ? "Live" : "Current"}</span>}
            </span>
            <span className="flex flex-none items-center gap-1 text-sm text-text-muted">
              {formatDay(v.createdAt)}
              {!v.current && (
                <button
                  className="btn btn-ghost -my-1 -me-2 min-h-7 px-2 text-sm"
                  type="button"
                  disabled={restore.isPending}
                  aria-label={`Restore version ${v.number}, ${v.originalName}`}
                  onClick={() =>
                    restore.mutate(v.id, { onSuccess: () => toast(`Version ${v.number} is current again`) })
                  }
                >
                  Restore
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="hint my-3">Upload a new file and the link stays the same.</p>
      <input
        ref={input}
        type="file"
        id="version-file"
        accept={acceptFor(doc.kind)}
        className="peer absolute size-px opacity-0"
        disabled={upload.isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file, { onSuccess: (d) => toast(`Version ${d.version.number} uploaded`) });
        }}
      />
      <label
        className="btn btn-secondary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
        htmlFor="version-file"
      >
        {upload.isPending ? "Uploading…" : "Upload new version"}
      </label>
      {error && (
        <p className="error mt-3" role="alert">
          <ErrorIcon />
          {error.message}
        </p>
      )}
    </div>
  );
}

function Danger({ doc }: { doc: DocumentDetail }) {
  const unpublish = useUnpublish(doc.id);
  const remove = useDeleteDocument(doc.id);
  const toast = useToast();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <div className="grid gap-2 border-t border-line pt-6 [&>.btn]:justify-start [&>.btn]:px-0">
      {doc.status === "live" && (
        <button
          className="btn btn-ghost"
          type="button"
          disabled={unpublish.isPending}
          onClick={() => unpublish.mutate(undefined, { onSuccess: () => toast("Unpublished. The link now shows “not found”") })}
        >
          Unpublish (keeps the file and stats)
        </button>
      )}
      <button className="btn btn-ghost" type="button" onClick={() => dialog.current?.showModal()}>
        Delete document…
      </button>
      {unpublish.isError && (
        <p className="error" role="alert">
          <ErrorIcon />
          {unpublish.error.message}
        </p>
      )}

      <dialog ref={dialog} className="dialog" aria-labelledby="delete-h" aria-describedby="delete-d">
        <h2 id="delete-h">Delete “{doc.title}”?</h2>
        <p id="delete-d">
          This removes every version, the file and its stats.{" "}
          {doc.status === "live" ? "People who open the link will see “not found”. " : ""}This can’t be undone.
        </p>
        {remove.isError && (
          <p className="error" role="alert">
            <ErrorIcon />
            {remove.error.message}
          </p>
        )}
        <form method="dialog" className="actions">
          <button className="btn btn-secondary" type="submit" autoFocus>
            Cancel
          </button>
          <button
            className="btn btn-ink"
            type="button"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  dialog.current?.close();
                  toast(`Deleted “${doc.title}”`);
                  navigate("/", { replace: true });
                },
              })
            }
          >
            {remove.isPending ? "Deleting…" : "Delete document"}
          </button>
        </form>
      </dialog>
    </div>
  );
}
