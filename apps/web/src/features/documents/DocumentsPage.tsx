import * as Menu from "@radix-ui/react-dropdown-menu";
import type { DocumentSummary } from "@vellum/shared";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useDocuments, type ListFilter } from "../../api/hooks";
import { ErrorIcon, LinkIcon, LockIcon, MoreIcon, PlusIcon, SearchIcon, UploadIcon } from "../../components/icons";
import { Mini } from "../../components/Mini";
import { Status } from "../../components/Status";
import { useCopyLink } from "../../components/Toast";
import { Topbar } from "../../components/Topbar";
import { formatNumber, formatUpdated } from "../../lib/format";
import { useDebounced } from "../../lib/useDebounced";
import { ACCEPT, useUploadFlow } from "./useUploadFlow";

const FILTERS: { value: ListFilter; label: string; count: "all" | "live" | "drafts" | "expired" }[] = [
  { value: "all", label: "All", count: "all" },
  { value: "live", label: "Live", count: "live" },
  { value: "drafts", label: "Drafts", count: "drafts" },
  { value: "expired", label: "Expired", count: "expired" },
];

const COLUMNS = "grid-cols-[56px_minmax(0,1fr)_64px_150px_88px_96px_84px]";

export function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get("status") as ListFilter | null) ?? "all";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search, 200);
  const { data, isPending, isError, error } = useDocuments(filter, q);
  const { start, upload } = useUploadFlow();
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const dragging = useDragAnywhere((file) => start(file));

  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set("q", q);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [q, setParams]);

  // "/" focuses search, as the kbd hint in the top bar promises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !target.closest("input, textarea, [contenteditable]")) {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const setFilter = (value: ListFilter) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "all") next.delete("status");
      else next.set("status", value);
      return next;
    });

  const counts = data?.counts;
  const total = counts?.all ?? 0;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar>
        <div className="search max-[960px]:hidden" role="search">
          <SearchIcon />
          <label className="visually-hidden" htmlFor="q">
            Search documents
          </label>
          <input
            ref={searchInput}
            className="input"
            id="q"
            type="search"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!search && <kbd aria-hidden="true">/</kbd>}
        </div>
        <button className="btn btn-primary" type="button" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
          <PlusIcon />
          Upload
        </button>
      </Topbar>

      <main id="main" className="page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="display text-h1 max-[960px]:text-[44px]">Documents</h1>
            <p className="mt-3 text-body text-text-secondary">
              <span className="num">{formatNumber(total)}</span> {total === 1 ? "document" : "documents"} ·{" "}
              <span className="num">{formatNumber(data?.viewsThisMonth ?? 0)}</span> views this month
            </p>
          </div>
        </div>

        <div
          className={clsx(
            "mt-10 mb-8 flex items-center gap-4 rounded-md border border-dashed px-6 py-5 transition-[background-color,border-color] duration-[120ms] ease-out max-[960px]:flex-wrap",
            dragging ? "border-ink bg-surface" : "border-line-strong",
          )}
        >
          <UploadIcon className="size-6 flex-none text-text-muted" />
          <p className="flex-1 text-body max-[960px]:basis-[calc(100%-48px)]">
            {upload.isPending ? (
              "Uploading…"
            ) : (
              <>
                Drop a <code className="mono">.md</code> or <code className="mono">.html</code> file anywhere to publish it
                <span className="block text-sm text-text-muted">
                  HTML with images or CSS? Upload a .zip with an index.html at the root.
                </span>
              </>
            )}
          </p>
          <input
            ref={fileInput}
            type="file"
            id="file"
            accept={ACCEPT}
            className="peer absolute size-px opacity-0"
            onChange={(e) => {
              start(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <label className="btn btn-secondary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus" htmlFor="file">
            Choose file
          </label>
        </div>
        {upload.isError && (
          <p className="error -mt-5 mb-8" role="alert">
            <ErrorIcon />
            {upload.error.message}
          </p>
        )}

        <div className="mb-3 flex items-center justify-between gap-4 max-[960px]:flex-wrap">
          <div className="segmented" role="radiogroup" aria-label="Filter documents">
            {FILTERS.map((f) => (
              <span key={f.value} className="contents">
                <input
                  type="radio"
                  name="f"
                  id={`f-${f.value}`}
                  checked={filter === f.value}
                  onChange={() => setFilter(f.value)}
                />
                <label htmlFor={`f-${f.value}`}>
                  {f.label} <span className="count">{counts ? counts[f.count] : ""}</span>
                </label>
              </span>
            ))}
          </div>
          <span className="text-sm text-text-muted max-[960px]:hidden">Sorted by last updated</span>
        </div>

        <div
          className={clsx(
            "grid gap-5 px-3 pb-2 font-mono text-xs leading-none font-medium tracking-[0.06em] text-text-muted uppercase max-[960px]:hidden",
            COLUMNS,
          )}
          aria-hidden="true"
        >
          <span />
          <span>Document</span>
          <span>Type</span>
          <span>Status</span>
          <span className="text-end">Views</span>
          <span>Updated</span>
          <span />
        </div>

        {isError ? (
          <p className="error border-t border-line py-8" role="alert">
            <ErrorIcon />
            {error.message}
          </p>
        ) : isPending ? (
          <ul className="border-t border-line" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-[107px] border-b border-line" />
            ))}
          </ul>
        ) : data.documents.length === 0 ? (
          <EmptyState query={q} filter={filter} onChoose={() => fileInput.current?.click()} />
        ) : (
          <ul className="m-0 list-none border-t border-line p-0">
            {data.documents.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function DocumentRow({ doc }: { doc: DocumentSummary }) {
  const copy = useCopyLink();
  const navigate = useNavigate();
  const shared = doc.status === "live";
  // Unpublishing keeps the stats, so only drafts have nothing to count.
  const counted = doc.status !== "draft";
  const url = `${location.origin}/p/${doc.slug}`;
  return (
    <li
      className={clsx(
        "relative grid items-center gap-5 border-b border-line px-3 py-4 transition-[background-color] duration-[120ms] ease-out hover:bg-hover",
        COLUMNS,
        "max-[960px]:grid-cols-[48px_minmax(0,1fr)_auto] max-[960px]:gap-y-2",
      )}
    >
      <Mini title={doc.title} kind={doc.kind} dim={!shared} className="max-[960px]:row-span-2 max-[960px]:w-12" />
      <div className="min-w-0">
        <Link
          className="block truncate text-body leading-[1.3] font-medium no-underline after:absolute after:inset-0"
          to={shared ? `/documents/${doc.id}` : `/documents/${doc.id}/publish`}
        >
          {doc.title}
        </Link>
        <div className="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
          {doc.access === "password" && <LockIcon className="size-[13px]" role="img" aria-label="Password protected" aria-hidden={false} />}
          <span className="mono">/p/{doc.slug}</span>
        </div>
      </div>
      <span className="badge justify-self-start max-[960px]:hidden">{doc.kind === "markdown" ? "MD" : "HTML"}</span>
      <span className="max-[960px]:col-start-2">
        <Status status={doc.status} expiresAt={doc.expiresAt} />
      </span>
      <span className={clsx("num text-end text-ui max-[960px]:col-start-3 max-[960px]:row-start-1", !counted && "text-text-muted")}>
        {counted ? formatNumber(doc.views) : "—"}
        <small className="block text-xs text-text-muted">
          {counted ? `${formatNumber(doc.people)} ${doc.people === 1 ? "person" : "people"}` : "Not shared"}
        </small>
      </span>
      <span className="text-sm text-text-secondary max-[960px]:hidden">{formatUpdated(doc.updatedAt)}</span>
      <div className="relative flex justify-end gap-1 max-[960px]:col-start-3 max-[960px]:row-start-2">
        {shared && (
          <button className="btn btn-ghost btn-icon" type="button" aria-label={`Copy link to ${doc.title}`} onClick={() => copy(url)}>
            <LinkIcon />
          </button>
        )}
        <Menu.Root>
          <Menu.Trigger className="btn btn-ghost btn-icon" aria-label={`More actions for ${doc.title}`}>
            <MoreIcon />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="menu" align="end" sideOffset={4}>
              {shared && (
                <Menu.Item className="menu-item" onSelect={() => window.open(url, "_blank", "noopener")}>
                  Open as reader
                </Menu.Item>
              )}
              <Menu.Item className="menu-item" onSelect={() => navigate(`/documents/${doc.id}/publish`)}>
                Edit settings
              </Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => navigate(`/documents/${doc.id}`)}>
                Details
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </li>
  );
}

function EmptyState({ query, filter, onChoose }: { query: string; filter: ListFilter; onChoose: () => void }) {
  if (query) {
    return (
      <div className="border-t border-line py-16">
        <p className="text-body">No documents match “{query}”.</p>
        <p className="mt-1 text-text-muted">Search looks at titles and links.</p>
      </div>
    );
  }
  if (filter !== "all") {
    return (
      <div className="border-t border-line py-16">
        <p className="text-body">Nothing here yet.</p>
        <p className="mt-1 text-text-muted">Documents appear in this list when their status matches the filter.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-6 border-t border-line py-16">
      <div>
        <p className="text-body">Your library is empty.</p>
        <p className="mt-1 text-text-muted">Upload a Markdown file and Vellum gives you a link to send instead of an attachment.</p>
      </div>
      <button className="btn btn-secondary" type="button" onClick={onChoose}>
        Choose a file
      </button>
    </div>
  );
}

/** Highlights the drop zone while a file is dragged anywhere over the page, uploads on drop. */
function useDragAnywhere(onFile: (file: File) => void): boolean {
  const [over, setOver] = useState(false);
  const cb = useRef(onFile);
  cb.current = onFile;
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) cb.current(file);
    };
    addEventListener("dragenter", enter);
    addEventListener("dragover", overFn);
    addEventListener("dragleave", leave);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragover", overFn);
      removeEventListener("dragleave", leave);
      removeEventListener("drop", drop);
    };
  }, []);
  return over;
}
