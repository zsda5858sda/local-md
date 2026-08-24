import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { createPortal } from "react-dom";
import {
  Bold, Braces, Code2, Heading1, Heading2, Image, Italic, Link2, List,
  ListChecks, ListOrdered, Minus, Plus, Quote, Redo2, Strikethrough, Table2,
  Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import { t } from "../i18n";
import { chooseAndImportImage } from "../services/desktop";
import { INSERT_LINK_REQUESTED_EVENT } from "../editor/extensions";

interface ToolbarProps {
  editor: Editor | null;
  workspaceRoot: string;
  documentRelativePath: string;
  documentZoom: number;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
}

type InputDialog = { kind: "link" | "image"; value: string; imageTab?: "upload" | "url" };

const isMacPlatform = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const modifierKeyLabel = isMacPlatform ? "\u2318" : "Ctrl";

function shortcutText(shortcut?: string): string | undefined {
  return shortcut ? `${modifierKeyLabel}+${shortcut}` : undefined;
}

function ZoomControl({ documentZoom, onZoomOut, onZoomReset, onZoomIn }: Pick<ToolbarProps, "documentZoom" | "onZoomOut" | "onZoomReset" | "onZoomIn">) {
  return <div className="toolbar-zoom" aria-label="頁面文字大小">
    <button type="button" aria-label="縮小頁面文字" title="縮小文字" disabled={documentZoom <= 70} onMouseDown={(event) => { event.preventDefault(); onZoomOut(); }}><Minus /></button>
    <button type="button" className="toolbar-zoom-value" aria-label="重設頁面文字為 100%" title="重設為 100%" onMouseDown={(event) => { event.preventDefault(); onZoomReset(); }}>{documentZoom}%</button>
    <button type="button" aria-label="放大頁面文字" title="放大文字" disabled={documentZoom >= 160} onMouseDown={(event) => { event.preventDefault(); onZoomIn(); }}><Plus /></button>
  </div>;
}

function ToolbarButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltip, setTooltip] = useState<{ left: number; top: number } | null>(null);
  const shortcutLabel = shortcutText(shortcut);
  const fullLabel = shortcutLabel ? `${label} (${shortcutLabel})` : label;
  const showTooltip = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setTooltip({ left: rect.left + rect.width / 2, top: rect.bottom + 7 });
  };
  return (
    <>
      <button ref={buttonRef} type="button" className={active ? "tool-button active" : "tool-button"} aria-label={fullLabel} title={fullLabel} disabled={disabled}
        onMouseEnter={showTooltip} onMouseLeave={() => setTooltip(null)} onFocus={showTooltip} onBlur={() => setTooltip(null)}
        onMouseDown={(event) => { event.preventDefault(); setTooltip(null); onClick(); }}>
        {children}
      </button>
      {tooltip && createPortal(<div className="tool-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}><span>{label}</span>{shortcutLabel && <kbd>{shortcutLabel}</kbd>}</div>, document.body)}
    </>
  );
}

export function Toolbar({ editor, workspaceRoot, documentRelativePath, documentZoom, onZoomOut, onZoomReset, onZoomIn }: ToolbarProps) {
  const zoomControl = <ZoomControl documentZoom={documentZoom} onZoomOut={onZoomOut} onZoomReset={onZoomReset} onZoomIn={onZoomIn} />;
  const [dialog, setDialog] = useState<InputDialog | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const addLink = useCallback(() => {
    if (!editor) return;
    const href = editor.getAttributes("link").href;
    setDialog({ kind: "link", value: typeof href === "string" ? href : "https://" });
  }, [editor]);

  useEffect(() => {
    if (!dialog || dialog.kind !== "link") return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog?.kind]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const editorElement = editor.view.dom;
    editorElement.addEventListener(INSERT_LINK_REQUESTED_EVENT, addLink);
    return () => editorElement.removeEventListener(INSERT_LINK_REQUESTED_EVENT, addLink);
  }, [addLink, editor]);

  const browseLocalImage = useCallback(async () => {
    if (!editor) return;
    setImportError(null);
    setImporting(true);
    try {
      const asset = await chooseAndImportImage(workspaceRoot, documentRelativePath);
      if (asset) {
        editor.chain().focus().setImage({ src: asset.relativePath }).run();
        setDialog(null);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }, [documentRelativePath, editor, workspaceRoot]);

  if (!editor) return <div className="toolbar" aria-label={t("toolbar.aria")}><div className="toolbar-controls" />{zoomControl}</div>;
  const command = () => editor.chain().focus();
  const codeBlockActive = editor.isActive("codeBlock");

  const submitLinkDialog = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    if (!value) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    setDialog(null);
  };

  const submitImageUrl = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    if (value) editor.chain().focus().setImage({ src: value }).run();
    setDialog(null);
  };
  return (
    <div className="toolbar" role="toolbar" aria-label={t("toolbar.aria")}>
      <div className="toolbar-controls">
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.undo")} shortcut="Z" disabled={!editor.can().undo()} onClick={() => command().undo().run()}><Undo2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.redo")} shortcut="Shift+Z" disabled={!editor.can().redo()} onClick={() => command().redo().run()}><Redo2 /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.bold")} shortcut="B" active={editor.isActive("bold")} onClick={() => command().toggleBold().run()}><Bold /></ToolbarButton>
        <ToolbarButton label={t("toolbar.italic")} shortcut="I" active={editor.isActive("italic")} onClick={() => command().toggleItalic().run()}><Italic /></ToolbarButton>
        <ToolbarButton label={t("toolbar.underline")} shortcut="U" active={editor.isActive("underline")} onClick={() => command().toggleUnderline().run()}><UnderlineIcon /></ToolbarButton>
        <ToolbarButton label={t("toolbar.strike")} shortcut="Shift+X" active={editor.isActive("strike")} onClick={() => command().toggleStrike().run()}><Strikethrough /></ToolbarButton>
        <ToolbarButton label={t("toolbar.inlineCode")} active={editor.isActive("code")} onClick={() => command().toggleCode().run()}><Braces /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.heading1")} active={editor.isActive("heading", { level: 1 })} onClick={() => command().toggleHeading({ level: 1 }).run()}><Heading1 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.heading2")} active={editor.isActive("heading", { level: 2 })} onClick={() => command().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.bulletList")} active={editor.isActive("bulletList")} onClick={() => command().toggleBulletList().run()}><List /></ToolbarButton>
        <ToolbarButton label={t("toolbar.orderedList")} active={editor.isActive("orderedList")} onClick={() => command().toggleOrderedList().run()}><ListOrdered /></ToolbarButton>
        <ToolbarButton label={t("toolbar.taskList")} active={editor.isActive("taskList")} onClick={() => command().toggleTaskList().run()}><ListChecks /></ToolbarButton>
        <ToolbarButton label={t("toolbar.blockquote")} active={editor.isActive("blockquote")} onClick={() => command().toggleBlockquote().run()}><Quote /></ToolbarButton>
        <ToolbarButton label={t("toolbar.codeBlock")} active={codeBlockActive} onClick={() => command().toggleCodeBlock({ language: "python" }).run()}><Code2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.horizontalRule")} onClick={() => command().setHorizontalRule().run()}><Minus /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.insertLink")} shortcut="K" active={editor.isActive("link")} onClick={addLink}><Link2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.insertImage")} onClick={() => { setImportError(null); setDialog({ kind: "image", value: "https://", imageTab: "upload" }); }}><Image /></ToolbarButton>
        <ToolbarButton label={t("toolbar.insertTable")} onClick={() => command().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></ToolbarButton>
      </div>
      </div>
      {dialog?.kind === "link" && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <form className="entry-dialog toolbar-input-dialog" role="dialog" aria-modal="true" aria-labelledby="toolbar-dialog-title" onSubmit={(event) => { event.preventDefault(); submitLinkDialog(); }} onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}>
            <h2 id="toolbar-dialog-title">{t("toolbar.linkDialogTitle")}</h2>
            <label>
              <span>{t("toolbar.linkField")}</span>
              <input ref={inputRef} value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} inputMode="url" />
            </label>
            <div>
              <button type="button" className="secondary-button" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
              <button type="submit" className="primary-button">{t("common.confirm")}</button>
            </div>
          </form>
        </div>
      )}

      {dialog?.kind === "image" && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="entry-dialog toolbar-input-dialog image-dialog" role="dialog" aria-modal="true" aria-labelledby="image-dialog-title" onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}>
            <h2 id="image-dialog-title">{t("toolbar.imageDialogTitle")}</h2>
            <div className="image-dialog-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={dialog.imageTab !== "url"} className={dialog.imageTab !== "url" ? "active" : ""} onClick={() => setDialog({ ...dialog, imageTab: "upload" })}>{t("toolbar.imageTabUpload")}</button>
              <button type="button" role="tab" aria-selected={dialog.imageTab === "url"} className={dialog.imageTab === "url" ? "active" : ""} onClick={() => setDialog({ ...dialog, imageTab: "url" })}>{t("toolbar.imageTabUrl")}</button>
            </div>
            {dialog.imageTab === "url" ? (
              <form className="image-dialog-content" onSubmit={(event) => { event.preventDefault(); submitImageUrl(); }}>
                <label>
                  <span>{t("toolbar.imageField")}</span>
                  <input value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} inputMode="url" autoFocus />
                </label>
                <div className="image-dialog-actions">
                  <button type="button" className="secondary-button" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
                  <button type="submit" className="primary-button" disabled={!dialog.value.trim()}>{t("common.confirm")}</button>
                </div>
              </form>
            ) : (
              <div className="image-dialog-content">
                <button type="button" className="upload-file-button" disabled={importing} onClick={() => void browseLocalImage()}>
                  {importing ? t("toolbar.imageImporting") : t("toolbar.imageUploadButton")}
                </button>
                {importError && <p className="search-error" role="alert">{importError}</p>}
                <div className="image-dialog-actions">
                  <button type="button" className="secondary-button" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {zoomControl}
    </div>
  );
}
