import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

export interface OutlineItem {
  pos: number;
  level: number;
  text: string;
}

export function collectOutlineItems(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  if (editor.isDestroyed) return items;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    items.push({
      pos,
      level: Number(node.attrs.level ?? 1),
      text: node.textContent,
    });
  });
  return items;
}

export function findActiveSectionIndex(items: OutlineItem[], activeIndex: number): number {
  if (activeIndex < 0 || activeIndex >= items.length) return -1;
  const topLevel = items.reduce((minimum, item) => Math.min(minimum, item.level), 6);
  for (let index = activeIndex; index >= 0; index -= 1) {
    if (items[index]?.level === topLevel) return index;
  }
  return -1;
}

function sameOutline(left: OutlineItem[], right: OutlineItem[]): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.pos === other?.pos && item.level === other.level && item.text === other.text;
  });
}

export function useOutline(editor: Editor | null, scrollElement: HTMLElement | null) {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const itemsRef = useRef<OutlineItem[]>([]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      itemsRef.current = [];
      setItems([]);
      setActiveIndex(-1);
      return;
    }
    const collect = () => {
      if (editor.isDestroyed) return;
      const next = collectOutlineItems(editor);
      itemsRef.current = next;
      setItems((current) => sameOutline(current, next) ? current : next);
      setActiveIndex((current) => current >= next.length ? next.length - 1 : current);
    };
    collect();
    editor.on("update", collect);
    editor.on("selectionUpdate", collect);
    return () => {
      editor.off("update", collect);
      editor.off("selectionUpdate", collect);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollElement || items.length === 0) {
      setActiveIndex(-1);
      return;
    }
    let frame = 0;
    const updateActive = () => {
      frame = 0;
      if (editor.isDestroyed) return;
      const headingElements = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
      const containerTop = scrollElement.getBoundingClientRect().top;
      let next = -1;
      headingElements.forEach((element, index) => {
        if (element.getBoundingClientRect().top - containerTop <= 96) next = index;
      });
      setActiveIndex(Math.min(next, itemsRef.current.length - 1));
    };
    const scheduleUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateActive);
    };
    updateActive();
    scrollElement.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollElement.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [editor, items, scrollElement]);

  const activeSectionIndex = useMemo(
    () => findActiveSectionIndex(items, activeIndex),
    [activeIndex, items],
  );

  const goToHeading = useCallback((index: number) => {
    const item = itemsRef.current[index];
    if (!editor || editor.isDestroyed || !item) return;
    editor.chain()
      .setTextSelection(item.pos + 1)
      .focus(undefined, { scrollIntoView: true })
      .run();
    setActiveIndex(index);
  }, [editor]);

  return { items, activeIndex, activeSectionIndex, goToHeading };
}
