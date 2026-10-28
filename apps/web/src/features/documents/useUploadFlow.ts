import { useNavigate } from "react-router";
import { useUpload } from "../../api/hooks";

export const ACCEPT = ".md,.markdown,.html,.htm,.zip";

/** What a new version of a document may be: the same kind of file it started as. */
export const acceptFor = (kind: "markdown" | "html") => (kind === "markdown" ? ".md,.markdown" : ".html,.htm,.zip");

/** Upload a file as a draft, then open its Publish settings. */
export function useUploadFlow() {
  const upload = useUpload();
  const navigate = useNavigate();
  const start = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, { onSuccess: (doc) => navigate(`/documents/${doc.id}/publish`) });
  };
  return { start, upload };
}
