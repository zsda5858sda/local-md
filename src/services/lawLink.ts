export const LAW_LINK_TITLE_PREFIX = "local-md-law:";

export function lawLinkTitleFromText(value: string): string {
  return `${LAW_LINK_TITLE_PREFIX}${encodeURIComponent(value)}`;
}

export function lawTextFromLinkTitle(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(LAW_LINK_TITLE_PREFIX)) return null;
  try {
    return decodeURIComponent(value.slice(LAW_LINK_TITLE_PREFIX.length));
  } catch {
    return null;
  }
}
