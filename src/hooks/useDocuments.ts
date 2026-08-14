import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Dispatch, RefObject } from "react";
import type { DiskDocument, OpenDocument, TiptapNode } from "../domain/types";
import { parseMarkdown, serializeMarkdown } from "../markdown/pipeline";
import { applySaveSuccess, classifySaveConflict } from "../services/saveState";
import { errorMessage, isSaveError, readDocument, saveDocument } from "../services/desktop";
import type { WorkspaceSearchIndex } from "../services/searchIndex";
import { t } from "../i18n";

export function leafName(path: string): string {
  return path.replace(/\\/g, "/").split("/").at(-1) ?? path;
}

export function openDocument(disk: DiskDocument): OpenDocument {
  return { ...disk, id: disk.path, title: leafName(disk.relativePath), parsed: parseMarkdown(disk.content), dirty: false, saving: false, saveGeneration: 0, revision: 0, editorVersion: 0 };
}

export function documentSaveContent(document: OpenDocument): string {
  return document.parsed.mode === "compatibility"
    ? document.parsed.source.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n")
    : serializeMarkdown(document.parsed.doc, document.parsed.frontMatter);
}

export type DocAction =
  | { type: "SET_DOCUMENTS"; documents: OpenDocument[] }
  | { type: "UPDATE_DOCUMENTS"; update: (documents: OpenDocument[]) => OpenDocument[] }
  | { type: "SAVE_STARTED"; id: string }
  | { type: "SAVE_SUCCESS"; id: string; result: { revision: number; content: string; hash: string; saveGeneration: number; profile?: DiskDocument["profile"]; size?: number; refreshParsed?: boolean } }
  | { type: "SAVE_CONFLICT"; id: string; disk: DiskDocument }
  | { type: "EXTERNAL_CHANGE"; id: string; disk: DiskDocument }
  | { type: "RELOAD_FROM_DISK"; id: string; disk: DiskDocument }
  | { type: "EXTERNAL_DELETE"; id: string };

export function documentReducer(documents: OpenDocument[], action: DocAction): OpenDocument[] {
  if (action.type === "SET_DOCUMENTS") return action.documents;
  if (action.type === "UPDATE_DOCUMENTS") return action.update(documents);
  return documents.map((document) => {
    if (document.id !== action.id) return document;
    if (action.type === "SAVE_STARTED") return { ...document, saving: true };
    if (action.type === "SAVE_SUCCESS") {
      const saved = applySaveSuccess(document, action.result.revision, action.result.content, action.result);
      return {
        ...saved,
        ...(action.result.profile ? { profile: action.result.profile } : {}),
        ...(typeof action.result.size === "number" ? { size: action.result.size } : {}),
        ...(action.result.refreshParsed ? { parsed: parseMarkdown(action.result.content), editorVersion: document.editorVersion + 1 } : {}),
      };
    }
    if (action.type === "RELOAD_FROM_DISK") {
      return { ...document, ...action.disk, parsed: parseMarkdown(action.disk.content), dirty: false, saving: false, conflict: undefined, revision: document.revision + 1, editorVersion: document.editorVersion + 1 };
    }
    if (action.type === "EXTERNAL_DELETE") return { ...document, saving: false, conflict: { diskHash: "deleted", diskContent: "" } };
    if (action.type === "SAVE_CONFLICT") {
      return { ...document, saving: false, conflict: { diskHash: action.disk.hash, diskContent: action.disk.content } };
    }
    const disk = action.disk;
    if (document.hash === disk.hash || document.saving) return document;
    if (action.type === "EXTERNAL_CHANGE" && !document.dirty) {
      return { ...document, ...disk, parsed: parseMarkdown(disk.content), conflict: undefined, revision: document.revision + 1, editorVersion: document.editorVersion + 1 };
    }
    const pendingContent = documentSaveContent(document);
    const classification = classifySaveConflict(document.content, pendingContent, disk.content);
    if (classification === "already-saved") {
      return { ...applySaveSuccess(document, document.revision, pendingContent, { hash: disk.hash, saveGeneration: document.saveGeneration + 1 }), profile: disk.profile, size: disk.size };
    }
    if (classification === "stale-hash") return { ...document, hash: disk.hash, profile: disk.profile, size: disk.size, saving: false, conflict: undefined };
    return { ...document, saving: false, conflict: { diskHash: disk.hash, diskContent: disk.content } };
  });
}

