import type { OpenDocument } from "../domain/types";

export type ConflictClassification = "already-saved" | "stale-hash" | "external-change";

export function classifySaveConflict(lastKnownContent: string, pendingContent: string, diskContent: string): ConflictClassification {
  if (diskContent === pendingContent) return "already-saved";
  if (diskContent === lastKnownContent) return "stale-hash";
  return "external-change";
}

export function applySaveSuccess(
  document: OpenDocument,
  savedRevision: number,
  savedContent: string,
  result: { hash: string; saveGeneration: number },
): OpenDocument {
  const isLatestRevision = document.revision === savedRevision;
  return {
    ...document,
    content: savedContent,
    hash: result.hash,
    saveGeneration: result.saveGeneration,
    dirty: isLatestRevision ? false : document.dirty,
    saving: false,
    conflict: undefined,
    parsed: isLatestRevision ? { ...document.parsed, source: savedContent } : document.parsed,
  };
}
