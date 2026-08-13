// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseMarkdown, semanticRoundTrip, serializeMarkdown } from "../src/markdown/pipeline";
import { containsUnsafeHtml, sanitizeHtml } from "../src/services/htmlSanitizer";
import { NODE_REGISTRY, isRegisteredTiptapNode, isSupportedMdastNode } from "../src/markdown/nodeRegistry";

const fixture = (name: string) => readFileSync(resolve(process.cwd(), "tests", "fixtures", name), "utf8");

describe("canonical Markdown round-trip", () => {
  for (const name of [
    "headings.md", "inline-formatting.md", "soft-break.md", "hard-break.md",
    "nested-list.md", "nested-list-two-digit-marker.md", "loose-vs-tight-list.md",
    "ordered-list-custom-start.md", "task-list.md", "table-cjk-emoji.md", "code-block.md",
  ]) {
    it(`preserves semantic AST for ${name}`, () => {
      const result = semanticRoundTrip(fixture(name));
      expect(result.parsed.mode).toBe("visual");
      expect(result.equal, result.output).toBe(true);
      expect(result.output.endsWith("\n")).toBe(true);
      expect(result.output.endsWith("\n\n")).toBe(false);
    });
  }

  it("canonicalizes soft breaks to spaces and hard breaks to backslashes", () => {
    expect(semanticRoundTrip(fixture("soft-break.md")).output).toContain("soft line break");
    expect(semanticRoundTrip(fixture("hard-break.md")).output).toContain("break\\\nand");
  });

  it("keeps custom ordered-list starts", () => {
    expect(semanticRoundTrip(fixture("ordered-list-custom-start.md")).output).toMatch(/^5\. Five/m);
  });

  it("preserves untouched YAML front-matter exactly", () => {
    const source = fixture("frontmatter.md");
    const parsed = parseMarkdown(source);
    const output = serializeMarkdown(parsed.doc, parsed.frontMatter);
    expect(output.slice(0, parsed.frontMatter.raw?.length)).toBe(parsed.frontMatter.raw);
    expect(output).toContain("unknownField: keep-me");
  });

  it("preserves TOML front-matter as a raw node", () => {
    const source = fixture("frontmatter-toml.md");
    const parsed = parseMarkdown(source);
    expect(parsed.doc.content?.[0]?.type).toBe("rawMarkdown");
    const output = serializeMarkdown(parsed.doc, parsed.frontMatter);
    expect(output.slice(0, parsed.frontMatter.raw?.length)).toBe(parsed.frontMatter.raw);
    expect(output).toBe(source);
  });

  it("uses compatibility mode for cross-block reference links", () => {
    const source = fixture("reference-style-link-unsupported.md");
    const parsed = parseMarkdown(source);
    expect(parsed.mode).toBe("compatibility");
    expect(parsed.issues.some((issue) => !issue.recoverable)).toBe(true);
    expect(semanticRoundTrip(source).output).toBe(source);
  });

  it("uses compatibility mode for mixed task and plain list items", () => {
    const source = "- [x] task\n- normal\n";
    const result = semanticRoundTrip(source);
    expect(result.parsed.mode).toBe("compatibility");
    expect(result.output).toBe(source);
    expect(result.equal).toBe(true);
  });

  it("isolates standalone HTML without executing it", () => {
    const parsed = parseMarkdown("<script>alert(1)</script>\n");
    expect(parsed.mode).toBe("visual");
    expect(parsed.doc.content?.[0]?.type).toBe("rawMarkdown");
    expect(parsed.issues[0]?.kind).toBe("unsafe-html");
  });

  it("detects sanitizer changes instead of relying on an HTML blacklist", () => {
    expect(containsUnsafeHtml('<svg onload="alert(1)"></svg>')).toBe(true);
    expect(containsUnsafeHtml('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).toBe(true);
    expect(containsUnsafeHtml("<strong>safe</strong>")).toBe(false);
  });

  it("sanitizes the complete pasted HTML against a fixed allowlist", () => {
    const sanitized = sanitizeHtml('<p class="x"><strong>safe</strong><img src="data:image/svg+xml,evil" onerror="alert(1)"><a href="javascript:alert(1)">link</a></p>');
    expect(sanitized).toBe("<p><strong>safe</strong><img><a>link</a></p>");
  });
});

describe("property-based supported subset", () => {
  it("round-trips generated headings and paragraphs", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        kind: fc.constantFrom("paragraph" as const, "heading" as const),
        text: fc.stringMatching(/^[A-Za-z0-9 ]{1,40}$/),
        level: fc.integer({ min: 1, max: 6 }),
      }), { minLength: 1, maxLength: 15 }),
      (blocks) => {
        const source = `${blocks.map((block) => block.kind === "heading" ? `${"#".repeat(block.level)} ${block.text}` : block.text).join("\n\n")}\n`;
        return semanticRoundTrip(source).equal;
      },
    ), { numRuns: 100, seed: 20260807 });
  });
});

describe("Markdown node registry", () => {
  it("is the single support source for validation and both adapters", () => {
    expect(isSupportedMdastNode("heading")).toBe(true);
    expect(NODE_REGISTRY.heading.toTiptap).toBeTypeOf("function");
    expect(NODE_REGISTRY.heading.toMdast).toBeTypeOf("function");
    expect(isRegisteredTiptapNode("heading")).toBe(true);
    expect(NODE_REGISTRY.footnote.supported).toBe(false);
  });
});
