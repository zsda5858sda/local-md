import { useEffect, useRef, useState } from "react";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import type { OpenDocument, TiptapNode } from "../domain/types";
import { AnnotatedLink, handleEditorLinkClick, IMAGE_ZOOM_REQUESTED_EVENT, LinkShortcut, MarkdownMetadata, RawMarkdown, SafeImage } from "../editor/extensions";
import { loadWorkspaceAsset, openExternalLink } from "../services/desktop";
import { sanitizeHtml } from "../services/htmlSanitizer";
import { Toolbar } from "./Toolbar";
import { TableControls } from "./TableControls";
import { t } from "../i18n";
import { CodeBlockView } from "./CodeBlockView";

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

async function hydrateImages(node: TiptapNode, workspaceRoot: string, documentRelativePath: string): Promise<TiptapNode> {
  const content = node.content ? await Promise.all(node.content.map((child) => hydrateImages(child, workspaceRoot, documentRelativePath))) : undefined;
  if (node.type !== "image") return { ...node, ...(content ? { content } : {}) };
  const markdownSrc = String(node.attrs?.markdownSrc ?? node.attrs?.src ?? "");
  if (!markdownSrc || /^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(markdownSrc)) return { ...node, ...(content ? { content } : {}) };
  try {
    const src = await loadWorkspaceAsset(workspaceRoot, documentRelativePath, markdownSrc);
    return src ? { ...node, attrs: { ...node.attrs, src, markdownSrc } } : node;
  } catch { return node; }
}

function hasLocalImage(node: TiptapNode): boolean {
  if (node.type === "image") {
    const src = String(node.attrs?.markdownSrc ?? node.attrs?.src ?? "");
    if (src && !/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(src)) return true;
  }
  return node.content?.some(hasLocalImage) ?? false;
}

export function EditorPane({ document, onChange, onSourceChange, workspaceRoot, targetText, targetNonce, documentZoom, onZoomOut, onZoomReset, onZoomIn }: EditorPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);
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
      SafeImage.configure({ inline: true, allowBase64: false }),
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
      },
      handlePaste: (view, event) => {
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
    if (!editor || editor.isDestroyed || document.parsed.mode === "compatibility" || !hasLocalImage(document.parsed.doc)) return;
    let cancelled = false;
    void hydrateImages(document.parsed.doc, workspaceRoot, document.relativePath).then((nextDoc) => {
      if (cancelled || editor.isDestroyed) return;
      const current = JSON.stringify(editor.getJSON());
      const next = JSON.stringify(nextDoc);
      if (current !== next) editor.commands.setContent(nextDoc, { emitUpdate: false });
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
      <div ref={scrollRef} className="editor-scroll">
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
