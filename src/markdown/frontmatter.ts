import { parseDocument } from "yaml";
import type { FrontMatterState, MarkdownIssue } from "../domain/types";
import { t } from "../i18n";

const YAML_FRONT_MATTER = /^(---\n)([\s\S]*?)(\n---(?:\n|$))/;
const OTHER_FRONT_MATTER = /^(\+\+\+\n)([\s\S]*?)(\n\+\+\+(?:\n|$))/;

export function extractFrontMatter(source: string): {
  frontMatter: FrontMatterState;
  issues: MarkdownIssue[];
} {
  const yamlMatch = YAML_FRONT_MATTER.exec(source);
  if (yamlMatch) {
    const raw = yamlMatch[0];
    const document = parseDocument(yamlMatch[2], { keepSourceTokens: true });
    const issues: MarkdownIssue[] = document.errors.map((error) => ({
      severity: "error",
      kind: "frontmatter",
      message: t("markdown.frontMatterParseFailed", { message: error.message }),
      recoverable: true,
    }));
    const parsed = document.toJS() as unknown;
    return {
      frontMatter: {
        raw,
        body: source.slice(raw.length),
        data: parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
        format: "yaml",
        dirty: false,
      },
      issues,
    };
  }

  const otherMatch = OTHER_FRONT_MATTER.exec(source);
  if (otherMatch) {
    const raw = otherMatch[0];
    return {
      frontMatter: {
        raw,
        body: source.slice(raw.length),
        data: {},
        format: "unsupported",
        dirty: false,
      },
      issues: [{
        severity: "warning",
        kind: "frontmatter",
        message: t("markdown.frontMatterPreserved"),
        recoverable: true,
      }],
    };
  }

  return {
    frontMatter: { raw: null, body: source, data: {}, format: "none", dirty: false },
    issues: [],
  };
}

export function serializeFrontMatter(state: FrontMatterState): string {
  if (state.format === "none") return "";
  if (!state.dirty && state.raw !== null) return state.raw;
  if (state.format === "unsupported") return state.raw ?? "";

  const document = parseDocument("");
  document.contents = document.createNode(state.data) as NonNullable<typeof document.contents>;
  const yaml = document.toString({ lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n`;
}
