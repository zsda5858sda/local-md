const INVALID_NAME = /[\\/:*?"<>|]/;

export function validateEntryName(raw: string): string | null {
  if (INVALID_NAME.test(raw)) {
    return '名稱不能包含 / \\ : * ? " < > | 等字元';
  }
  return null;
}
