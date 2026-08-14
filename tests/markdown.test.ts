// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateHTML } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { parseMarkdown, semanticRoundTrip, serializeMarkdown } from "../src/markdown/pipeline";
import { containsUnsafeHtml, sanitizeHtml } from "../src/services/htmlSanitizer";
import { NODE_REGISTRY, isRegisteredTiptapNode, isSupportedMdastNode } from "../src/markdown/nodeRegistry";
import { AnnotatedLink, createSafeImageNodeView, externalHttpLinkFromTarget, linkHrefFromTarget } from "../src/editor/extensions";
import type { TiptapNode } from "../src/domain/types";

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

  it("preserves every paragraph entered in a table cell", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [{
        type: "table",
        attrs: { align: [null] },
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Header" }] }] }] },
          { type: "tableRow", content: [{
            type: "tableCell",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "first paragraph" }] },
              { type: "paragraph", content: [{ type: "text", text: "second paragraph" }] },
            ],
          }] },
        ],
      }],
    };
    const output = serializeMarkdown(doc, parseMarkdown("").frontMatter);
    expect(output).toContain("first paragraph<br>second paragraph");
    const reparsed = parseMarkdown(output);
    expect(reparsed.mode).toBe("visual");
    expect(JSON.stringify(reparsed.doc)).toContain("first paragraph");
    expect(JSON.stringify(reparsed.doc)).toContain("second paragraph");
    expect(JSON.stringify(reparsed.doc)).toContain("hardBreak");
  });

  it("preserves bold, italic, code and link marks on the same text", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "text",
          text: "combined",
          marks: [
            { type: "link", attrs: { href: "https://example.com", title: null } },
            { type: "italic" },
            { type: "code" },
            { type: "bold" },
          ],
        }],
      }],
    };
    const output = serializeMarkdown(doc, parseMarkdown("").frontMatter);
    const reparsed = parseMarkdown(output);
    const textNode = reparsed.doc.content?.[0]?.content?.[0];
    expect(textNode?.text).toBe("combined");
    expect(new Set(textNode?.marks?.map((mark) => mark.type))).toEqual(new Set(["bold", "italic", "code", "link"]));
  });

  it("blocks remote images until an explicit click", () => {
    const view = createSafeImageNodeView({ src: "https://tracker.example/pixel.png", markdownSrc: "https://tracker.example/pixel.png", alt: "remote" });
    expect(view.dom.className).toBe("remote-image-placeholder");
    expect(view.dom.querySelector("img")).toBeNull();
    expect(view.dom.querySelector("[src]")).toBeNull();
    view.dom.click();
    expect(view.dom.querySelector("img")?.getAttribute("src")).toBe("https://tracker.example/pixel.png");
    view.destroy();
  });

  it("renders link destinations as native hover titles", () => {
    const html = generateHTML({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Example", marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }] }],
      }],
    }, [StarterKit.configure({ link: false }), AnnotatedLink]);
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('title="https://example.com/docs"');
  });

  it("allows modifier-click navigation only for HTTP(S) links", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<a href="https://example.com/docs"><span>Web</span></a><a href="notes/local.md"><span>Local</span></a>';
    expect(linkHrefFromTarget(wrapper.querySelector("span"))).toBe("https://example.com/docs");
    expect(linkHrefFromTarget(wrapper.querySelectorAll("span")[1])).toBe("notes/local.md");
    expect(externalHttpLinkFromTarget(wrapper.querySelector("span"))).toBe("https://example.com/docs");
    expect(externalHttpLinkFromTarget(wrapper.querySelectorAll("span")[1])).toBeNull();
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
