// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { Editor, generateHTML } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { parseMarkdown, semanticRoundTrip, serializeMarkdown } from "../src/markdown/pipeline";
import { containsUnsafeHtml, sanitizeHtml } from "../src/services/htmlSanitizer";
import { NODE_REGISTRY, isRegisteredTiptapNode, isSupportedMdastNode } from "../src/markdown/nodeRegistry";
import { AnnotatedLink, externalHttpLinkFromTarget, LawLink, lawTextFromTarget, linkHrefFromTarget, SafeImage } from "../src/editor/extensions";
import { lawLinkTitleFromText, lawTextFromLinkTitle } from "../src/services/lawLink";
import type { TiptapNode } from "../src/domain/types";

const fixture = (name: string) => readFileSync(resolve(process.cwd(), "tests", "fixtures", name), "utf8");

describe("canonical Markdown round-trip", () => {
  it("keeps embedded image bytes and description through insertion, saving and reopening", () => {
    const src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=";
    const parsed = parseMarkdown("圖片如下：\n");
    const editor = new Editor({
      extensions: [StarterKit, SafeImage.configure({ inline: true, allowBase64: false })],
      content: parsed.doc,
    });
    editor.commands.setTextSelection(6);
    editor.commands.setImage({ src, alt: "流程圖.png" });
    const saved = serializeMarkdown(editor.getJSON() as TiptapNode, parsed.frontMatter);
    expect(saved).toContain(`![流程圖.png](${src})`);
    const reopened = parseMarkdown(saved);
    expect(reopened.mode).toBe("visual");
    editor.commands.setContent(reopened.doc);
    expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe(src);
    expect(serializeMarkdown(editor.getJSON() as TiptapNode, reopened.frontMatter)).toBe(saved);
    editor.destroy();
  });

  it("keeps two-column image layout through saving and reopening", () => {
    const parsed = parseMarkdown("![one](assets/one.png)\n\n![two](assets/two.png)\n");
    const doc = structuredClone(parsed.doc);
    const images: TiptapNode[] = [];
    const collect = (node: TiptapNode) => {
      if (node.type === "image") images.push(node);
      node.content?.forEach(collect);
    };
    collect(doc);
    images.forEach((image) => { image.attrs = { ...image.attrs, width: "49%" }; });
    const saved = serializeMarkdown(doc, parsed.frontMatter);
    expect(saved).toContain('<!-- local-md:image-layout width="49%" -->');
    const reopened = parseMarkdown(saved);
    const reopenedImages: TiptapNode[] = [];
    const collectReopened = (node: TiptapNode) => {
      if (node.type === "image") reopenedImages.push(node);
      node.content?.forEach(collectReopened);
    };
    collectReopened(reopened.doc);
    expect(reopenedImages).toHaveLength(2);
    expect(reopenedImages.map((image) => image.attrs?.width)).toEqual(["49%", "49%"]);
  });

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

  it("keeps inert law link attributes when pasting rendered content", () => {
    expect(sanitizeHtml('<a href="#law" data-law-link="true" data-law-text="第一條%0A第二項">法條</a>'))
      .toBe('<a href="#law" data-law-link="true" data-law-text="第一條%0A第二項">法條</a>');
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

  it("preserves user-authored multiline law text in a Markdown link title", () => {
    const lawText = "第一項\n行為人應依規定辦理。\n\n第二項\n違反者處罰鍰。\n";
    const doc: TiptapNode = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "行政程序法第 1 條", marks: [{ type: "lawLink", attrs: { href: "#law", lawText } }] }],
      }],
    };
    const output = serializeMarkdown(doc, parseMarkdown("").frontMatter);
    expect(output).toContain("local-md-law:");
    const reopened = parseMarkdown(output);
    const mark = reopened.doc.content?.[0]?.content?.[0]?.marks?.[0];
    expect(mark).toEqual({ type: "lawLink", attrs: { href: "#law", lawText } });
    expect(serializeMarkdown(reopened.doc, reopened.frontMatter)).toBe(output);
  });

  it("keeps ordinary Markdown link titles as ordinary links", () => {
    const parsed = parseMarkdown('[文件](notes.md "文件說明")\n');
    expect(parsed.doc.content?.[0]?.content?.[0]?.marks?.[0]).toEqual({ type: "link", attrs: { href: "notes.md", title: "文件說明" } });
  });

  it("blocks remote images until an explicit click", () => {
    const element = document.createElement("div");
    const editor = new Editor({
      element,
      extensions: [StarterKit, SafeImage.configure({ inline: true, allowBase64: false })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "https://tracker.example/pixel.png", markdownSrc: "https://tracker.example/pixel.png", alt: "remote" } }] }] },
    });
    const figure = element.querySelector("figure.safe-image-node");
    const placeholder = figure?.querySelector<HTMLElement>(".remote-image-placeholder");
    expect((figure as HTMLElement | null)?.draggable).toBe(true);
    expect(figure?.querySelector(".image-drag-handle")).toBeNull();
    expect(placeholder).not.toBeNull();
    expect(figure?.querySelector("img")).toBeNull();
    expect(figure?.querySelector("[src]")).toBeNull();
    placeholder?.click();
    const image = figure?.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://tracker.example/pixel.png");
    expect(image?.draggable).toBe(false);
    editor.destroy();
  });

  it("loads workspace image bytes only into the image view", async () => {
    const element = document.createElement("div");
    const source = "data:image/png;base64,iVBORwE=";
    const resolveLocalImage = vi.fn(async () => source);
    const editor = new Editor({
      element,
      extensions: [StarterKit, SafeImage.configure({ inline: true, allowBase64: false, resolveLocalImage } as never)],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "assets/photo.png", markdownSrc: "assets/photo.png", alt: "photo" } }] }] },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(resolveLocalImage).toHaveBeenCalledWith("assets/photo.png");
    expect(element.querySelector("img")?.getAttribute("src")).toBe(source);
    expect((editor.getJSON() as TiptapNode).content?.[0]?.content?.[0]?.attrs?.src).toBe("assets/photo.png");
    editor.destroy();
  });

  it("edits captions and deletes images through node-view controls", () => {
    const element = document.createElement("div");
    const editor = new Editor({
      element,
      extensions: [StarterKit, SafeImage.configure({ inline: true, allowBase64: false })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "assets/photo.png", alt: "photo" } }] }] },
    });
    const halfWidthButton = element.querySelector<HTMLButtonElement>("[aria-label='設為一行兩張圖片']");
    halfWidthButton?.click();
    expect((editor.getJSON() as TiptapNode).content?.[0]?.content?.[0]?.attrs?.width).toBe("49%");
    const captionButton = element.querySelector<HTMLButtonElement>("[aria-label='新增或編輯圖片說明']");
    expect(captionButton).not.toBeNull();
    captionButton?.click();
    const caption = element.querySelector<HTMLElement>("figcaption.image-caption");
    expect(caption).not.toBeNull();
    if (caption) {
      caption.textContent = "圖片說明";
      caption.dispatchEvent(new Event("blur"));
    }
    const imageNode = (editor.getJSON() as TiptapNode).content?.[0]?.content?.[0];
    expect(imageNode?.attrs?.caption).toBe("圖片說明");
    expect(imageNode?.attrs?.alt).toBe("圖片說明");
    const saved = serializeMarkdown(editor.getJSON() as TiptapNode, parseMarkdown("").frontMatter);
    expect(saved).toContain("![圖片說明](assets/photo.png)");
    element.querySelector<HTMLButtonElement>(".image-toolbar-danger")?.click();
    expect(element.querySelector("figure.safe-image-node")).toBeNull();
    editor.destroy();
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

  it("renders law text as an inert data attribute for the click popover", () => {
    const lawText = "<strong>使用者輸入</strong>\n第二行";
    const html = generateHTML({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "法條", marks: [{ type: "lawLink", attrs: { href: "#law", lawText } }] }] }],
    }, [StarterKit.configure({ link: false }), AnnotatedLink, LawLink]);
    expect(html).toContain('data-law-link="true"');
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    expect(wrapper.querySelector("a")?.getAttribute("data-law-text")).toBe(lawText);
    expect(wrapper.querySelector("a")?.textContent).toBe("法條");
  });

  it("encodes and decodes law text without changing trailing newlines", () => {
    const value = "第一條\n\n";
    expect(lawTextFromLinkTitle(lawLinkTitleFromText(value))).toBe(value);
  });

  it("keeps external links with note-like titles as ordinary links", () => {
    const parsed = parseMarkdown('[docs](https://example.com "local-md-law:hello")');
    const marks = parsed.doc.content?.[0].content?.[0].marks;
    expect(marks).toEqual([{ type: "link", attrs: { href: "https://example.com", title: "local-md-law:hello" } }]);
  });

  it("requires an explicit note marker before intercepting an anchor", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<a href="https://example.com" data-law-text="note"><span>web</span></a><a href="#law" data-law-link="true" data-law-text="note"><span>note</span></a>';
    expect(lawTextFromTarget(wrapper.querySelectorAll("span")[0])).toBeNull();
    expect(lawTextFromTarget(wrapper.querySelectorAll("span")[1])).toBe("note");
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
