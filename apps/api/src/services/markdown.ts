import type { Root as HastRoot } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import type { Root as MdastRoot, RootContent } from "mdast";
import { toString as mdToString } from "mdast-util-to-string";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import type { Heading } from "@vellum/shared";

export interface RenderedMarkdown {
  /** First H1, else front matter `title`, else empty (caller falls back to the file name). */
  title: string;
  eyebrow: string;
  /** Front matter `description`, else the first paragraph after the H1. Shown as the dek. */
  description: string;
  /** Body HTML without the H1 and dek, which the reader template renders itself. */
  html: string;
  headings: Heading[];
  wordCount: number;
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 230;

interface Meta {
  title: string;
  eyebrow: string;
  description: string;
  wordCount: number;
}

/** Pulls front matter, the H1 and the dek out of the tree into `file.data.meta`. */
function extractMeta() {
  return (tree: MdastRoot, file: { data: Record<string, unknown> }) => {
    const meta: Meta = { title: "", eyebrow: "", description: "", wordCount: 0 };
    const children = tree.children;

    const yamlIndex = children.findIndex((n) => n.type === "yaml");
    if (yamlIndex !== -1) {
      const node = children[yamlIndex] as { value: string };
      try {
        const data: unknown = parseYaml(node.value);
        if (data && typeof data === "object") {
          const fm = data as Record<string, unknown>;
          if (typeof fm.title === "string") meta.title = fm.title.trim();
          if (typeof fm.eyebrow === "string") meta.eyebrow = fm.eyebrow.trim();
          if (typeof fm.description === "string") meta.description = fm.description.trim();
        }
      } catch {
        // Malformed front matter is ignored rather than failing the upload.
      }
      children.splice(yamlIndex, 1);
    }

    // Raw HTML is never rendered; drop it here so it can't leak into the dek or word count.
    visit(tree, "html", (_node, index, parent) => {
      if (parent && index !== undefined) {
        parent.children.splice(index, 1);
        return index;
      }
    });

    meta.wordCount = countWords(mdToString(tree));

    const h1Index = children.findIndex((n) => n.type === "heading" && n.depth === 1);
    if (h1Index !== -1) {
      meta.title = mdToString(children[h1Index] as RootContent).trim() || meta.title;
      children.splice(h1Index, 1);
      const next = children[h1Index];
      if (!meta.description && next?.type === "paragraph") {
        meta.description = mdToString(next).trim();
        children.splice(h1Index, 1);
      }
    }
    file.data.meta = meta;
  };
}

/** Wide tables scroll inside their own box instead of making the page scroll sideways. */
function wrapTables() {
  return (tree: HastRoot) => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "table" || !parent || index === undefined) return;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["table-wrap"] },
        children: [node],
      };
      return "skip";
    });
  };
}

function collectHeadings() {
  return (tree: HastRoot, file: { data: Record<string, unknown> }) => {
    const headings: Heading[] = [];
    visit(tree, "element", (node) => {
      // Skip GFM's visually hidden "Footnotes" heading.
      const hidden = String(node.properties.className ?? "").includes("sr-only");
      if (node.tagName === "h2" && typeof node.properties.id === "string" && !hidden) {
        headings.push({ id: node.properties.id, text: hastToString(node).trim() });
      }
    });
    file.data.headings = headings;
  };
}

// No raw HTML reaches the tree (remark-rehype drops it), and sanitize runs before the
// steps that add trusted ids and classes. Ids are not prefixed so #anchors match slugs.
const sanitizeSchema = { ...defaultSchema, clobberPrefix: "" };

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(extractMeta)
  .use(remarkRehype, { clobberPrefix: "" })
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeSlug)
  .use(rehypeHighlight, { detect: false })
  .use(wrapTables)
  .use(collectHeadings)
  .use(rehypeStringify);

export async function renderMarkdown(source: string): Promise<RenderedMarkdown> {
  const file = await processor.process(source);
  const meta = file.data.meta as Meta;
  return {
    title: meta.title,
    eyebrow: meta.eyebrow,
    description: meta.description,
    html: String(file),
    headings: file.data.headings as Heading[],
    wordCount: meta.wordCount,
    readingMinutes: Math.max(1, Math.round(meta.wordCount / WORDS_PER_MINUTE)),
  };
}

function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}
