/** Minimal auto-escaping HTML templates for the server-rendered reader pages. */

const RAW = Symbol("raw");
export interface RawHtml {
  [RAW]: string;
}

export const raw = (value: string): RawHtml => ({ [RAW]: value });

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Value = string | number | RawHtml | null | undefined | false | Value[];

function render(value: Value): string {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "object") return value[RAW];
  return escapeHtml(String(value));
}

/** Interpolated values are escaped unless wrapped in raw() or produced by html``. */
export function html(strings: TemplateStringsArray, ...values: Value[]): RawHtml {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "");
  });
  return raw(out);
}

export const toString = (h: RawHtml): string => h[RAW];
