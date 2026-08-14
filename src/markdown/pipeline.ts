import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import stringWidth from "string-width";
import type { Root } from "mdast";
import type { FrontMatterState, ParsedMarkdown, TiptapNode } from "../domain/types";
import { extractFrontMatter, serializeFrontMatter } from "./frontmatter";
import { validateAndPreserve } from "./allowlist";
import { mdastToTiptap, tiptapToMdast } from "./adapter";
import { isMdastRoot, type MdRoot } from "./nodeRegistry";
import { t } from "../i18n";

const parser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false });
const stringifier = unified()
  .use(remarkGfm, { singleTilde: false, tableCellPadding: true, tablePipeAlign: true, stringLength: stringWidth })
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fence: "`",
    fences: true,
    listItemIndent: "one",
    rule: "-",
    ruleRepetition: 3,
    setext: false,
    resourceLink: false,
  });

export function normalizeEol(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function addUnsupportedFrontMatter(doc: TiptapNode, frontMatter: FrontMatterState): TiptapNode {
  if (frontMatter.format !== "unsupported" || !frontMatter.raw) return doc;
  return {
    ...doc,
    content: [{
      type: "rawMarkdown",
      attrs: { reason: t("markdown.unsupportedFrontMatter") },
      content: [{ type: "text", text: frontMatter.raw }],
    }, ...(doc.content ?? [])],
  };
}

export function parseMarkdown(input: string): ParsedMarkdown {
  const source = normalizeEol(input).replace(/^\uFEFF/, "");
  const extracted = extractFrontMatter(source);
  const tree = parser.parse(extracted.frontMatter.body);
  if (!isMdastRoot(tree)) throw new TypeError("Markdown parser returned an invalid MDAST root");
  const validation = validateAndPreserve(tree, extracted.frontMatter.body);
  const doc = addUnsupportedFrontMatter(mdastToTiptap(validation.root), extracted.frontMatter);
  return {
    doc,
    source,
    frontMatter: extracted.frontMatter,
    issues: [...extracted.issues, ...validation.issues],
    mode: validation.compatibility ? "compatibility" : "visual",
  };
}

function pullRawNodes(root: MdRoot): { root: Root; replacements: Map<string, string> } {
  const replacements = new Map<string, string>();
  const children = root.children.map((node, index) => {
    if (node.type !== "rawMarkdown") return node;
    const marker = `<!--LOCAL_MD_RAW_${index}-->`;
    replacements.set(marker, String(node.value ?? ""));
    return { type: "html", value: marker };
  });
  const converted: unknown = { type: "root", children };
  if (!isMdastRoot(converted)) throw new TypeError("Markdown adapter returned an invalid MDAST root");
  return { root: converted, replacements };
}

export function serializeMarkdown(doc: TiptapNode, frontMatter: FrontMatterState): string {
  const hasRawFrontMatterNode = doc.content?.[0]?.type === "rawMarkdown"
    && doc.content[0].attrs?.reason === t("markdown.unsupportedFrontMatter");
  const bodyDoc = hasRawFrontMatterNode ? { ...doc, content: doc.content?.slice(1) } : doc;
  const ast = tiptapToMdast(bodyDoc);
  const { root, replacements } = pullRawNodes(ast);
  let body = stringifier.stringify(root).replace(/\r\n?/g, "\n");
  for (const [marker, raw] of replacements) body = body.replace(marker, raw.trimEnd());
  body = body.replace(/[ \t]+$/gm, "").replace(/\n*$/, "\n");

  const prefix = hasRawFrontMatterNode
    ? doc.content?.[0]?.content?.map((node) => node.text ?? "").join("") ?? frontMatter.raw ?? ""
    : serializeFrontMatter(frontMatter);
  return `${prefix}${body}`.replace(/\n*$/, "\n");
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalized(item));
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (key === "position") continue;
    if (key === "value" && typeof child === "string" && input.type === "text") {
      output[key] = child.replace(/[\t ]*\n[\t ]*/g, " ").replace(/ {2,}/g, " ");
    } else output[key] = normalized(child);
  }
  return output;
}

export function semanticAst(input: string): unknown {
  const { frontMatter } = extractFrontMatter(normalizeEol(input));
  return normalized(parser.parse(frontMatter.body));
}

export function semanticRoundTrip(input: string): { output: string; equal: boolean; parsed: ParsedMarkdown } {
  const parsed = parseMarkdown(input);
  const output = parsed.mode === "compatibility" ? parsed.source : serializeMarkdown(parsed.doc, parsed.frontMatter);
  return { output, equal: JSON.stringify(semanticAst(input)) === JSON.stringify(semanticAst(output)), parsed };
}