export function useDocuments() {
  const [documents, reducerDispatch] = useReducer(documentReducer, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const documentsRef = useRef(documents);
  const activeIdRef = useRef(activeId);
  const saveTimers = useRef(new Map<string, number>());
  const savingIds = useRef(new Set<string>());

  useEffect(() => { documentsRef.current = documents; }, [documents]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const dispatch = useCallback((action: DocAction) => {
    documentsRef.current = documentReducer(documentsRef.current, action);
    reducerDispatch(action);
  }, []);

  const updateDocuments = useCallback((update: OpenDocument[] | ((documents: OpenDocument[]) => OpenDocument[])) => {
    dispatch(typeof update === "function" ? { type: "UPDATE_DOCUMENTS", update } : { type: "SET_DOCUMENTS", documents: update });
  }, []);

  const selectDocument = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const activeDocument = documents.find((document) => document.id === activeId);

  const closeTab = useCallback(async (id: string) => {
    const current = documentsRef.current;
    const index = current.findIndex((item) => item.id === id);
    const document = current[index];
    if ((document?.dirty || document?.saving) && !window.confirm(t("documents.closeUnsaved", { title: document.title }))) return;
    const timer = saveTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    saveTimers.current.delete(id);
    const remaining = current.filter((item) => item.id !== id);
    updateDocuments(remaining);
    if (activeIdRef.current === id) selectDocument(remaining[index]?.id ?? remaining[index - 1]?.id ?? null);
  }, [selectDocument, updateDocuments]);

  const closeTabs = useCallback((ids: string[]): boolean => {
    const targets = new Set(ids);
    if (!targets.size) return true;
    const current = documentsRef.current;
    const affected = current.filter((document) => targets.has(document.id));
    const unsavedCount = affected.filter((document) => document.dirty || document.saving).length;
    if (unsavedCount > 0 && !window.confirm(t("documents.closeManyUnsaved", { count: unsavedCount }))) return false;
    affected.forEach((document) => {
      const timer = saveTimers.current.get(document.id);
      if (timer) window.clearTimeout(timer);
      saveTimers.current.delete(document.id);
    });
    const remaining = current.filter((document) => !targets.has(document.id));
    updateDocuments(remaining);
    if (activeIdRef.current && targets.has(activeIdRef.current)) selectDocument(remaining.at(-1)?.id ?? null);
    return true;
  }, [selectDocument, updateDocuments]);

  return {
    documents, documentsRef, activeId, activeIdRef, activeDocument, dispatch, updateDocuments,
    selectDocument, closeTab, closeTabs, saveTimers, savingIds,
  };
}

export function changedVisualDocument(document: OpenDocument, doc: TiptapNode): OpenDocument {
  return { ...document, parsed: { ...document.parsed, doc } };
}

interface PersistenceOptions {
  workspaceRoot: string | null;
  autoSaveEnabled: boolean;
  autoSaveDebounceMs: number;
  documentsRef: RefObject<OpenDocument[]>;
  dispatch: Dispatch<DocAction>;
  saveTimers: RefObject<Map<string, number>>;
  savingIds: RefObject<Set<string>>;
  searchIndex: RefObject<WorkspaceSearchIndex>;
  refreshSearchResults: () => void;
  setToast: (message: string) => void;
  setFatalError: (message: string | null) => void;
}

export function useDocumentPersistence(options: PersistenceOptions) {
  const optionsRef = useRef(options);
  const persistRef = useRef<(id: string, force?: boolean) => Promise<void>>(async () => undefined);
  useEffect(() => { optionsRef.current = options; }, [options]);

  const scheduleSave = useCallback((id: string) => {
    const currentOptions = optionsRef.current;
    if (!currentOptions.autoSaveEnabled) return;
    const previous = currentOptions.saveTimers.current.get(id);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      currentOptions.saveTimers.current.delete(id);
      void persistRef.current(id);
    }, currentOptions.autoSaveDebounceMs);
    currentOptions.saveTimers.current.set(id, timer);
  }, []);

  const persist = useCallback(async (id: string, force = false) => {
    const currentOptions = optionsRef.current;
    const root = currentOptions.workspaceRoot;
    const document = currentOptions.documentsRef.current.find((item) => item.id === id);
    if (!root || !document || (!document.dirty && !force) || currentOptions.savingIds.current.has(id)) return;
    const pendingTimer = currentOptions.saveTimers.current.get(id);
    if (pendingTimer) window.clearTimeout(pendingTimer);
    currentOptions.saveTimers.current.delete(id);
    const revision = document.revision;
    const content = documentSaveContent(document);
    currentOptions.savingIds.current.add(id);
    currentOptions.dispatch({ type: "SAVE_STARTED", id });
    let succeeded = false;
    try {
      const result = await saveDocument({ root, relativePath: document.relativePath, content, expectedHash: document.hash, profile: document.profile, force, saveGeneration: document.saveGeneration });
      succeeded = true;
      currentOptions.dispatch({ type: "SAVE_SUCCESS", id, result: { revision, content, ...result } });
      currentOptions.searchIndex.current.update(document.path, document.relativePath, content);
      currentOptions.refreshSearchResults();
      currentOptions.setToast(t("documents.saved"));
    } catch (error) {
      if (isSaveError(error) && error.kind === "Conflict") {
        try {
          const disk = await readDocument(root, document.relativePath);
          const classification = classifySaveConflict(document.content, content, disk.content);
          currentOptions.dispatch({ type: "SAVE_CONFLICT", id, disk });
          succeeded = classification !== "external-change";
          if (classification === "already-saved") currentOptions.searchIndex.current.update(document.path, document.relativePath, content);
        } catch {
          currentOptions.dispatch({ type: "EXTERNAL_DELETE", id });
        }
        currentOptions.setFatalError(null);
      } else {
        currentOptions.dispatch({ type: "UPDATE_DOCUMENTS", update: (documents) => documents.map((item) => item.id === id ? { ...item, saving: false } : item) });
        currentOptions.setFatalError(errorMessage(error));
      }
    } finally {
      currentOptions.savingIds.current.delete(id);
      if (succeeded) {
        const latestOptions = optionsRef.current;
        const latest = latestOptions.documentsRef.current.find((item) => item.id === id);
        if (latest?.dirty && !latest.conflict) scheduleSave(id);
      }
    }
  }, [scheduleSave]);

  persistRef.current = persist;

  useEffect(() => {
    if (!options.autoSaveEnabled) {
      options.saveTimers.current.forEach((timer) => window.clearTimeout(timer));
      options.saveTimers.current.clear();
      return;
    }
    options.documentsRef.current.filter((document) => document.dirty && !document.saving && !document.conflict).forEach((document) => scheduleSave(document.id));
  }, [options.autoSaveEnabled, options.documentsRef, options.saveTimers, scheduleSave]);

  return { persist, scheduleSave };
}
