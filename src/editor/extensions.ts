import { Extension, mergeAttributes, Node } from "@tiptap/core";
import type { NodeViewRendererProps } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { t } from "../i18n";

type SafeImageAttributes = Record<string, unknown>;
type ProseMirrorNode = NodeViewRendererProps["node"];
type EditorView = NodeViewRendererProps["view"];
type GetNodePosition = NodeViewRendererProps["getPos"];

export const INSERT_LINK_REQUESTED_EVENT = "local-md:insert-link-requested";
export const IMAGE_ZOOM_REQUESTED_EVENT = "local-md:image-zoom-requested";

export function linkHrefFromTarget(target: EventTarget | null): string | null {
  const element = target instanceof Element
    ? target
    : target instanceof globalThis.Node ? target.parentElement : null;
  return element?.closest<HTMLAnchorElement>("a[href]")?.getAttribute("href") ?? null;
}

export function externalHttpLinkFromTarget(target: EventTarget | null): string | null {
  const href = linkHrefFromTarget(target);
  return href && /^https?:\/\//i.test(href) ? href : null;
}

export function handleEditorLinkClick(event: MouseEvent, onExternalLink: (href: string) => void): boolean {
  if (linkHrefFromTarget(event.target) === null) return false;
  event.preventDefault();
  if (!event.ctrlKey && !event.metaKey) return false;
  const href = externalHttpLinkFromTarget(event.target);
  if (!href) return false;
  onExternalLink(href);
  return true;
}

export const AnnotatedLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    return ["a", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      title: HTMLAttributes.title || HTMLAttributes.href,
    }), 0];
  },
});

export const LinkShortcut = Extension.create({
  name: "linkShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.editor.view.dom.dispatchEvent(new Event(INSERT_LINK_REQUESTED_EVENT));
        return true;
      },
    };
  },
});

export function isRemoteImageSource(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function imageSource(attributes: SafeImageAttributes): string {
  return String(attributes.markdownSrc ?? attributes.src ?? "");
}

function imageAlt(attributes: SafeImageAttributes): string {
  return String(attributes.alt ?? "");
}

function setImageAttribute(view: EditorView, getPos: GetNodePosition, patch: Record<string, unknown>) {
  const pos = getPos();
  if (typeof pos !== "number" || !Number.isInteger(pos)) return;
  const current = view.state.doc.nodeAt(pos);
  if (!current) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch }));
}

function deleteImageNode(view: EditorView, getPos: GetNodePosition) {
  const pos = getPos();
  if (typeof pos !== "number" || !Number.isInteger(pos)) return;
  const current = view.state.doc.nodeAt(pos);
  if (!current) return;
  view.dispatch(view.state.tr.delete(pos, pos + current.nodeSize));
}

