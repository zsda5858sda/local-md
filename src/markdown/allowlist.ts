import type { Root } from "mdast";
import type { MarkdownIssue, SourcePosition } from "../domain/types";
import { containsUnsafeHtml } from "../services/htmlSanitizer";
import { isSupportedMdastNode, type MdNode } from "./nodeRegistry";

const REFERENCE_NODES = new Set(["definition", "linkReference", "imageReference"]);
const SAFE_INLINE_HTML = /^<\/?u>$/i;

function point(value?: { line: number; column: number; offset?: number }): SourcePosition | undefined {
  if (!value) return undefined;
  return { line: value.line, column: value.column, offset: value.offset ?? 0 };
}

function issue(node: MdNode, message: string, recoverable: boolean): MarkdownIssue {
  return {
    severity: recoverable ? "warning" : "error",
    kind: node.type === "html" ? "unsafe-html" : "unsupported",
    message,
    start: point(node.position?.start),
    end: point(node.position?.end),
    recoverable,
  };
}

function sourceSlice(node: MdNode, source: string): string | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === "number" && typeof end === "number" ? source.slice(start, end) : null;
}

export interface ValidationResult {
  root: Root;
  issues: MarkdownIssue[];
  compatibility: boolean;
}

export function validateAndPreserve(root: Root, source: string): ValidationResult {
  const issues: MarkdownIssue[] = [];
  let compatibility = false;
  const mdRoot = root as unknown as MdNode;
  const nextChildren: MdNode[] = [];

  const inspect = (node: MdNode, parentType: string): void => {
    if (node.type === "list") {
      const checkedStates = (node.children ?? []).map((child) => child.checked);
      const hasTaskItems = checkedStates.some((checked) => typeof checked === "boolean");
      const hasPlainItems = checkedStates.some((checked) => typeof checked !== "boolean");
      if (hasTaskItems && hasPlainItems) {
        compatibility = true;
        issues.push(issue(node, "同一清單混合任務與一般項目，視覺模式無法無損表示；文件已切換相容模式。", false));
        return;
      }
    }
    if (REFERENCE_NODES.has(node.type)) {
      compatibility = true;
      issues.push(issue(node, `不支援會跨區塊相依的 ${node.type} 語法，文件已切換相容模式。`, false));
      return;
    }
    if (node.type === "html") {
      const value = String(node.value ?? "");
      if (parentType !== "root" && SAFE_INLINE_HTML.test(value.trim())) return;
      if (parentType !== "root") {
        compatibility = true;
        issues.push(issue(node, "行內 HTML 無法安全獨立切割，文件已切換相容模式。", false));
      }
      return;
    }
    if (!isSupportedMdastNode(node.type)) {
      compatibility = true;
      issues.push(issue(node, `MDAST node「${node.type}」不在 v1 allowlist。`, false));
      return;
    }
    node.children?.forEach((child) => inspect(child, node.type));
  };

  for (const child of mdRoot.children ?? []) {
    if (child.type === "html" && !SAFE_INLINE_HTML.test(String(child.value ?? "").trim())) {
      const raw = sourceSlice(child, source);
      if (raw !== null) {
        const dangerous = containsUnsafeHtml(raw);
        nextChildren.push({
          type: "rawMarkdown",
          value: raw,
          reason: dangerous ? "不安全或未知 HTML" : "HTML 相容區塊",
          position: child.position,
        });
        issues.push(issue(child, dangerous
          ? "HTML 含可執行或危險內容；已隔離為原始 Markdown，不會執行。"
          : "HTML 區塊已原樣保留。", true));
        continue;
      }
    }
    inspect(child, "root");
    nextChildren.push(child);
  }

  mdRoot.children = nextChildren;
  return { root: mdRoot as unknown as Root, issues, compatibility };
}
