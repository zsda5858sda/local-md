import type { Editor } from "@tiptap/react";
import {
  Bold, Braces, Code2, Heading1, Heading2, Image, Italic, Link2, List,
  ListChecks, ListOrdered, Minus, Quote, Redo2, Strikethrough, Table2,
  Underline as UnderlineIcon, Undo2,
} from "lucide-react";

interface ToolbarProps {
  editor: Editor | null;
}

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
  if (!editor) return <div className="toolbar" aria-label="編輯工具列" />;
  const command = () => editor.chain().focus();
  const addLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("連結網址", previous ?? "https://");
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
  };
  const addImage = () => {
    const src = window.prompt("本機圖片相對路徑（遠端圖片預設不載入）", "./image.png");
    if (src?.trim()) editor.chain().focus().setImage({ src: src.trim() }).run();
  };
  return (
    <div className="toolbar" role="toolbar" aria-label="編輯工具列">
      <div className="tool-group">
        <ToolbarButton label="復原" disabled={!editor.can().undo()} onClick={() => command().undo().run()}><Undo2 /></ToolbarButton>
        <ToolbarButton label="重做" disabled={!editor.can().redo()} onClick={() => command().redo().run()}><Redo2 /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label="粗體" active={editor.isActive("bold")} onClick={() => command().toggleBold().run()}><Bold /></ToolbarButton>
        <ToolbarButton label="斜體" active={editor.isActive("italic")} onClick={() => command().toggleItalic().run()}><Italic /></ToolbarButton>
        <ToolbarButton label="底線（HTML 相容）" active={editor.isActive("underline")} onClick={() => command().toggleUnderline().run()}><UnderlineIcon /></ToolbarButton>
        <ToolbarButton label="刪除線" active={editor.isActive("strike")} onClick={() => command().toggleStrike().run()}><Strikethrough /></ToolbarButton>
        <ToolbarButton label="行內程式碼" active={editor.isActive("code")} onClick={() => command().toggleCode().run()}><Braces /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label="標題一" active={editor.isActive("heading", { level: 1 })} onClick={() => command().toggleHeading({ level: 1 }).run()}><Heading1 /></ToolbarButton>
        <ToolbarButton label="標題二" active={editor.isActive("heading", { level: 2 })} onClick={() => command().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolbarButton>
        <ToolbarButton label="無序清單" active={editor.isActive("bulletList")} onClick={() => command().toggleBulletList().run()}><List /></ToolbarButton>
        <ToolbarButton label="有序清單" active={editor.isActive("orderedList")} onClick={() => command().toggleOrderedList().run()}><ListOrdered /></ToolbarButton>
        <ToolbarButton label="任務清單" active={editor.isActive("taskList")} onClick={() => command().toggleTaskList().run()}><ListChecks /></ToolbarButton>
        <ToolbarButton label="引言" active={editor.isActive("blockquote")} onClick={() => command().toggleBlockquote().run()}><Quote /></ToolbarButton>
        <ToolbarButton label="程式碼區塊" active={editor.isActive("codeBlock")} onClick={() => command().toggleCodeBlock().run()}><Code2 /></ToolbarButton>
        <ToolbarButton label="分隔線" onClick={() => command().setHorizontalRule().run()}><Minus /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label="插入連結" active={editor.isActive("link")} onClick={addLink}><Link2 /></ToolbarButton>
        <ToolbarButton label="插入圖片" onClick={addImage}><Image /></ToolbarButton>
        <ToolbarButton label="插入 3 × 3 表格" onClick={() => command().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></ToolbarButton>
      </div>
    </div>
  );
}
