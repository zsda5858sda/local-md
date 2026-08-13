import type { TiptapMark, TiptapNode } from "../domain/types";

export type MdNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  depth?: number;
  lang?: string | null;
  ordered?: boolean;
  start?: number | null;
  spread?: boolean;
  checked?: boolean | null;
  align?: Array<"left" | "right" | "center" | null>;
  children?: MdNode[];
  reason?: string;
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  [key: string]: unknown;
};

export interface ToTiptapContext {
  marks: TiptapMark[];
  tableHeader: boolean;
  text: (value: string, marks?: TiptapMark[]) => TiptapNode;
  inline: (nodes?: MdNode[], marks?: TiptapMark[]) => TiptapNode[];
  block: (node: MdNode, tableHeader?: boolean) => TiptapNode | null;
}

export interface ToMdastContext {
  inline: (nodes?: TiptapNode[]) => MdNode[];
  block: (node: TiptapNode) => MdNode | null;
}

export interface NodeSpec {
  supported: boolean;
  reason?: string;
  tiptapTypes?: string[];
  toTiptap?: (node: MdNode, context: ToTiptapContext) => TiptapNode | TiptapNode[] | null;
  toMdast?: (node: TiptapNode, context: ToMdastContext) => MdNode | null;
}

const inlineMark = (type: string) => (node: MdNode, context: ToTiptapContext): TiptapNode[] =>
  context.inline(node.children, [...context.marks, { type }]);