export function createSafeImageNodeView(node: ProseMirrorNode, view: EditorView, getPos: GetNodePosition) {
  const nodeType = node.type;
  let attributes = node.attrs as SafeImageAttributes;
  let remoteLoaded = false;
  let showCaptionInput = Boolean(attributes.caption);
  let resizing = false;
  let resizeMove: ((event: PointerEvent) => void) | null = null;
  let resizeFinish: (() => void) | null = null;

  const figure = document.createElement("figure");
  figure.className = "safe-image-node";
  figure.setAttribute("contenteditable", "false");
  figure.draggable = true;

  const mediaWrap = document.createElement("div");
  mediaWrap.className = "safe-image-media";

  const toolbar = document.createElement("div");
  toolbar.className = "image-toolbar";

  const captionButton = document.createElement("button");
  captionButton.type = "button";
  captionButton.className = "image-toolbar-btn";
  captionButton.title = t("image.toggleCaption");
  captionButton.setAttribute("aria-label", t("image.toggleCaption"));
  captionButton.textContent = t("image.toggleCaptionShort");

  const zoomButton = document.createElement("button");
  zoomButton.type = "button";
  zoomButton.className = "image-toolbar-btn";
  zoomButton.title = t("image.zoom");
  zoomButton.setAttribute("aria-label", t("image.zoom"));
  zoomButton.textContent = t("image.zoomShort");

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "image-toolbar-btn image-toolbar-danger";
  deleteButton.title = t("image.delete");
  deleteButton.setAttribute("aria-label", t("image.delete"));
  deleteButton.textContent = t("image.deleteShort");
  toolbar.append(captionButton, zoomButton, deleteButton);

  const resizeHandle = document.createElement("span");
  resizeHandle.className = "image-resize-handle";
  resizeHandle.setAttribute("aria-hidden", "true");

  const figcaption = document.createElement("figcaption");
  figcaption.contentEditable = "true";
  figcaption.className = "image-caption";
  figcaption.setAttribute("data-placeholder", t("image.captionPlaceholder"));

  const render = () => {
    const source = imageSource(attributes);
    const src = String(attributes.src ?? source);
    const alt = imageAlt(attributes);
    const title = typeof attributes.title === "string" ? attributes.title : "";
    const width = typeof attributes.width === "string" && /^\d+(?:\.\d+)?%$/.test(attributes.width)
      ? attributes.width
      : null;
    figure.style.width = width ?? "";
    if (isRemoteImageSource(source) && !remoteLoaded) {
      mediaWrap.className = "remote-image-placeholder";
      mediaWrap.setAttribute("role", "button");
      mediaWrap.setAttribute("tabindex", "0");
      mediaWrap.setAttribute("data-remote-src", source);
      mediaWrap.setAttribute("aria-label", t("image.remoteBlockedAria", { source: alt || source }));
      mediaWrap.replaceChildren(document.createTextNode(t("image.remoteBlocked", { source: alt || source })));
      figure.replaceChildren(mediaWrap);
      return;
    }
    mediaWrap.className = "safe-image-media";
    mediaWrap.removeAttribute("role");
    mediaWrap.removeAttribute("tabindex");
    mediaWrap.removeAttribute("data-remote-src");
    mediaWrap.removeAttribute("aria-label");
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt;
    image.draggable = false;
    if (title) image.title = title;
    mediaWrap.replaceChildren(image, resizeHandle);
    figcaption.textContent = typeof attributes.caption === "string" ? attributes.caption : "";
    figure.replaceChildren(mediaWrap, toolbar, ...(showCaptionInput ? [figcaption] : []));
  };

  const loadRemote = () => {
    if (!isRemoteImageSource(imageSource(attributes)) || remoteLoaded) return;
    remoteLoaded = true;
    render();
  };
  const onClick = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest(".remote-image-placeholder")) loadRemote();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    loadRemote();
  };
  mediaWrap.addEventListener("click", onClick);
  mediaWrap.addEventListener("keydown", onKeyDown);

  const onCaptionClick = () => {
    showCaptionInput = !showCaptionInput;
    render();
    if (showCaptionInput) window.requestAnimationFrame(() => figcaption.focus());
  };
  const onCaptionBlur = () => {
    setImageAttribute(view, getPos, { caption: figcaption.textContent?.trim() || null });
  };
  const onZoomClick = () => {
    const source = imageSource(attributes);
    figure.dispatchEvent(new CustomEvent(IMAGE_ZOOM_REQUESTED_EVENT, {
      bubbles: true,
      detail: { src: String(attributes.src ?? source), alt: imageAlt(attributes) },
    }));
  };
  const onDeleteClick = () => deleteImageNode(view, getPos);
  captionButton.addEventListener("click", onCaptionClick);
  figcaption.addEventListener("blur", onCaptionBlur);
  zoomButton.addEventListener("click", onZoomClick);
  deleteButton.addEventListener("click", onDeleteClick);

  const onResizePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizing = true;
    const startX = event.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const containerWidth = Math.min(850, figure.parentElement?.getBoundingClientRect().width || 850);
    resizeMove = (moveEvent: PointerEvent) => {
      const nextPx = Math.max(80, Math.min(containerWidth, startWidth + moveEvent.clientX - startX));
      const percent = Math.round((nextPx / containerWidth) * 1000) / 10;
      figure.style.width = `${percent}%`;
    };
    resizeFinish = () => {
      resizing = false;
      if (resizeMove) document.removeEventListener("pointermove", resizeMove);
      if (resizeFinish) document.removeEventListener("pointerup", resizeFinish);
      resizeMove = null;
      resizeFinish = null;
      setImageAttribute(view, getPos, { width: figure.style.width || null });
    };
    document.addEventListener("pointermove", resizeMove);
    document.addEventListener("pointerup", resizeFinish, { once: true });
  };
  resizeHandle.addEventListener("pointerdown", onResizePointerDown);
  render();

  return {
    dom: figure,
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== nodeType) return false;
      const previousSource = imageSource(attributes);
      attributes = nextNode.attrs as SafeImageAttributes;
      if (imageSource(attributes) !== previousSource) remoteLoaded = false;
      if (!resizing) render();
      return true;
    },
    stopEvent(event: Event) {
      if (event.type.startsWith("drag")) return false;
      const target = event.target as globalThis.Node;
      return toolbar.contains(target)
        || figcaption.contains(target)
        || resizeHandle.contains(target)
        || mediaWrap.classList.contains("remote-image-placeholder");
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      mediaWrap.removeEventListener("click", onClick);
      mediaWrap.removeEventListener("keydown", onKeyDown);
      captionButton.removeEventListener("click", onCaptionClick);
      figcaption.removeEventListener("blur", onCaptionBlur);
      zoomButton.removeEventListener("click", onZoomClick);
      deleteButton.removeEventListener("click", onDeleteClick);
      resizeHandle.removeEventListener("pointerdown", onResizePointerDown);
      if (resizeMove) document.removeEventListener("pointermove", resizeMove);
      if (resizeFinish) document.removeEventListener("pointerup", resizeFinish);
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
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSrc: { default: null, rendered: false },
      width: { default: null, rendered: false },
      caption: { default: null, rendered: false },
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
    const width = typeof node.attrs.width === "string" && /^\d+(?:\.\d+)?%$/.test(node.attrs.width)
      ? node.attrs.width
      : null;
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, width ? { style: `width: ${width}` } : {})];
  },
  addNodeView() {
    return ({ node, view, getPos }) => createSafeImageNodeView(node, view, getPos);
  },
});
