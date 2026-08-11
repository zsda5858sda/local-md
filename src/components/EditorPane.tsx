import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import type { OpenDocument, TiptapNode } from "../domain/types";
import { MarkdownMetadata, RawMarkdown, SafeImage } from "../editor/extensions";
import { loadWorkspaceAsset } from "../services/desktop";
import { Toolbar } from "./Toolbar";

const lowlight = createLowlight(common);

interface EditorPaneProps {
  document: OpenDocument;
  onChange: (doc: TiptapNode) => void;
  onSourceChange: (source: string) => void;
  workspaceRoot: string;
  targetText?: string;
  targetNonce?: number;
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

export function EditorPane({ document, onChange, onSourceChange, workspaceRoot, targetText, targetNonce }: EditorPaneProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false, underline: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
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
      attributes: { class: "prose-editor", "aria-label": `編輯 ${document.title}`, spellcheck: "true" },
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (/<(?:script|iframe)\b|\bon\w+\s*=|javascript:/i.test(html)) {
          event.preventDefault();
          const plain = event.clipboardData?.getData("text/plain") ?? "";
          window.document.execCommand?.("insertText", false, plain);
          return true;
        }
        return false;
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

  if (document.parsed.mode === "compatibility") {
    return (
      <div className="source-mode">
        <div className="compatibility-banner" role="alert">
          <strong>相容純文字模式</strong>
          <span>此文件含無法安全切割的語法。內容不會經過視覺編輯器重建。</span>
        </div>
        <textarea aria-label={`${document.title} 原始 Markdown`} value={document.parsed.source} onChange={(event) => onSourceChange(event.target.value)} spellCheck={false} />
      </div>
    );
  }

  return (
    <div className="editor-pane">
      <Toolbar editor={editor} />
      {document.parsed.issues.length > 0 && (
        <details className="issue-banner">
          <summary>{document.parsed.issues.length} 項相容性提醒</summary>
          <ul>{document.parsed.issues.map((issue, index) => <li key={`${issue.message}-${index}`}>{issue.message}</li>)}</ul>
        </details>
      )}
      <div className="editor-scroll"><EditorContent editor={editor} /></div>
    </div>
  );
}
