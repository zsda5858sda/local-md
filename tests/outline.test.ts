// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutlineOverlay } from "../src/components/OutlineOverlay";
import { collectOutlineItems, findActiveSectionIndex } from "../src/hooks/useOutline";

describe("document outline", () => {
  it("collects headings in document order with their level and position", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Overview" }] },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Details" }] },
          { type: "heading", attrs: { level: 3 } },
          { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Next" }] },
        ],
      },
    });

    const items = collectOutlineItems(editor);
    expect(items.map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: "Overview" },
      { level: 2, text: "Details" },
      { level: 3, text: "" },
      { level: 1, text: "Next" },
    ]);
    expect(items.map((item) => item.pos)).toEqual([...items.map((item) => item.pos)].sort((a, b) => a - b));
    editor.destroy();
  });

  it("finds the nearest outer section for the active heading", () => {
    const items = [
      { pos: 0, level: 1, text: "A" },
      { pos: 4, level: 2, text: "A.1" },
      { pos: 8, level: 3, text: "A.1.1" },
      { pos: 12, level: 1, text: "B" },
      { pos: 16, level: 2, text: "B.1" },
    ];
    expect(findActiveSectionIndex(items, 2)).toBe(0);
    expect(findActiveSectionIndex(items, 4)).toBe(3);
    expect(findActiveSectionIndex(items, -1)).toBe(-1);
  });

  it("hides the overlay without headings and preserves nested active states", () => {
    const onSelect = () => undefined;
    expect(renderToStaticMarkup(createElement(OutlineOverlay, {
      items: [], activeIndex: -1, activeSectionIndex: -1, onSelect,
    }))).toBe("");

    const markup = renderToStaticMarkup(createElement(OutlineOverlay, {
      items: [
        { pos: 0, level: 1, text: "Overview" },
        { pos: 5, level: 2, text: "Details" },
      ],
      activeIndex: 1,
      activeSectionIndex: 0,
      onSelect,
    }));
    expect(markup).toContain("outline-overlay");
    expect(markup).toContain("outline-item active-section");
    expect(markup).toContain("outline-item active");
    expect(markup).toContain("padding-inline-start:22px");
    expect(markup).toContain("aria-current=\"location\"");
  });
});
