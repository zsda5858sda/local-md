const INLINE_LINK = /(!?\[[^\]]*\]\()([^)>\s]+)([^)]*\))/g;

function normalize(path: string): string {
  const stack: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function dirname(path: string): string {
  const parts = normalize(path).split("/");
  parts.pop();
  return parts.join("/");
}

function relative(fromDirectory: string, to: string): string {
  const from = normalize(fromDirectory).split("/").filter(Boolean);
  const target = normalize(to).split("/").filter(Boolean);
  let common = 0;
  while (from[common] === target[common] && common < from.length && common < target.length) common += 1;
  return [...Array(from.length - common).fill(".."), ...target.slice(common)].join("/") || ".";
}

export function rewriteOutgoingLinks(markdown: string, oldDocumentPath: string, newDocumentPath: string): string {
  const oldDir = dirname(oldDocumentPath);
  const newDir = dirname(newDocumentPath);
  return markdown.replace(INLINE_LINK, (match, prefix: string, target: string, suffix: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) return match;
    const [pathname, fragment = ""] = target.split("#", 2);
    const absoluteTarget = normalize(`${oldDir}/${decodeURI(pathname)}`);
    const next = relative(newDir, absoluteTarget);
    return `${prefix}${encodeURI(next)}${fragment ? `#${fragment}` : ""}${suffix}`;
  });
}

export function rewriteIncomingLinks(markdown: string, sourceDocumentPath: string, oldTargetPath: string, newTargetPath: string): string {
  const sourceDir = dirname(sourceDocumentPath);
  return markdown.replace(INLINE_LINK, (match, prefix: string, target: string, suffix: string) => {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) return match;
    const [pathname, fragment = ""] = target.split("#", 2);
    if (normalize(`${sourceDir}/${decodeURI(pathname)}`) !== normalize(oldTargetPath)) return match;
    const next = relative(sourceDir, newTargetPath);
    return `${prefix}${encodeURI(next)}${fragment ? `#${fragment}` : ""}${suffix}`;
  });
}

