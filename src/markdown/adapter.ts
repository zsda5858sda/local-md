import type { Root } from "mdast";
import type { TiptapMark, TiptapNode } from "../domain/types";
import { NODE_REGISTRY, TIPTAP_NODE_REGISTRY, type MdNode, type ToMdastContext, type ToTiptapContext } from "./nodeRegistry";

function text(value: string, marks?: TiptapMark[]): TiptapNode {
  return { type: "text", text: value.replace(/[\t ]*\n[\t ]*/g, " ").replace(/ {2,}/g, " "), ...(marks?.length ? { marks } : {}) };
}

function inline(nodes: MdNode[] = [], marks: TiptapMark[] = []): TiptapNode[] {
  const output: TiptapNode[] = [];
  let underline = false;
  for (const node of nodes) {
    const activeMarks = underline ? [...marks, { type: "underline" }] : marks;
    if (node.type === "html") {
      const tag = (node.value ?? "").trim().toLowerCase();
      if (tag === "<u>") underline = true;
      if (tag === "</u>") underline = false;
      continue;
    }
    const converted = NODE_REGISTRY[node.type]?.toTiptap?.(node, tiptapContext(activeMarks, false));
    if (Array.isArray(converted)) output.push(...converted);
    else if (converted) output.push(converted);
  }
  return output;
}

function tiptapContext(marks: TiptapMark[] = [], tableHeader = false): ToTiptapContext {
  return { marks, tableHeader, text, inline, block };
}

function block(node: MdNode, tableHeader = false): TiptapNode | null {
  const converted = NODE_REGISTRY[node.type]?.toTiptap?.(node, tiptapContext([], tableHeader));
  return Array.isArray(converted) ? converted[0] ?? null : converted ?? null;
}

export function mdastToTiptap(root: Root): TiptapNode {
  const mdRoot = root as unknown as MdNode;
  return { type: "doc", content: (mdRoot.children ?? []).map((child) => block(child)).filter(Boolean) as TiptapNode[] };
}

const MARK_TO_MDAST: Record<string, (current: MdNode, node: TiptapNode, mark: TiptapMark) => MdNode> = {
  code: (_current, node) => ({ type: "inlineCode", value: node.text ?? "" }),
  bold: (current) => ({ type: "strong", children: [current] }),
  italic: (current) => ({ type: "emphasis", children: [current] }),
  strike: (current) => ({ type: "delete", children: [current] }),
  link: (current, _node, mark) => ({ type: "link", url: String(mark.attrs?.href ?? ""), title: (mark.attrs?.title as string | null) ?? null, children: [current] }),
  underline: (current) => ({ type: "underline", children: [current] }),
};

function withMarks(node: TiptapNode): MdNode {
  let current: MdNode = { type: "text", value: node.text ?? "" };
  for (const mark of [...(node.marks ?? [])].sort((left, right) => left.type.localeCompare(right.type))) {
    current = MARK_TO_MDAST[mark.type]?.(current, node, mark) ?? current;
  }
  return current;
}

function tiptapInline(nodes: TiptapNode[] = []): MdNode[] {
  const output: MdNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const converted = withMarks(node);
      if (converted.type === "underline") output.push({ type: "html", value: "<u>" }, ...(converted.children ?? []), { type: "html", value: "</u>" });
      else output.push(converted);
      continue;
    }
    const converted = TIPTAP_NODE_REGISTRY[node.type]?.toMdast?.(node, mdastContext());
    if (converted) output.push(converted);
  }
  return output;
}

function mdastContext(): ToMdastContext {
  return { inline: tiptapInline, block: mdBlock };
}

function mdBlock(node: TiptapNode): MdNode | null {
  return TIPTAP_NODE_REGISTRY[node.type]?.toMdast?.(node, mdastContext()) ?? null;
}

export function tiptapToMdast(doc: TiptapNode): Root {
  return { type: "root", children: (doc.content ?? []).map(mdBlock).filter(Boolean) } as unknown as Root;
}
