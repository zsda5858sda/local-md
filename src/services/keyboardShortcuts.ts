export type ShortcutAction = "save" | "close-tab" | "search" | "replace" | "allow-editor" | "block-browser" | null;

type ShortcutEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
type MappedShortcutAction = Exclude<ShortcutAction, null>;

function shortcutKey(key: string, command = false, alt = false, shift = false): string {
  return `${command ? "cmd" : "plain"}:${alt ? "alt" : "no-alt"}:${shift ? "shift" : "no-shift"}:${key.toLowerCase()}`;
}

function modifierVariants(key: string, action: MappedShortcutAction): Array<[string, MappedShortcutAction]> {
  return [false, true].flatMap((command) => [false, true].flatMap((alt) => [false, true].map((shift): [string, MappedShortcutAction] => (
    [shortcutKey(key, command, alt, shift), action]
  ))));
}

const SHORTCUTS = new Map<string, MappedShortcutAction>([
  [shortcutKey("s", true), "save"],
  [shortcutKey("w", true), "close-tab"],
  [shortcutKey("f", true), "search"],
  [shortcutKey("h", true), "replace"],
  ...["a", "b", "c", "i", "k", "u", "v", "x", "y", "z"].map((key): [string, MappedShortcutAction] => [shortcutKey(key, true), "allow-editor"]),
  ...["arrowdown", "arrowleft", "arrowright", "arrowup", "backspace", "delete", "end", "enter", "home"].flatMap((key) => (
    [false, true].map((shift): [string, MappedShortcutAction] => [shortcutKey(key, true, false, shift), "allow-editor"])
  )),
  ...["0", "1", "2", "3", "4", "5", "6"].flatMap((key) => (
    [false, true].map((shift): [string, MappedShortcutAction] => [shortcutKey(key, true, true, shift), "allow-editor"])
  )),
  ...["v", "x", "z", "7", "8", "9"].map((key): [string, MappedShortcutAction] => [shortcutKey(key, true, false, true), "allow-editor"]),
  ...["f1", "f5", "f6", "f7", "f11", "f12"].flatMap((key) => modifierVariants(key, "block-browser")),
  ...["arrowleft", "arrowright", "home"].flatMap((key) => (
    [false, true].map((shift): [string, MappedShortcutAction] => [shortcutKey(key, false, true, shift), "block-browser"])
  )),
]);

export function shortcutAction(event: ShortcutEvent): ShortcutAction {
  const command = event.ctrlKey || event.metaKey;
  const action = SHORTCUTS.get(shortcutKey(event.key, command, event.altKey, event.shiftKey));
  if (action) return action;
  return command ? "block-browser" : null;
}
