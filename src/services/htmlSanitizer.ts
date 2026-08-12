import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "i", "img", "li", "ol", "p", "pre", "s", "strike", "strong", "table", "tbody", "td",
  "th", "thead", "tr", "u", "ul",
];

const ALLOWED_ATTR = ["alt", "colspan", "href", "rowspan", "src", "start", "title"];

type AttributeHookData = {
  attrName: string;
  attrValue: string;
  keepAttr: boolean;
};

const rejectDataUri = (_node: Element, data: AttributeHookData): void => {
  if ((data.attrName === "href" || data.attrName === "src") && /^\s*data:/i.test(data.attrValue)) {
    data.keepAttr = false;
  }
};

export function sanitizeHtml(html: string): string {
  DOMPurify.addHook("uponSanitizeAttribute", rejectDataUri);
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute", rejectDataUri);
  }
}

export function containsUnsafeHtml(html: string): boolean {
  return sanitizeHtml(html) !== html;
}
