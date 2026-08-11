export type ShortcutAction = "save" | "close-tab" | "search" | "replace" | "allow-editor" | "block-browser" | null;

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const EDITOR_PLAIN_KEYS = new Set(["a", "b", "c", "i", "k", "u", "v", "x", "y", "z"]);
const EDITOR_NAVIGATION_KEYS = new Set(["arrowdown", "arrowleft", "arrowright", "arrowup", "backspace", "delete", "end", "enter", "home"]);

export function shortcutAction(event: ShortcutEvent): ShortcutAction {
  const key = event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;

  if (["f1", "f5", "f6", "f7", "f11", "f12"].includes(key)) return "block-browser";
  if (event.altKey && !command && ["arrowleft", "arrowright", "home"].includes(key)) return "block-browser";
  if (!command) return null;

  if (key === "s") return "save";
  if (key === "w") return "close-tab";
  if (key === "f") return "search";
  if (key === "h") return "replace";

  if (!event.altKey && !event.shiftKey && EDITOR_PLAIN_KEYS.has(key)) return "allow-editor";
  if (!event.altKey && EDITOR_NAVIGATION_KEYS.has(key)) return "allow-editor";
  if (event.altKey && /^[0-6]$/.test(key)) return "allow-editor";
  if (!event.altKey && event.shiftKey && ["v", "x", "z", "7", "8", "9"].includes(key)) return "allow-editor";
  return "block-browser";
}
