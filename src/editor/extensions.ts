import { Extension, mergeAttributes, Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";

export const RawMarkdown = Node.create({
  name: "rawMarkdown",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,
  addAttributes() {
    return { reason: { default: "不支援語法" } };
  },
  parseHTML() {
    return [{ tag: "pre[data-raw-markdown]", preserveWhitespace: "full" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["pre", mergeAttributes(HTMLAttributes, { "data-raw-markdown": "true", spellcheck: "false" }), ["code", 0]];
  },
});

export const MarkdownMetadata = Extension.create({
  name: "markdownMetadata",
  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList", "taskList", "listItem", "taskItem"],
        attributes: { spread: { default: false, rendered: false } },
      },
      {
        types: ["table"],
        attributes: { align: { default: [], rendered: false } },
      },
    ];
  },
});

export const SafeImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSrc: { default: null, rendered: false },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = String(HTMLAttributes.src ?? "");
    if (/^https?:\/\//i.test(src)) {
      return ["span", {
        class: "remote-image-placeholder",
        "data-remote-src": src,
        role: "img",
        "aria-label": `遠端圖片已阻擋：${HTMLAttributes.alt ?? src}`,
      }, `遠端圖片已阻擋 · ${HTMLAttributes.alt || src}`];
    }
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },
});
