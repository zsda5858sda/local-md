import type { TiptapNode } from "../domain/types";

export interface TextStats {
  words: number;
  characters: number;
}

function documentText(node: TiptapNode): string {
  const ownText = node.text ?? "";
  const children = node.content?.map(documentText).join("\n") ?? "";
  return ownText && children ? `${ownText}\n${children}` : ownText || children;
}

export function calculateTextStats(doc: TiptapNode): TextStats {
  const text = documentText(doc);
  const characters = Array.from(text.replace(/\s/gu, "")).length;
  const words = text.match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  return { words, characters };
}
