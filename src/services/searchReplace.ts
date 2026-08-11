export function searchPattern(query: string, useRegex: boolean, global = true): RegExp {
  if (!query) throw new Error("搜尋文字不可為空白");
  const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(source, `${global ? "g" : ""}${useRegex ? "mu" : "iu"}`);
}

export function replaceMatches(source: string, query: string, replacement: string, useRegex: boolean): { content: string; count: number } {
  const pattern = searchPattern(query, useRegex, true);
  const count = [...source.matchAll(pattern)].length;
  return { content: count ? source.replace(pattern, replacement) : source, count };
}
