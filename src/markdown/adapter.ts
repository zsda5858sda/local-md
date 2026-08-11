import type { Root } from "mdast";
import type { TiptapMark, TiptapNode } from "../domain/types";

type MdNode = {
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
  [key: string]: unknown;
};

function text(value: string, marks?: TiptapMark[]): TiptapNode {
  return { type: "text", text: value.replace(/[\t ]*\n[\t ]*/g, " ").replace(/ {2,}/g, " "), ...(marks?.length ? { marks } : {}) };
}

function inline(nodes: MdNode[] = [], marks: TiptapMark[] = []): TiptapNode[] {
  const output: TiptapNode[] = [];
  let underline = false;
  for (const node of nodes) {
    const activeMarks = underline ? [...marks, { type: "underline" }] : marks;
    switch (node.type) {
      case "text": output.push(text(node.value ?? "", activeMarks)); break;
      case "strong": output.push(...inline(node.children, [...activeMarks, { type: "bold" }])); break;
      case "emphasis": output.push(...inline(node.children, [...activeMarks, { type: "italic" }])); break;
      case "delete": output.push(...inline(node.children, [...activeMarks, { type: "strike" }])); break;
      case "inlineCode": output.push(text(node.value ?? "", [...activeMarks, { type: "code" }])); break;
      case "link": output.push(...inline(node.children, [...activeMarks, { type: "link", attrs: { href: node.url ?? "", title: node.title ?? null } }])); break;
      case "image": output.push({ type: "image", attrs: { src: node.url ?? "", markdownSrc: node.url ?? "", alt: node.alt ?? "", title: node.title ?? null } }); break;
      case "break": output.push({ type: "hardBreak" }); break;
      case "html": {
        const tag = (node.value ?? "").trim().toLowerCase();
        if (tag === "<u>") underline = true;
        if (tag === "</u>") underline = false;
        break;
      }
    }
  }
  return output;
}

function block(node: MdNode, tableHeader = false): TiptapNode | null {
  switch (node.type) {
    case "paragraph": return { type: "paragraph", content: inline(node.children) };
    case "heading": return { type: "heading", attrs: { level: node.depth ?? 1 }, content: inline(node.children) };
    case "code": return { type: "codeBlock", attrs: { language: node.lang ?? null }, content: node.value ? [{ type: "text", text: node.value }] : [] };
    case "blockquote": return { type: "blockquote", content: (node.children ?? []).map((child) => block(child)).filter(Boolean) as TiptapNode[] };
    case "thematicBreak": return { type: "horizontalRule" };
    case "list": {
      const isTask = !node.ordered && (node.children ?? []).some((item) => typeof item.checked === "boolean");
      return {
        type: node.ordered ? "orderedList" : isTask ? "taskList" : "bulletList",
        attrs: node.ordered ? { start: node.start ?? 1, spread: Boolean(node.spread) } : { spread: Boolean(node.spread) },
        content: (node.children ?? []).map((item) => ({
          type: isTask ? "taskItem" : "listItem",
          attrs: isTask ? { checked: Boolean(item.checked), spread: Boolean(item.spread) } : { spread: Boolean(item.spread) },
          content: (item.children ?? []).map((child) => block(child)).filter(Boolean) as TiptapNode[],
        })),
      };
    }
    case "table": return {
      type: "table",
      attrs: { align: node.align ?? [] },
      content: (node.children ?? []).map((row, rowIndex) => ({
        type: "tableRow",
        content: (row.children ?? []).map((cell) => block(cell, rowIndex === 0)!).filter(Boolean),
      })),
    };
    case "tableCell": return { type: tableHeader ? "tableHeader" : "tableCell", content: [{ type: "paragraph", content: inline(node.children) }] };
    case "rawMarkdown": return {
      type: "rawMarkdown",
      attrs: { reason: String(node.reason ?? "不支援語法") },
      content: node.value ? [{ type: "text", text: node.value }] : [],
    };
    default: return null;
  }
}

export function mdastToTiptap(root: Root): TiptapNode {
  const mdRoot = root as unknown as MdNode;
  return { type: "doc", content: (mdRoot.children ?? []).map((child) => block(child)).filter(Boolean) as TiptapNode[] };
}

function withMarks(node: TiptapNode): MdNode {
  let current: MdNode = { type: "text", value: node.text ?? "" };
  const marks = [...(node.marks ?? [])].sort((a, b) => a.type.localeCompare(b.type));
  for (const mark of marks) {
    if (mark.type === "code") current = { type: "inlineCode", value: node.text ?? "" };
    else if (mark.type === "bold") current = { type: "strong", children: [current] };
    else if (mark.type === "italic") current = { type: "emphasis", children: [current] };
    else if (mark.type === "strike") current = { type: "delete", children: [current] };
    else if (mark.type === "link") current = { type: "link", url: String(mark.attrs?.href ?? ""), title: (mark.attrs?.title as string | null) ?? null, children: [current] };
    else if (mark.type === "underline") current = { type: "underline", children: [current] };
  }
  return current;
}

function tiptapInline(nodes: TiptapNode[] = []): MdNode[] {
  const output: MdNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const converted = withMarks(node);
      if (converted.type === "underline") {
        output.push({ type: "html", value: "<u>" }, ...(converted.children ?? []), { type: "html", value: "</u>" });
      } else output.push(converted);
    } else if (node.type === "hardBreak") output.push({ type: "break" });
    else if (node.type === "image") output.push({ type: "image", url: String(node.attrs?.markdownSrc ?? node.attrs?.src ?? ""), alt: String(node.attrs?.alt ?? ""), title: (node.attrs?.title as string | null) ?? null });
  }
  return output;
}

function mdBlock(node: TiptapNode): MdNode | null {
  switch (node.type) {
    case "paragraph": return { type: "paragraph", children: tiptapInline(node.content) };
    case "heading": return { type: "heading", depth: Number(node.attrs?.level ?? 1), children: tiptapInline(node.content) };
    case "codeBlock": return { type: "code", lang: (node.attrs?.language as string | null) ?? null, value: node.content?.map((item) => item.text ?? "").join("") ?? "" };
    case "blockquote": return { type: "blockquote", children: (node.content ?? []).map(mdBlock).filter(Boolean) as MdNode[] };
    case "horizontalRule": return { type: "thematicBreak" };
    case "bulletList":
    case "orderedList":
    case "taskList": return {
      type: "list",
      ordered: node.type === "orderedList",
      start: node.type === "orderedList" ? Number(node.attrs?.start ?? 1) : null,
      spread: Boolean(node.attrs?.spread),
      children: (node.content ?? []).map((item) => ({
        type: "listItem",
        spread: Boolean(item.attrs?.spread),
        checked: node.type === "taskList" ? Boolean(item.attrs?.checked) : null,
        children: (item.content ?? []).map(mdBlock).filter(Boolean) as MdNode[],
      })),
    };
    case "table": return {
      type: "table",
      align: (node.attrs?.align as Array<"left" | "right" | "center" | null>) ?? [],
      children: (node.content ?? []).map((row) => ({
        type: "tableRow",
        children: (row.content ?? []).map((cell) => ({ type: "tableCell", children: tiptapInline(cell.content?.[0]?.content) })),
      })),
    };
    case "rawMarkdown": return { type: "rawMarkdown", value: node.content?.map((item) => item.text ?? "").join("") ?? "", reason: String(node.attrs?.reason ?? "不支援語法") };
    default: return null;
  }
}

export function tiptapToMdast(doc: TiptapNode): Root {
  return { type: "root", children: (doc.content ?? []).map(mdBlock).filter(Boolean) } as unknown as Root;
}
