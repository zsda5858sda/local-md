import { useEffect, useRef, useState } from "react";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import type { OpenDocument, TiptapNode } from "../domain/types";
import { AnnotatedLink, handleEditorLinkClick, IMAGE_NODE_DRAG_ENDED_EVENT, IMAGE_NODE_DRAG_MOVED_EVENT, IMAGE_NODE_DRAG_STARTED_EVENT, IMAGE_ZOOM_REQUESTED_EVENT, LinkShortcut, MarkdownMetadata, RawMarkdown, SafeImage } from "../editor/extensions";
import { importImageAsset, importImageDataUri, isTauri, loadWorkspaceAsset, openExternalLink } from "../services/desktop";
import { sanitizeHtml } from "../services/htmlSanitizer";
import { Toolbar } from "./Toolbar";
import { TableControls } from "./TableControls";
import { t } from "../i18n";
import { CodeBlockView } from "./CodeBlockView";
import { imageDataFromFile } from "../services/embeddedImage";

const lowlight = createLowlight(common);
const CodeBlockWithControls = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, { contentDOMElementTag: "code" });
  },
});

interface EditorPaneProps {
  document: OpenDocument;
  onChange: (doc: TiptapNode) => void;
  onSourceChange: (source: string) => void;
  workspaceRoot: string;
  targetText?: string;
  targetNonce?: number;
  documentZoom: number;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
}

async function migrateEmbeddedImages(node: TiptapNode, workspaceRoot: string, documentRelativePath: string): Promise<TiptapNode> {
  const content = node.content ? await Promise.all(node.content.map((child) => migrateEmbeddedImages(child, workspaceRoot, documentRelativePath))) : undefined;
  if (node.type !== "image") return { ...node, ...(content ? { content } : {}) };
  const markdownSrc = String(node.attrs?.markdownSrc ?? node.attrs?.src ?? "");
  if (/^data:image\/[a-z+]+;base64,/i.test(markdownSrc)) {
    try {
      const asset = await importImageDataUri(workspaceRoot, documentRelativePath, String(node.attrs?.alt ?? "image"), markdownSrc);
      return { ...node, attrs: { ...node.attrs, src: asset.relativePath, markdownSrc: asset.relativePath } };
    } catch { return node; }
  }
  return { ...node, ...(content ? { content } : {}) };
}

function hasEmbeddedImage(node: TiptapNode): boolean {
  if (node.type === "image" && /^data:image\/[a-z+]+;base64,/i.test(String(node.attrs?.markdownSrc ?? node.attrs?.src ?? ""))) return true;
  return node.content?.some(hasEmbeddedImage) ?? false;
}

