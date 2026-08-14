import { Extension, mergeAttributes, Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { t } from "../i18n";

type SafeImageAttributes = Record<string, unknown>;

export function isRemoteImageSource(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function imageSource(attributes: SafeImageAttributes): string {
  return String(attributes.markdownSrc ?? attributes.src ?? "");
}

function imageAlt(attributes: SafeImageAttributes): string {
  return String(attributes.alt ?? "");
}

export function createSafeImageNodeView(initialAttributes: SafeImageAttributes) {
  let attributes = initialAttributes;
  let remoteLoaded = false;
  const dom = document.createElement("span");
  dom.setAttribute("contenteditable", "false");

  const render = () => {
    const source = imageSource(attributes);
    const src = String(attributes.src ?? source);
    const alt = imageAlt(attributes);
    const title = typeof attributes.title === "string" ? attributes.title : "";
    if (isRemoteImageSource(source) && !remoteLoaded) {
      dom.className = "remote-image-placeholder";
      dom.setAttribute("role", "button");
      dom.setAttribute("tabindex", "0");
      dom.setAttribute("data-remote-src", source);
      dom.setAttribute("aria-label", t("image.remoteBlockedAria", { source: alt || source }));
      dom.replaceChildren(document.createTextNode(t("image.remoteBlocked", { source: alt || source })));
      return;
    }
    dom.className = "safe-image-node";
    dom.removeAttribute("role");
    dom.removeAttribute("tabindex");
    dom.removeAttribute("data-remote-src");
    dom.removeAttribute("aria-label");
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt;
    if (title) image.title = title;
    dom.replaceChildren(image);
  };

  const loadRemote = () => {
    if (!isRemoteImageSource(imageSource(attributes)) || remoteLoaded) return;
    remoteLoaded = true;
    render();
  };
  const onClick = () => loadRemote();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    loadRemote();
  };
  dom.addEventListener("click", onClick);
  dom.addEventListener("keydown", onKeyDown);
  render();

  return {
    dom,
    update(nextAttributes: SafeImageAttributes) {
      attributes = nextAttributes;
      remoteLoaded = false;
      render();
    },
    destroy() {
      dom.removeEventListener("click", onClick);
      dom.removeEventListener("keydown", onKeyDown);
    },
  };
}

export const RawMarkdown = Node.create({
  name: "rawMarkdown",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,
  addAttributes() {
    return { reason: { default: t("markdown.unsupported") } };
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
  renderHTML({ node, HTMLAttributes }) {
    const src = imageSource(node.attrs);
    if (isRemoteImageSource(src)) {
      return ["span", {
        class: "remote-image-placeholder",
        "data-remote-src": src,
        role: "button",
        tabindex: "0",
        "aria-label": t("image.remoteBlockedAria", { source: String(HTMLAttributes.alt ?? src) }),
      }, t("image.remoteBlocked", { source: String(HTMLAttributes.alt || src) })];
    }
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },
  addNodeView() {
    return ({ node }) => {
      const view = createSafeImageNodeView(node.attrs);
      return {
        dom: view.dom,
        update: (nextNode) => {
          if (nextNode.type !== node.type) return false;
          view.update(nextNode.attrs);
          return true;
        },
        destroy: view.destroy,
      };
    };
  },
});
