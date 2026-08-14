import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Braces, Code2, Heading1, Heading2, Image, Italic, Link2, List,
  ListChecks, ListOrdered, Minus, Quote, Redo2, Strikethrough, Table2,
  Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import { t } from "../i18n";
import { INSERT_LINK_REQUESTED_EVENT } from "../editor/extensions";

interface ToolbarProps {
  editor: Editor | null;
}

type InputDialog = { kind: "link" | "image"; value: string };

function ToolbarButton({ label, active, disabled, onClick, children }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={active ? "tool-button active" : "tool-button"} aria-label={label} title={label} disabled={disabled} onMouseDown={(event) => { event.preventDefault(); onClick(); }}>
      {children}
    </button>
  );
}

export function Toolbar({ editor }: ToolbarProps) {
  const [dialog, setDialog] = useState<InputDialog | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addLink = useCallback(() => {
    if (!editor) return;
    const href = editor.getAttributes("link").href;
    setDialog({ kind: "link", value: typeof href === "string" ? href : "https://" });
  }, [editor]);

  useEffect(() => {
    if (!dialog) return;
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

  if (!editor) return <div className="toolbar" aria-label={t("toolbar.aria")} />;
  const command = () => editor.chain().focus();
  const submitDialog = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    if (dialog.kind === "link") {
      if (!value) editor.chain().focus().extendMarkRange("link").unsetLink().run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    } else if (value) editor.chain().focus().setImage({ src: value }).run();
    setDialog(null);
  };
  return (
    <div className="toolbar" role="toolbar" aria-label={t("toolbar.aria")}>
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.undo")} disabled={!editor.can().undo()} onClick={() => command().undo().run()}><Undo2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.redo")} disabled={!editor.can().redo()} onClick={() => command().redo().run()}><Redo2 /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.bold")} active={editor.isActive("bold")} onClick={() => command().toggleBold().run()}><Bold /></ToolbarButton>
        <ToolbarButton label={t("toolbar.italic")} active={editor.isActive("italic")} onClick={() => command().toggleItalic().run()}><Italic /></ToolbarButton>
        <ToolbarButton label={t("toolbar.underline")} active={editor.isActive("underline")} onClick={() => command().toggleUnderline().run()}><UnderlineIcon /></ToolbarButton>
        <ToolbarButton label={t("toolbar.strike")} active={editor.isActive("strike")} onClick={() => command().toggleStrike().run()}><Strikethrough /></ToolbarButton>
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
        <ToolbarButton label={t("toolbar.codeBlock")} active={editor.isActive("codeBlock")} onClick={() => command().toggleCodeBlock().run()}><Code2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.horizontalRule")} onClick={() => command().setHorizontalRule().run()}><Minus /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.insertLink")} active={editor.isActive("link")} onClick={addLink}><Link2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.insertImage")} onClick={() => setDialog({ kind: "image", value: "./image.png" })}><Image /></ToolbarButton>
        <ToolbarButton label={t("toolbar.insertTable")} onClick={() => command().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></ToolbarButton>
      </div>
      {dialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <form className="entry-dialog toolbar-input-dialog" role="dialog" aria-modal="true" aria-labelledby="toolbar-dialog-title" onSubmit={(event) => { event.preventDefault(); submitDialog(); }} onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}>
            <h2 id="toolbar-dialog-title">{t(dialog.kind === "link" ? "toolbar.linkDialogTitle" : "toolbar.imageDialogTitle")}</h2>
            <label>
              <span>{t(dialog.kind === "link" ? "toolbar.linkField" : "toolbar.imageField")}</span>
              <input ref={inputRef} value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} inputMode="url" />
            </label>
            <div>
              <button type="button" className="secondary-button" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
              <button type="submit" className="primary-button" disabled={dialog.kind === "image" && !dialog.value.trim()}>{t("common.confirm")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