export function EditorPane({ document, onChange, onSourceChange, workspaceRoot, targetText, targetNonce, documentZoom, onZoomOut, onZoomReset, onZoomIn }: EditorPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [imageDropActive, setImageDropActive] = useState(false);
  const draggedImagePositionRef = useRef<number | null>(null);
  const imageDropIndicatorRef = useRef<HTMLDivElement | null>(null);
  const nativeFileDragRef = useRef(false);
  async function insertImageAsset(image: { relativePath: string }, position?: number): Promise<boolean> {
    if (!editor || editor.isDestroyed) return false;
    if (position !== undefined) editor.commands.setTextSelection(position);
    const fileName = image.relativePath.split("/").at(-1) ?? "圖片";
    editor.chain().focus().setImage({ src: image.relativePath, alt: fileName }).run();
    return true;
  }
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false, underline: false }),
      CodeBlockWithControls.configure({ lowlight }),
      AnnotatedLink.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: null },
      }),
      LinkShortcut,
      Underline,
      SafeImage.configure({ inline: true, allowBase64: false, resolveLocalImage: (source: string) => loadWorkspaceAsset(workspaceRoot, document.relativePath, source) } as never),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      RawMarkdown,
      MarkdownMetadata,
    ],
    content: document.parsed.doc,
    editorProps: {
      attributes: { class: "prose-editor", "aria-label": t("editor.aria", { title: document.title }), spellcheck: "true" },
      handleDOMEvents: {
        click: (_view, event) => handleEditorLinkClick(event, setPendingLink),
        dragover: (_view, event) => {
          const transfer = event.dataTransfer;
          if (!transfer) return false;
          if (!transfer.files.length) return false;
          event.preventDefault();
          transfer.dropEffect = "copy";
          setImageDropActive(true);
          return true;
        },
        dragleave: (view, event) => {
          if (event.target === view.dom) setImageDropActive(false);
          return false;
        },
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        setImageDropActive(false);
        setPasteError(null);
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void (async () => {
          const inserted: string[] = [];
          for (const file of files) {
            const image = await imageDataFromFile(file);
            if (!image) continue;
            if (!editor || editor.isDestroyed) return;
            if (position !== undefined && !inserted.length) editor.commands.setTextSelection(position);
            const asset = await importImageDataUri(workspaceRoot, document.relativePath, image.fileName, image.dataUri);
            if (editor.isDestroyed) return;
            editor.chain().focus().setImage({ src: asset.relativePath, alt: asset.relativePath.split("/").at(-1) ?? image.fileName }).run();
            inserted.push(image.fileName);
          }
          if (!inserted.length) setPasteError(t("editor.dropImageUnsupported"));
        })().catch(() => setPasteError(t("editor.pasteImageFailed")));
        return true;
      },
      handlePaste: (view, event) => {
        const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
        if (image) {
          event.preventDefault();
          setPasteError(null);
          void imageDataFromFile(image).then(async (data) => {
            if (!data || editor?.isDestroyed) {
              if (!data) setPasteError(t("editor.pasteImageUnsupported"));
              return;
            }
            const asset = await importImageDataUri(workspaceRoot, document.relativePath, data.fileName, data.dataUri);
            if (!editor.isDestroyed) editor.chain().focus().setImage({ src: asset.relativePath, alt: asset.relativePath.split("/").at(-1) ?? data.fileName }).run();
          }).catch(() => setPasteError(t("editor.pasteImageFailed")));
          return true;
        }
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (!html) return false;
        event.preventDefault();
        const sanitized = sanitizeHtml(html);
        if (sanitized) editor?.commands.insertContent(sanitized);
        else view.dispatch(view.state.tr.insertText(event.clipboardData?.getData("text/plain") ?? ""));
        return true;
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as TiptapNode),
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || document.parsed.mode === "compatibility" || !hasEmbeddedImage(document.parsed.doc)) return;
    let cancelled = false;
    void migrateEmbeddedImages(document.parsed.doc, workspaceRoot, document.relativePath).then((nextDoc) => {
      if (cancelled || editor.isDestroyed) return;
      const current = JSON.stringify(editor.getJSON());
      const next = JSON.stringify(nextDoc);
      if (current !== next) editor.commands.setContent(nextDoc, { emitUpdate: hasEmbeddedImage(document.parsed.doc) });
    });
    return () => { cancelled = true; };
  }, [document.parsed.doc, document.parsed.mode, document.relativePath, editor, workspaceRoot]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || document.parsed.mode === "compatibility") return;
    editor.commands.setContent(document.parsed.doc, { emitUpdate: false });
  }, [document.editorVersion, document.parsed.mode, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !targetText) return;
    const needle = targetText.replace(/^[\s>*+-]*(?:\[[ xX]\]\s*)?/, "").replace(/[*_`~]/g, "").trim();
    const tokens = needle.split(/[\s:：|()[\]]+/).filter((token) => token.length >= 2);
    if (!tokens.length) return;
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (position !== undefined || !node.isText || !node.text) return;
      const lower = node.text.toLocaleLowerCase();
      const token = tokens.find((value) => lower.includes(value.toLocaleLowerCase()));
      if (token) position = pos + lower.indexOf(token.toLocaleLowerCase());
    });
    if (position !== undefined) {
      editor.commands.setTextSelection(position);
      editor.commands.focus(undefined, { scrollIntoView: true });
    }
  }, [editor, targetNonce, targetText]);

  useEffect(() => {
    if (!isTauri() || !editor || editor.isDestroyed) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    const withinEditor = (x: number, y: number) => {
      const bounds = scrollRef.current?.getBoundingClientRect();
      return Boolean(bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom);
    };
    void getCurrentWebview().onDragDropEvent(async ({ payload }) => {
      if (disposed) return;
      const paths = "paths" in payload ? payload.paths : [];
      if (payload.type === "leave") {
        nativeFileDragRef.current = false;
        setImageDropActive(false);
        return;
      }
      const position = payload.position.toLogical(window.devicePixelRatio);
      const isOverEditor = withinEditor(position.x, position.y);
      if (payload.type === "enter") {
        nativeFileDragRef.current = paths.length > 0;
        setImageDropActive(isOverEditor && nativeFileDragRef.current);
        return;
      }
      if (payload.type === "over") {
        setImageDropActive(isOverEditor && nativeFileDragRef.current);
        return;
      }
      nativeFileDragRef.current = false;
      setImageDropActive(false);
      if (!isOverEditor || !paths.length) return;
      setPasteError(null);
      let inserted = false;
      for (const sourcePath of paths) {
        try {
          const image = await importImageAsset(workspaceRoot, document.relativePath, sourcePath);
          if (disposed || !(await insertImageAsset(image, inserted ? undefined : editor.view.posAtCoords({ left: position.x, top: position.y })?.pos))) return;
          inserted = true;
        } catch (error) {
          if (!disposed) setPasteError(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, [document.parsed.frontMatter, document.profile, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onImageDragStart = (event: Event) => {
      const position = (event as CustomEvent<{ position?: unknown }>).detail?.position;
      draggedImagePositionRef.current = typeof position === "number" ? position : null;
    };
    const onImageDragMove = (event: Event) => {
      const detail = (event as CustomEvent<{ clientX?: unknown; clientY?: unknown }>).detail;
      if (typeof detail?.clientX !== "number" || typeof detail.clientY !== "number") return;
      const position = editor.view.posAtCoords({ left: detail.clientX, top: detail.clientY })?.pos;
      if (position === undefined) return;
      const cursor = editor.view.coordsAtPos(position);
      const bounds = editor.view.dom.getBoundingClientRect();
      const indicator = imageDropIndicatorRef.current ?? globalThis.document.createElement("div");
      indicator.className = "image-drop-indicator";
      indicator.style.left = `${bounds.left + 20}px`;
      indicator.style.top = `${cursor.top - 2}px`;
      indicator.style.width = `${Math.max(32, bounds.width - 40)}px`;
      if (!imageDropIndicatorRef.current) {
        globalThis.document.body.append(indicator);
        imageDropIndicatorRef.current = indicator;
      }
    };
    const onImageDragEnd = (event: Event) => {
      imageDropIndicatorRef.current?.remove();
      imageDropIndicatorRef.current = null;
      const sourcePosition = draggedImagePositionRef.current;
      draggedImagePositionRef.current = null;
      if (sourcePosition === null) return;
      const detail = (event as CustomEvent<{ clientX?: unknown; clientY?: unknown }>).detail;
      if (typeof detail?.clientX !== "number" || typeof detail.clientY !== "number") return;
      const image = editor.state.doc.nodeAt(sourcePosition);
      const targetPosition = editor.view.posAtCoords({ left: detail.clientX, top: detail.clientY })?.pos;
      if (!image || image.type.name !== "image" || targetPosition === undefined
        || (targetPosition >= sourcePosition && targetPosition <= sourcePosition + image.nodeSize)) return;
      const insertionPosition = targetPosition > sourcePosition
        ? targetPosition - image.nodeSize
        : targetPosition;
      try {
        editor.view.dispatch(editor.state.tr
          .delete(sourcePosition, sourcePosition + image.nodeSize)
          .insert(insertionPosition, image));
      } catch {
        setPasteError(t("editor.imageMoveFailed"));
      }
    };
    editor.view.dom.addEventListener(IMAGE_NODE_DRAG_STARTED_EVENT, onImageDragStart);
    editor.view.dom.addEventListener(IMAGE_NODE_DRAG_MOVED_EVENT, onImageDragMove);
    editor.view.dom.addEventListener(IMAGE_NODE_DRAG_ENDED_EVENT, onImageDragEnd);
    return () => {
      editor.view.dom.removeEventListener(IMAGE_NODE_DRAG_STARTED_EVENT, onImageDragStart);
      editor.view.dom.removeEventListener(IMAGE_NODE_DRAG_MOVED_EVENT, onImageDragMove);
      editor.view.dom.removeEventListener(IMAGE_NODE_DRAG_ENDED_EVENT, onImageDragEnd);
      imageDropIndicatorRef.current?.remove();
      imageDropIndicatorRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const editorElement = editor.view.dom;
    const onZoom = (event: Event) => {
      const detail = (event as CustomEvent<{ src: string; alt: string }>).detail;
      if (detail?.src) setZoomedImage(detail);
    };
    editorElement.addEventListener(IMAGE_ZOOM_REQUESTED_EVENT, onZoom);
    return () => editorElement.removeEventListener(IMAGE_ZOOM_REQUESTED_EVENT, onZoom);
  }, [editor]);

  useEffect(() => {
    if (!zoomedImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomedImage(null);
    };
    globalThis.document.addEventListener("keydown", closeOnEscape);
    return () => globalThis.document.removeEventListener("keydown", closeOnEscape);
  }, [zoomedImage]);

  if (document.parsed.mode === "compatibility") {
    return (
      <div className="source-mode">
        <Toolbar editor={null} workspaceRoot={workspaceRoot} documentRelativePath={document.relativePath} documentZoom={documentZoom} onZoomOut={onZoomOut} onZoomReset={onZoomReset} onZoomIn={onZoomIn} />
        <div className="compatibility-banner" role="alert">
          <strong>{t("editor.compatibilityTitle")}</strong>
          <span>{t("editor.compatibilityDescription")}</span>
        </div>
        <textarea aria-label={t("editor.sourceAria", { title: document.title })} value={document.parsed.source} onChange={(event) => onSourceChange(event.target.value)} spellCheck={false} />
      </div>
    );
  }

  return (
    <div className="editor-pane">
      <Toolbar
        editor={editor}
        workspaceRoot={workspaceRoot}
        documentRelativePath={document.relativePath}
        documentZoom={documentZoom}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onZoomIn={onZoomIn}
      />
      {document.parsed.issues.length > 0 && (
        <details className="issue-banner">
          <summary>{t("editor.compatibilityIssues", { count: document.parsed.issues.length })}</summary>
          <ul>{document.parsed.issues.map((issue, index) => <li key={`${issue.message}-${index}`}>{issue.message}</li>)}</ul>
        </details>
      )}
      {pasteError && <p className="search-error" role="alert">{pasteError}</p>}
      <div ref={scrollRef} className={imageDropActive ? "editor-scroll image-drop-active" : "editor-scroll"}>
        <EditorContent editor={editor} />
        <TableControls editor={editor} containerRef={scrollRef} />
      </div>
      {pendingLink && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingLink(null); }}>
          <div className="entry-dialog" role="alertdialog" aria-modal="true" aria-labelledby="external-link-title" onKeyDown={(event) => { if (event.key === "Escape") setPendingLink(null); }}>
            <h2 id="external-link-title">{t("link.externalWarningTitle")}</h2>
            <p className="external-link-warning">{t("link.externalWarningBody", { url: pendingLink })}</p>
            <div>
              <button type="button" className="secondary-button" onClick={() => setPendingLink(null)}>{t("common.cancel")}</button>
              <button type="button" className="primary-button" autoFocus onClick={() => { void openExternalLink(pendingLink); setPendingLink(null); }}>{t("link.openInBrowser")}</button>
            </div>
          </div>
        </div>
      )}
      {zoomedImage && (
        <div className="image-lightbox-backdrop" role="dialog" aria-modal="true" aria-label={t("image.zoom")} onMouseDown={(event) => { if (event.target === event.currentTarget) setZoomedImage(null); }}>
          <img className="image-lightbox-img" src={zoomedImage.src} alt={zoomedImage.alt} />
          <button type="button" className="image-lightbox-close" aria-label={t("common.close")} autoFocus onClick={() => setZoomedImage(null)}>×</button>
        </div>
      )}
    </div>
  );
}
