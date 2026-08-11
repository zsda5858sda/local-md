export function reorderById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): T[] {
  if (sourceId === targetId) return items;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  if (sourceIndex < 0) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  const targetIndex = next.findIndex((item) => item.id === targetId);
  if (!moved || targetIndex < 0) return items;
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, moved);
  return next;
}
