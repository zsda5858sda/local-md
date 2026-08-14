import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Rows3, Trash2, X } from "lucide-react";
import { t } from "../i18n";

interface TableControlsProps {
  editor: Editor | null;
  containerRef: RefObject<HTMLDivElement | null>;
}

type Position = { left: number; top: number };

function selectedTable(editor: Editor): HTMLTableElement | null {
  const domPosition = editor.view.domAtPos(editor.state.selection.from);
  const element = domPosition.node instanceof Element ? domPosition.node : domPosition.node.parentElement;
  return element?.closest("table") ?? null;
}

export function TableControls({ editor, containerRef }: TableControlsProps) {
  const [position, setPosition] = useState<Position | null>(null);

  const updatePosition = useCallback(() => {
    const container = containerRef.current;
    if (!editor || editor.isDestroyed || !container || !editor.isActive("table")) {
      setPosition(null);
      return;
    }
    const table = selectedTable(editor);
    if (!table) {
      setPosition(null);
      return;
    }
    const tableRect = table.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setPosition({
      left: Math.max(8, tableRect.right - containerRect.left + container.scrollLeft - 250),
      top: Math.max(8, tableRect.top - containerRect.top + container.scrollTop - 35),
    });
  }, [containerRef, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", updatePosition);
    editor.on("transaction", updatePosition);
    const container = containerRef.current;
    container?.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("resize", updatePosition);
    updatePosition();
    return () => {
      editor.off("selectionUpdate", updatePosition);
      editor.off("transaction", updatePosition);
      container?.removeEventListener("scroll", updatePosition);
      window.removeEventListener("resize", updatePosition);
    };
  }, [containerRef, editor, updatePosition]);

  if (!editor || !position) return null;

  const run = (command: () => boolean) => {
    editor.chain().focus().run();
    command();
    updatePosition();
  };
  const button = (label: string, action: () => boolean, icon: React.ReactNode) => (
    <button type="button" title={label} aria-label={label} onMouseDown={(event) => { event.preventDefault(); run(action); }}>
      {icon}
    </button>
  );

  return (
    <div className="table-controls" role="toolbar" aria-label={t("table.controls")} style={position}>
      <span><Rows3 />{t("table.row")}</span>
      {button(t("table.addRowBefore"), () => editor.commands.addRowBefore(), <ArrowUp />)}
      {button(t("table.addRowAfter"), () => editor.commands.addRowAfter(), <ArrowDown />)}
      {button(t("table.deleteRow"), () => editor.commands.deleteRow(), <Trash2 />)}
      <i />
      <span><Columns3 />{t("table.column")}</span>
      {button(t("table.addColumnBefore"), () => editor.commands.addColumnBefore(), <ArrowLeft />)}
      {button(t("table.addColumnAfter"), () => editor.commands.addColumnAfter(), <ArrowRight />)}
      {button(t("table.deleteColumn"), () => editor.commands.deleteColumn(), <Trash2 />)}
      <i />
      {button(t("table.deleteTable"), () => {
        if (!window.confirm(t("table.deleteTableConfirm"))) return false;
        return editor.commands.deleteTable();
      }, <X />)}
    </div>
  );
}
