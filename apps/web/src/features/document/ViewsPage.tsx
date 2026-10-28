import { Link, useParams, useSearchParams } from "react-router";
import { useDocument, useDocumentViews } from "../../api/hooks";
import { ErrorIcon } from "../../components/icons";
import { Topbar } from "../../components/Topbar";
import { formatNumber } from "../../lib/format";
import { ViewsTable } from "./Analytics";

/** "See all" from Recent views: every view of one document, newest first, 50 to a page. */
export function ViewsPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const doc = useDocument(id);
  const views = useDocumentViews(id, page);
  const error = doc.error ?? views.error;
  const data = views.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const go = (n: number) => setParams(n === 1 ? {} : { page: String(n) });

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar />
      <main id="main" className="page">
        {error ? (
          <p className="error" role="alert">
            <ErrorIcon />
            {error.message}
          </p>
        ) : !doc.data || !data ? null : (
          <>
            <nav className="crumbs mb-6" aria-label="Breadcrumb">
              <Link to="/">Documents</Link>
              <span aria-hidden="true">/</span>
              <Link to={`/documents/${id}`}>{doc.data.slug}</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page" className="!font-normal">
                Views
              </span>
            </nav>
            <h1 className="display max-w-[18ch] text-[48px] max-[1000px]:text-[36px]">All views</h1>
            <p className="mt-3 mb-10 text-body text-text-secondary">
              <span className="num">{formatNumber(data.total)}</span> {data.total === 1 ? "view" : "views"} of “
              {doc.data.title}”, newest first
            </p>

            {data.total === 0 ? (
              <p className="border-t border-line py-12 text-text-muted">No views yet.</p>
            ) : (
              <ViewsTable views={data.views} tracksReading={data.tracksReading} />
            )}

            {pages > 1 && (
              <nav className="mt-6 flex items-center justify-between gap-4" aria-label="Pages">
                <span className="text-sm text-text-muted" aria-live="polite">
                  Page {page} of {pages}
                </span>
                <span className="flex gap-2">
                  <button className="btn btn-secondary" type="button" disabled={page <= 1} onClick={() => go(page - 1)}>
                    Newer
                  </button>
                  <button className="btn btn-secondary" type="button" disabled={page >= pages} onClick={() => go(page + 1)}>
                    Older
                  </button>
                </span>
              </nav>
            )}
          </>
        )}
      </main>
    </>
  );
}
