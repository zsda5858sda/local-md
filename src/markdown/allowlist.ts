import type { Root } from "mdast";
import type { MarkdownIssue, SourcePosition } from "../domain/types";
import { containsUnsafeHtml } from "../services/htmlSanitizer";
import { isSupportedMdastNode, type MdNode } from "./nodeRegistry";
import { t } from "../i18n";

const REFERENCE_NODES = new Set(["definition", "linkReference", "imageReference"]);
const SAFE_INLINE_HTML = /^(?:<\/?u>|<br\s*\/?\s*>)$/i;

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
        issues.push(issue(node, t("markdown.mixedTaskList"), false));
        return;
      }
    }
    if (REFERENCE_NODES.has(node.type)) {
      compatibility = true;
      issues.push(issue(node, t("markdown.dependentSyntax", { type: node.type }), false));
      return;
    }
    if (node.type === "html") {
      const value = String(node.value ?? "");
      if (parentType !== "root" && SAFE_INLINE_HTML.test(value.trim())) return;
      if (parentType !== "root") {
        compatibility = true;
        issues.push(issue(node, t("markdown.inlineHtmlUnsafe"), false));
      }
      return;
    }
    if (!isSupportedMdastNode(node.type)) {
      compatibility = true;
      issues.push(issue(node, t("markdown.outsideAllowlist", { type: node.type }), false));
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
          reason: dangerous ? t("markdown.unsafeHtmlReason") : t("markdown.compatibleHtmlReason"),
          position: child.position,
        });
        issues.push(issue(child, dangerous
          ? t("markdown.unsafeHtmlPreserved")
          : t("markdown.htmlPreserved"), true));
        continue;
      }
    }
    inspect(child, "root");
    nextChildren.push(child);
  }

  mdRoot.children = nextChildren;
  return { root: mdRoot as unknown as Root, issues, compatibility };
}