export const NODE_REGISTRY: Record<string, NodeSpec> = {
  root: { supported: true, tiptapTypes: ["doc"] },
  text: { supported: true, tiptapTypes: ["text"], toTiptap: (node, context) => context.text(node.value ?? "", context.marks) },
  paragraph: {
    supported: true, tiptapTypes: ["paragraph"],
    toTiptap: (node, context) => ({ type: "paragraph", content: context.inline(node.children) }),
    toMdast: (node, context) => ({ type: "paragraph", children: context.inline(node.content) }),
  },
  heading: {
    supported: true, tiptapTypes: ["heading"],
    toTiptap: (node, context) => ({ type: "heading", attrs: { level: node.depth ?? 1 }, content: context.inline(node.children) }),
    toMdast: (node, context) => ({ type: "heading", depth: Number(node.attrs?.level ?? 1), children: context.inline(node.content) }),
  },
  break: { supported: true, tiptapTypes: ["hardBreak"], toTiptap: () => ({ type: "hardBreak" }), toMdast: () => ({ type: "break" }) },
  strong: { supported: true, toTiptap: inlineMark("bold") },
  emphasis: { supported: true, toTiptap: inlineMark("italic") },
  delete: { supported: true, toTiptap: inlineMark("strike") },
  inlineCode: { supported: true, toTiptap: (node, context) => context.text(node.value ?? "", [...context.marks, { type: "code" }]) },
  code: {
    supported: true, tiptapTypes: ["codeBlock"],
    toTiptap: (node) => ({ type: "codeBlock", attrs: { language: node.lang ?? null }, content: node.value ? [{ type: "text", text: node.value }] : [] }),
    toMdast: (node) => ({ type: "code", lang: (node.attrs?.language as string | null) ?? null, value: node.content?.map((item) => item.text ?? "").join("") ?? "" }),
  },
  blockquote: {
    supported: true, tiptapTypes: ["blockquote"],
    toTiptap: (node, context) => ({ type: "blockquote", content: (node.children ?? []).map((child) => context.block(child)).filter(Boolean) as TiptapNode[] }),
    toMdast: (node, context) => ({ type: "blockquote", children: (node.content ?? []).map(context.block).filter(Boolean) as MdNode[] }),
  },
  thematicBreak: { supported: true, tiptapTypes: ["horizontalRule"], toTiptap: () => ({ type: "horizontalRule" }), toMdast: () => ({ type: "thematicBreak" }) },
  link: { supported: true, toTiptap: (node, context) => context.inline(node.children, [...context.marks, { type: "link", attrs: { href: node.url ?? "", title: node.title ?? null } }]) },
  image: {
    supported: true, tiptapTypes: ["image"],
    toTiptap: (node) => ({ type: "image", attrs: { src: node.url ?? "", markdownSrc: node.url ?? "", alt: node.alt ?? "", title: node.title ?? null } }),
    toMdast: (node) => ({ type: "image", url: String(node.attrs?.markdownSrc ?? node.attrs?.src ?? ""), alt: String(node.attrs?.alt ?? ""), title: (node.attrs?.title as string | null) ?? null }),
  },
  list: {
    supported: true, tiptapTypes: ["bulletList", "orderedList", "taskList"],
    toTiptap: (node, context) => {
      const isTask = !node.ordered && (node.children ?? []).some((item) => typeof item.checked === "boolean");
      return {
        type: node.ordered ? "orderedList" : isTask ? "taskList" : "bulletList",
        attrs: node.ordered ? { start: node.start ?? 1, spread: Boolean(node.spread) } : { spread: Boolean(node.spread) },
        content: (node.children ?? []).map((item) => ({
          type: isTask ? "taskItem" : "listItem",
          attrs: isTask ? { checked: Boolean(item.checked), spread: Boolean(item.spread) } : { spread: Boolean(item.spread) },
          content: (item.children ?? []).map((child) => context.block(child)).filter(Boolean) as TiptapNode[],
        })),
      };
    },
    toMdast: (node, context) => ({
      type: "list", ordered: node.type === "orderedList", start: node.type === "orderedList" ? Number(node.attrs?.start ?? 1) : null,
      spread: Boolean(node.attrs?.spread),
      children: (node.content ?? []).map((item) => ({
        type: "listItem", spread: Boolean(item.attrs?.spread), checked: node.type === "taskList" ? Boolean(item.attrs?.checked) : null,
        children: (item.content ?? []).map(context.block).filter(Boolean) as MdNode[],
      })),
    }),
  },
  listItem: { supported: true, tiptapTypes: ["listItem", "taskItem"] },
  table: {
    supported: true, tiptapTypes: ["table"],
    toTiptap: (node, context) => ({
      type: "table", attrs: { align: node.align ?? [] },
      content: (node.children ?? []).map((row, rowIndex) => ({ type: "tableRow", content: (row.children ?? []).map((cell) => context.block(cell, rowIndex === 0)!).filter(Boolean) })),
    }),
    toMdast: (node, context) => ({
      type: "table", align: (node.attrs?.align as Array<"left" | "right" | "center" | null>) ?? [],
      children: (node.content ?? []).map((row) => ({ type: "tableRow", children: (row.content ?? []).map((cell) => ({ type: "tableCell", children: context.inline(cell.content?.[0]?.content) })) })),
    }),
  },
  tableRow: { supported: true, tiptapTypes: ["tableRow"] },
  tableCell: {
    supported: true, tiptapTypes: ["tableCell", "tableHeader"],
    toTiptap: (node, context) => ({ type: context.tableHeader ? "tableHeader" : "tableCell", content: [{ type: "paragraph", content: context.inline(node.children) }] }),
  },
  html: { supported: true },
  rawMarkdown: {
    supported: true, tiptapTypes: ["rawMarkdown"],
    toTiptap: (node) => ({ type: "rawMarkdown", attrs: { reason: String(node.reason ?? "不支援語法") }, content: node.value ? [{ type: "text", text: node.value }] : [] }),
    toMdast: (node) => ({ type: "rawMarkdown", value: node.content?.map((item) => item.text ?? "").join("") ?? "", reason: String(node.attrs?.reason ?? "不支援語法") }),
  },
  definition: { supported: false, reason: "跨區塊參照尚未支援" },
  linkReference: { supported: false, reason: "跨區塊參照尚未支援" },
  imageReference: { supported: false, reason: "跨區塊參照尚未支援" },
  footnote: { supported: false, reason: "尚未支援" },
  footnoteDefinition: { supported: false, reason: "尚未支援" },
  footnoteReference: { supported: false, reason: "尚未支援" },
};

export const TIPTAP_NODE_REGISTRY = Object.fromEntries(
  Object.values(NODE_REGISTRY).flatMap((spec) => (spec.tiptapTypes ?? []).map((type) => [type, spec])),
) as Record<string, NodeSpec>;

export function isSupportedMdastNode(type: string): boolean {
  return NODE_REGISTRY[type]?.supported === true;
}

export function isRegisteredTiptapNode(type: string): boolean {
  return Boolean(TIPTAP_NODE_REGISTRY[type]);
}
