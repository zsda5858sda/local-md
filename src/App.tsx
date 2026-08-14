import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle, BookOpen, Braces, Check, ChevronDown, ChevronRight, FileText, Menu,
  MoreHorizontal, PanelRightOpen, Save, Settings, Trash2, Unlink, X,
} from "lucide-react";
import type { FrontMatterState, OpenDocument, SearchHit, TiptapNode, WorkspaceEntry } from "./domain/types";
import { parseMarkdown } from "./markdown/pipeline";
import {
  chooseWorkspace, createEntry, deleteEntry, errorMessage, exportWorkspace, importFolder, isTauri,
  readDocument, readWorkspaceSettings, renameEntry, saveDocument, scanOrphanAssets,
  scanWorkspace,
} from "./services/desktop";
import { validateEntryName } from "./services/entryName";
import { rewriteIncomingLinks, rewriteOutgoingLinks } from "./services/linkRewrite";
import { reorderById } from "./services/tabOrder";
import { replaceMatches, searchPattern } from "./services/searchReplace";
import { shortcutAction } from "./services/keyboardShortcuts";
import { clampPanelWidth, PANEL_LIMITS, type PanelName } from "./services/panelLimits";
import { EditorPane } from "./components/EditorPane";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Sidebar, type SearchProps } from "./components/Sidebar";
import { documentSaveContent, leafName, openDocument, useDocumentPersistence, useDocuments } from "./hooks/useDocuments";
import { useSaveConflict } from "./hooks/useSaveConflict";
import { useWorkspace, useWorkspaceWatcher } from "./hooks/useWorkspace";
import { useWorkspaceSearch } from "./hooks/useWorkspaceSearch";
import { TAB_GROUP_COLORS, useTabGroups, type TabDropTarget } from "./hooks/useTabGroups";
import { t } from "./i18n";

function flattenFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.flatMap((entry) => entry.kind === "file" ? [entry] : flattenFiles(entry.children ?? []));
}

function parentPath(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function isWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

type EntryDialog = {
  mode: "create-file" | "create-directory" | "rename";
  value: string;
  entry?: WorkspaceEntry;
};

export default function App() {
  const {
    documents, documentsRef, activeId, activeIdRef, activeDocument, dispatch, updateDocuments,
    selectDocument, closeTab, closeTabs, saveTimers, savingIds,
  } = useDocuments();
  const {
    workspaceRoot, setWorkspaceRoot, settings, setSettings, setSettingsReadOnly,
    settingsWarning, setSettingsWarning, setSessionReady, tree, setTree,
    selectedFolder, setSelectedFolder, workspaceError, refreshTree, withWorkspace,
  } = useWorkspace(documentsRef, activeIdRef);
  const saveConflict = useSaveConflict(dispatch);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const {
    searchQuery, setSearchQuery, replacementText, setReplacementText, searchScope,
    searchRegex, searchError, setSearchError, searchHits, setSearchHits,
    searchTarget, setSearchTarget, searchShortcut, setSearchShortcut,
    searchQueryRef,
    searchIndex, indexGeneration, refreshSearchResults, indexWorkspace,
    handleSearch, handleSearchScopeChange, handleSearchRegexChange,
  } = useWorkspaceSearch(documentsRef, activeIdRef);
  useWorkspaceWatcher({
    workspaceRoot, refreshTree, documentsRef, savingIds, searchIndex, searchQueryRef,
    dispatch, externalChange: saveConflict.externalChange, refreshSearchResults,
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [entryDialog, setEntryDialog] = useState<EntryDialog | null>(null);
  const { persist, scheduleSave } = useDocumentPersistence({
    workspaceRoot,
    autoSaveEnabled: settings.settings.autoSaveEnabled,
    autoSaveDebounceMs: settings.settings.autoSaveDebounceMs,
    documentsRef,
    dispatch,
    saveTimers,
    savingIds,
    searchIndex,
    refreshSearchResults,
    setToast,
    setFatalError,
  });
  const {
    draggedTabId, setDraggedTabId, tabDropTarget, setTabDropTarget, groupMenu, setGroupMenu,
    setTabGroup, toggleTabGroup, addTabGroup, removeTabGroup, commitTabGroupName, setTabGroupColor,
    ungroupedDocuments,
  } = useTabGroups(documents, settings, setSettings);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const entryNameInputRef = useRef<HTMLInputElement>(null);
  const tabDropTargetRef = useRef<TabDropTarget>(null);
  const tabPointerDragRef = useRef<{ sourceId: string; startX: number; startY: number; dragging: boolean } | null>(null);
  const suppressTabClickRef = useRef(false);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!toolsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!toolsMenuRef.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [toolsOpen]);
  useEffect(() => {
    if (!groupMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!groupMenuRef.current?.contains(event.target as Node)) setGroupMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [groupMenu]);
  useEffect(() => {
    const preventWebContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", preventWebContextMenu);
    return () => window.removeEventListener("contextmenu", preventWebContextMenu);
  }, []);
  useEffect(() => {
    if (!entryDialog) return;
    const frame = window.requestAnimationFrame(() => {
      const input = entryNameInputRef.current;
      if (!input) return;
      input.focus();
      const extensionIndex = entryDialog.mode === "rename" && entryDialog.entry?.kind === "file"
        ? entryDialog.value.search(/\.(?:md|markdown)$/i)
        : -1;
      input.setSelectionRange(0, extensionIndex > 0 ? extensionIndex : entryDialog.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [entryDialog?.entry?.relativePath, entryDialog?.mode]);

  useEffect(() => { if (workspaceError) setFatalError(workspaceError); }, [workspaceError]);

  useEffect(() => { refreshSearchResults(searchQuery, searchRegex, searchScope); }, [activeId, refreshSearchResults, searchQuery, searchRegex, searchScope]);

  const openWorkspace = useCallback(async () => {
    if (documentsRef.current.some((doc) => doc.dirty || doc.saving) && !window.confirm(t("app.switchWorkspaceConfirm"))) return;
    setLoading(true);
    setFatalError(null);
    setSessionReady(false);
    try {
      const root = await chooseWorkspace();
      if (!root) return;
      const [entries, settingsResult] = await Promise.all([scanWorkspace(root), readWorkspaceSettings(root)]);
      const files = flattenFiles(entries);
      const available = new Set(files.map((entry) => entry.relativePath));
      const requested = settingsResult.settings.ui.openTabs.filter((path) => available.has(path)).slice(0, 20);
      const fallback = settingsResult.settings.ui.lastOpenedFile && available.has(settingsResult.settings.ui.lastOpenedFile)
        ? settingsResult.settings.ui.lastOpenedFile
        : files[0]?.relativePath;
      const paths = requested.length ? requested : fallback ? [fallback] : [];
      const restored = await Promise.all(paths.map(async (path) => openDocument(await readDocument(root, path))));
      const activePath = settingsResult.settings.ui.lastOpenedFile && paths.includes(settingsResult.settings.ui.lastOpenedFile)
        ? settingsResult.settings.ui.lastOpenedFile
        : restored.at(-1)?.relativePath;
      const active = restored.find((doc) => doc.relativePath === activePath) ?? restored.at(-1);

      indexGeneration.current += 1;
      saveTimers.current.forEach((timer) => window.clearTimeout(timer));
      saveTimers.current.clear();
      setWorkspaceRoot(root);
      setTree(entries);
      setSettings(settingsResult.settings);
      setSettingsReadOnly(settingsResult.readOnly);
      setSettingsWarning(settingsResult.warning);
      updateDocuments(restored);
      selectDocument(active?.id ?? null);
      setSelectedFolder(active ? parentPath(active.relativePath) : "");
      setSearchQuery("");
      setSearchHits([]);
      setSearchTarget(null);
      setSessionReady(true);
      void indexWorkspace(root, entries);
    } catch (error) {
      setFatalError(errorMessage(error));
    } finally { setLoading(false); }
  }, [indexWorkspace, selectDocument, updateDocuments]);

  const openFile = useMemo(() => withWorkspace(async (root, entry: WorkspaceEntry, keepSearchTarget = false) => {
    if (entry.kind !== "file") return;
    const existing = documentsRef.current.find((doc) => doc.relativePath === entry.relativePath);
    if (existing) selectDocument(existing.id);
    else {
      setLoading(true);
      try {
        const disk = await readDocument(root, entry.relativePath);
        const next = openDocument(disk);
        updateDocuments((current) => [...current, next]);
        selectDocument(next.id);
        searchIndex.current.update(disk.path, disk.relativePath, disk.content);
      } catch (error) { setFatalError(errorMessage(error)); }
      finally { setLoading(false); }
    }
    const assignedGroup = settings.ui.tabAssignments[entry.relativePath];
    if (assignedGroup) setSettings((current) => ({ ...current, ui: { ...current.ui, tabGroups: current.ui.tabGroups.map((group) => group.id === assignedGroup ? { ...group, collapsed: false } : group) } }));
    setSelectedFolder(parentPath(entry.relativePath));
    if (!keepSearchTarget) setSearchTarget(null);
    if (window.innerWidth <= 850) setSidebarOpen(false);
  }), [selectDocument, settings.ui.tabAssignments, updateDocuments, withWorkspace]);

  const markChanged = (id: string, update: (item: OpenDocument) => OpenDocument) => {
    const current = documentsRef.current.find((item) => item.id === id);
    if (!current) return;
    const changed = { ...update(current), dirty: true, revision: current.revision + 1 };
    updateDocuments((documentsNow) => documentsNow.map((item) => item.id === id ? changed : item));
    searchIndex.current.update(changed.path, changed.relativePath, documentSaveContent(changed));
    if (searchQueryRef.current) refreshSearchResults();
    scheduleSave(id);
  };

  const updateVisualDocument = (doc: TiptapNode) => {
    if (activeId) markChanged(activeId, (item) => ({ ...item, parsed: { ...item.parsed, doc } }));
  };
  const updateSourceDocument = (source: string) => {
    if (activeId) markChanged(activeId, (item) => ({ ...item, parsed: { ...item.parsed, source } }));
  };
  const updateFrontMatter = (frontMatter: FrontMatterState) => {
    if (activeId) markChanged(activeId, (item) => ({ ...item, parsed: { ...item.parsed, frontMatter } }));
  };

  const reloadFromDisk = withWorkspace(async (root, id: string) => {
    const doc = documentsRef.current.find((item) => item.id === id);
    if (!doc) return;
    try {
      const disk = await readDocument(root, doc.relativePath);
      saveConflict.reloadFromDisk(id, disk);
      searchIndex.current.update(disk.path, disk.relativePath, disk.content);
      setToast(t("app.diskReloaded"));
    } catch (error) { setFatalError(errorMessage(error)); }
  });

  const submitEntryDialog = withWorkspace(async (root) => {
    if (!entryDialog) return;
    const raw = entryDialog.value.trim();
    if (!raw) return;
    const validationError = validateEntryName(raw);
    if (validationError) {
      setFatalError(validationError);
      return;
    }
    setEntryDialog(null);
    if (entryDialog.mode !== "rename") {
      const kind = entryDialog.mode === "create-file" ? "file" : "directory";
      const name = kind === "file" && !/\.(?:md|markdown)$/i.test(raw) ? `${raw}.md` : raw;
      const relativePath = [selectedFolder, name].filter(Boolean).join("/");
      try {
        await createEntry(root, relativePath, kind);
        const entries = await refreshTree();
        if (kind === "file") {
          const entry = flattenFiles(entries).find((item) => item.relativePath === relativePath);
          if (entry) await openFile(entry);
        } else {
          setSelectedFolder(relativePath);
          setSettings((current) => ({ ...current, ui: { ...current.ui, expandedFolders: [...new Set([...current.ui.expandedFolders, relativePath])] } }));
        }
        setToast(t("app.created"));
      } catch (error) { setFatalError(errorMessage(error)); }
      return;
    }

    const entry = entryDialog.entry;
    if (!entry || raw === entry.name) return;
    if (documentsRef.current.some((doc) => doc.dirty || doc.saving || doc.conflict)) {
      setFatalError(t("app.renameBlocked"));
      return;
    }
    const targetName = entry.kind === "file" && !/\.(?:md|markdown)$/i.test(raw) ? `${raw}.md` : raw;
    const target = [parentPath(entry.relativePath), targetName].filter(Boolean).join("/");
    const movedPairs = flattenFiles(tree).filter((file) => isWithin(file.relativePath, entry.relativePath)).map((file) => ({
      oldPath: file.relativePath,
      newPath: `${target}${file.relativePath.slice(entry.relativePath.length)}`,
    }));
    try {
      await renameEntry(root, entry.relativePath, target);
      const entries = await scanWorkspace(root);
      for (const file of flattenFiles(entries)) {
        const disk = await readDocument(root, file.relativePath);
        const moved = movedPairs.find((pair) => pair.newPath === file.relativePath);
        let content = moved ? rewriteOutgoingLinks(disk.content, moved.oldPath, moved.newPath) : disk.content;
        for (const pair of movedPairs) content = rewriteIncomingLinks(content, file.relativePath, pair.oldPath, pair.newPath);
        if (content !== disk.content) await saveDocument({ root, relativePath: file.relativePath, content, expectedHash: disk.hash, profile: disk.profile, saveGeneration: 0 });
      }
      const current = documentsRef.current;
      const refreshed = await Promise.all(current.map(async (doc) => {
        const pair = movedPairs.find((item) => item.oldPath === doc.relativePath);
        return openDocument(await readDocument(root, pair?.newPath ?? doc.relativePath));
      }));
      const oldActive = current.find((doc) => doc.id === activeIdRef.current)?.relativePath;
      const newActivePath = movedPairs.find((pair) => pair.oldPath === oldActive)?.newPath ?? oldActive;
      setTree(entries);
      updateDocuments(refreshed);
      selectDocument(refreshed.find((doc) => doc.relativePath === newActivePath)?.id ?? refreshed.at(-1)?.id ?? null);
      setSelectedFolder(entry.kind === "directory" ? target : parentPath(target));
      setSettings((currentSettings) => ({
        ...currentSettings,
        ui: {
          ...currentSettings.ui,
          expandedFolders: currentSettings.ui.expandedFolders.map((path) => isWithin(path, entry.relativePath) ? `${target}${path.slice(entry.relativePath.length)}` : path),
          tabAssignments: Object.fromEntries(Object.entries(currentSettings.ui.tabAssignments).map(([path, groupId]) => {
            const pair = movedPairs.find((item) => item.oldPath === path);
            return [pair?.newPath ?? path, groupId];
          })),
        },
      }));
      void indexWorkspace(root, entries);
      setToast(t("app.renamed"));
    } catch (error) { setFatalError(errorMessage(error)); }
  });

  const handleDelete = withWorkspace(async (root, entry: WorkspaceEntry) => {
    const affected = documentsRef.current.filter((doc) => isWithin(doc.relativePath, entry.relativePath));
    const details = entry.kind === "directory"
      ? t("app.deleteFolderDetails")
      : t("app.deleteFileDetails");
    const unsaved = affected.some((doc) => doc.dirty || doc.saving) ? t("app.deleteUnsaved") : "";
    if (!window.confirm(t("app.deleteConfirm", { path: entry.relativePath, details, unsaved }))) return;
    try {
      await deleteEntry(root, entry.relativePath);
      affected.forEach((doc) => {
        const timer = saveTimers.current.get(doc.id);
        if (timer) window.clearTimeout(timer);
        saveTimers.current.delete(doc.id);
        searchIndex.current.remove(doc.path);
      });
      const remaining = documentsRef.current.filter((doc) => !isWithin(doc.relativePath, entry.relativePath));
      updateDocuments(remaining);
      setSettings((current) => ({ ...current, ui: { ...current.ui, tabAssignments: Object.fromEntries(Object.entries(current.ui.tabAssignments).filter(([path]) => !isWithin(path, entry.relativePath))) } }));
      if (!remaining.some((doc) => doc.id === activeIdRef.current)) selectDocument(remaining.at(-1)?.id ?? null);
      await refreshTree();
      setToast(t("app.trashed"));
    } catch (error) { setFatalError(errorMessage(error)); }
  });

  const handleReplaceAll = withWorkspace(async (root) => {
    if (!searchQuery.trim()) return;
    try { searchPattern(searchQuery, searchRegex, true); }
    catch (error) { setSearchError(errorMessage(error)); return; }

    if (searchScope === "document") {
      const doc = documentsRef.current.find((item) => item.id === activeIdRef.current);
      if (!doc) { setSearchError(t("app.noOpenDocument")); return; }
      const source = documentSaveContent(doc);
      const result = replaceMatches(source, searchQuery, replacementText, searchRegex);
      if (!result.count) { setToast(t("app.noDocumentReplacements")); return; }
      updateDocuments((current) => current.map((item) => item.id === doc.id ? { ...item, parsed: parseMarkdown(result.content), dirty: true, revision: item.revision + 1, editorVersion: item.editorVersion + 1 } : item));
      searchIndex.current.update(doc.path, doc.relativePath, result.content);
      scheduleSave(doc.id);
      refreshSearchResults();
      setToast(t("app.documentReplaced", { count: result.count }));
      return;
    }

    if (documentsRef.current.some((doc) => doc.dirty || doc.saving || doc.conflict)) {
      setFatalError(t("app.workspaceReplaceBlocked"));
      return;
    }
    setLoading(true);
    try {
      const changes: Array<{ disk: Awaited<ReturnType<typeof readDocument>>; content: string; count: number }> = [];
      for (const file of flattenFiles(tree)) {
        const disk = await readDocument(root, file.relativePath);
        const result = replaceMatches(disk.content, searchQuery, replacementText, searchRegex);
        if (result.count) changes.push({ disk, content: result.content, count: result.count });
      }
      const total = changes.reduce((sum, change) => sum + change.count, 0);
      if (!total) { setToast(t("app.noWorkspaceReplacements")); return; }
      if (!window.confirm(t("app.workspaceReplaceConfirm", { files: changes.length, count: total }))) return;
      for (const change of changes) {
        const saved = await saveDocument({ root, relativePath: change.disk.relativePath, content: change.content, expectedHash: change.disk.hash, profile: change.disk.profile, saveGeneration: 0 });
        searchIndex.current.update(change.disk.path, change.disk.relativePath, change.content);
        const open = documentsRef.current.find((doc) => doc.relativePath === change.disk.relativePath);
        if (open) dispatch({
          type: "SAVE_SUCCESS",
          id: open.id,
          result: { revision: open.revision, content: change.content, hash: saved.hash, saveGeneration: saved.saveGeneration, profile: change.disk.profile, refreshParsed: true },
        });
      }
      refreshSearchResults();
      setToast(t("app.workspaceReplaced", { files: changes.length, count: total }));
    } catch (error) { setFatalError(errorMessage(error)); }
    finally { setLoading(false); }
  });

  const handleSearchHit = async (hit: SearchHit) => {
    setSearchTarget({ path: hit.relativePath, text: hit.rawLineText, nonce: Date.now() });
    await openFile({ name: leafName(hit.relativePath), path: hit.filePath, relativePath: hit.relativePath, kind: "file", size: 0, modifiedAt: 0 }, true);
  };

  const handleImport = withWorkspace(async (root) => {
    setToolsOpen(false);
    setLoading(true);
    try {
      const report = await importFolder(root);
      if (!report) return;
      const entries = await refreshTree();
      void indexWorkspace(root, entries);
      setToast(t("app.importDone", { succeeded: report.succeeded, failed: report.failed }));
      if (report.failed > 0) setFatalError(report.files.filter((file) => file.status === "failed").slice(0, 8).map((file) => `${file.relativePath}: ${file.error}`).join("\n"));
    } catch (error) { setFatalError(errorMessage(error)); }
    finally { setLoading(false); }
  });

  const handleExport = withWorkspace(async (root) => {
    setToolsOpen(false);
    setLoading(true);
    try {
      const completed = await exportWorkspace(root, settings.workspaceName);
      if (completed) setToast(t("app.exportDone"));
    } catch (error) { setFatalError(errorMessage(error)); }
    finally { setLoading(false); }
  });

  const handleOrphanScan = withWorkspace(async (root) => {
    setToolsOpen(false);
    try {
      const orphaned = await scanOrphanAssets(root);
      setToast(orphaned.length ? t("app.orphansFound", { count: orphaned.length }) : t("app.noOrphans"));
      if (orphaned.length) setFatalError(t("app.orphansList", { items: orphaned.slice(0, 20).join("\n") }));
    } catch (error) { setFatalError(errorMessage(error)); }
  });

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const action = shortcutAction(event);
      if (action === "block-browser") event.preventDefault();
      if (action === "save") { event.preventDefault(); if (activeIdRef.current) void persist(activeIdRef.current); }
      if (action === "close-tab") { event.preventDefault(); if (activeIdRef.current) void closeTab(activeIdRef.current); }
      if (action === "search" || action === "replace") {
        event.preventDefault();
        setSidebarOpen(true);
        setSearchShortcut({ mode: action, nonce: Date.now() });
      }
      if (event.key === "Escape") { setToolsOpen(false); setEntryDialog(null); }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (documentsRef.current.some((doc) => doc.dirty || doc.saving)) event.preventDefault();
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("keydown", keydown, true); window.removeEventListener("beforeunload", beforeUnload); };
  }, [closeTab, persist]);

  const activateAdjacentTab = (id: string, direction: -1 | 1) => {
    const index = documentsRef.current.findIndex((doc) => doc.id === id);
    if (index < 0) return;
    const next = documentsRef.current[(index + direction + documentsRef.current.length) % documentsRef.current.length];
    if (next) selectDocument(next.id);
  };

  const reorderTab = (sourceId: string, targetId: string, position: "before" | "after") => {
    updateDocuments((current) => reorderById(current, sourceId, targetId, position));
  };

  const closeTabGroup = (groupId: string) => {
    const ids = documentsRef.current.filter((doc) => settings.ui.tabAssignments[doc.relativePath] === groupId).map((doc) => doc.id);
    const closed = closeTabs(ids);
    if (!closed) return;
    setGroupMenu(null);
  };

  const deleteTabGroup = (groupId: string) => {
    const ids = documentsRef.current
      .filter((doc) => settings.ui.tabAssignments[doc.relativePath] === groupId)
      .map((doc) => doc.id);
    const closed = closeTabs(ids);
    if (!closed) return;
    removeTabGroup(groupId);
    setGroupMenu(null);
  };

  const openTabGroupMenu = (groupId: string, name: string, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    setGroupMenu({ id: groupId, draftName: name, left: Math.max(8, Math.min(bounds.left, window.innerWidth - 252)), top: Math.max(8, Math.min(bounds.bottom + 5, window.innerHeight - 245)) });
  };

  const finishTabPointerDrag = () => {
    const drag = tabPointerDragRef.current;
    if (!drag) return;
    document.removeEventListener("pointermove", moveTabPointerDrag);
    document.removeEventListener("pointerup", finishTabPointerDrag);
    document.removeEventListener("pointercancel", finishTabPointerDrag);
    if (drag.dragging) {
      const source = documentsRef.current.find((doc) => doc.id === drag.sourceId);
      const target = tabDropTargetRef.current;
      if (source && target?.type === "tab") {
        const targetDocument = documentsRef.current.find((doc) => doc.id === target.id);
        if (targetDocument) setTabGroup(source.relativePath, settings.ui.tabAssignments[targetDocument.relativePath] ?? null);
        reorderTab(source.id, target.id, target.position);
      } else if (source && target?.type === "group") {
        setTabGroup(source.relativePath, target.groupId);
      }
      suppressTabClickRef.current = true;
      window.setTimeout(() => { suppressTabClickRef.current = false; }, 0);
    }
    tabPointerDragRef.current = null;
    tabDropTargetRef.current = null;
    setDraggedTabId(null);
    setTabDropTarget(null);
  };

  const moveTabPointerDrag = (event: PointerEvent) => {
    const drag = tabPointerDragRef.current;
    if (!drag) return;
    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.dragging = true;
    setDraggedTabId(drag.sourceId);
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const tab = element?.closest<HTMLElement>("[data-tab-id]");
    let target: typeof tabDropTarget = null;
    if (tab?.dataset.tabId && tab.dataset.tabId !== drag.sourceId) {
      const bounds = tab.getBoundingClientRect();
      target = { type: "tab", id: tab.dataset.tabId, position: event.clientX < bounds.left + bounds.width / 2 ? "before" : "after" };
    } else {
      const group = element?.closest<HTMLElement>("[data-tab-group]");
      if (group) target = { type: "group", groupId: group.dataset.tabGroup === "ungrouped" ? null : group.dataset.tabGroup ?? null };
    }
    tabDropTargetRef.current = target;
    setTabDropTarget(target);
  };

  const beginTabPointerDrag = (sourceId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    tabPointerDragRef.current = { sourceId, startX: event.clientX, startY: event.clientY, dragging: false };
    document.addEventListener("pointermove", moveTabPointerDrag);
    document.addEventListener("pointerup", finishTabPointerDrag, { once: true });
    document.addEventListener("pointercancel", finishTabPointerDrag, { once: true });
  };

  const setPanelWidth = (panel: PanelName, width: number) => {
    setSettings((current) => ({
      ...current,
      ui: {
        ...current.ui,
        [panel === "sidebar" ? "sidebarWidth" : "propertiesWidth"]: panel === "sidebar"
          ? clampPanelWidth("sidebar", width)
          : clampPanelWidth("properties", width),
      },
    }));
  };

  const beginPanelResize = (panel: PanelName, event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 850) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === "sidebar" ? settings.ui.sidebarWidth : settings.ui.propertiesWidth;
    const move = (pointerEvent: PointerEvent) => {
      const delta = pointerEvent.clientX - startX;
      const requested = panel === "sidebar" ? startWidth + delta : startWidth - delta;
      const occupied = panel === "sidebar"
        ? (propertiesOpen ? settings.ui.propertiesWidth : 0)
        : (sidebarOpen ? settings.ui.sidebarWidth : 0);
      const { minimum, maximum: configuredMaximum } = PANEL_LIMITS[panel];
      const maximum = Math.max(minimum, Math.min(configuredMaximum, window.innerWidth - occupied - PANEL_LIMITS.editorMinimum));
      setPanelWidth(panel, clamp(requested, minimum, maximum));
    };
    const finish = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish, { once: true });
  };

  const resizeHandleKeyDown = (panel: PanelName, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const current = panel === "sidebar" ? settings.ui.sidebarWidth : settings.ui.propertiesWidth;
    setPanelWidth(panel, current + direction * (panel === "sidebar" ? 12 : -12));
  };

  const renderTab = (doc: OpenDocument) => (
    <div
      className={`tab${doc.id === activeId ? " active" : ""}${doc.id === draggedTabId ? " dragging" : ""}${tabDropTarget?.type === "tab" && tabDropTarget.id === doc.id ? ` drop-${tabDropTarget.position}` : ""}`}
      key={doc.id}
      data-tab-id={doc.id}
    >
      <button
        role="tab"
        aria-selected={doc.id === activeId}
        className="tab-main"
        onPointerDown={(event) => beginTabPointerDrag(doc.id, event)}
        onClick={() => {
          if (suppressTabClickRef.current) return;
          selectDocument(doc.id);
          setSearchTarget(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") activateAdjacentTab(doc.id, -1);
          if (event.key === "ArrowRight") activateAdjacentTab(doc.id, 1);
          if (event.key === "Delete") void closeTab(doc.id);
        }}
      ><Braces /><span>{doc.title}</span>{doc.dirty && <i />}</button>
      <button className="tab-close" aria-label={t("tabs.closeDocument", { title: doc.title })} onClick={() => void closeTab(doc.id)}><X /></button>
    </div>
  );

  const breadcrumbs = useMemo(() => activeDocument?.relativePath.split("/") ?? [], [activeDocument?.relativePath]);
  const sidebarSearch = useMemo<SearchProps>(() => ({
    query: searchQuery,
    replacementText,
    scope: searchScope,
    regex: searchRegex,
    error: searchError,
    hits: searchHits,
    shortcut: searchShortcut,
    onQueryChange: handleSearch,
    onReplacementChange: setReplacementText,
    onScopeChange: handleSearchScopeChange,
    onRegexChange: handleSearchRegexChange,
    onReplaceAll: () => void handleReplaceAll(),
    onOpenHit: (hit) => void handleSearchHit(hit),
  }), [
    handleReplaceAll,
    handleSearch,
    handleSearchHit,
    handleSearchRegexChange,
    handleSearchScopeChange,
    replacementText,
    searchError,
    searchHits,
    searchQuery,
    searchRegex,
    searchScope,
    searchShortcut,
  ]);

  if (!workspaceRoot) {
    return (
      <main className="welcome-screen">
        <div className="welcome-card">
          <div className="brand-lockup"><div className="brand-icon"><FileText /></div><span>LOCAL MD</span></div>
          <h1>{t("welcome.titleStart")}<br /><em>{t("welcome.titleEmphasis")}</em></h1>
          <p>{t("welcome.description")}</p>
          <button className="primary-button" onClick={() => void openWorkspace()} disabled={loading}><FolderOpenIcon />{loading ? t("welcome.opening") : isTauri() ? t("welcome.openFolder") : t("welcome.openDemo")}</button>
          <div className="welcome-features"><span><Check />{t("welcome.markdownSource")}</span><span><Check />{t("welcome.safeSave")}</span><span><Check />{t("welcome.offline")}</span></div>
          {fatalError && <div className="fatal-inline"><AlertTriangle />{fatalError}</div>}
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell" style={{
      "--sidebar-min": `${PANEL_LIMITS.sidebar.minimum}px`,
      "--sidebar-max": `${PANEL_LIMITS.sidebar.maximum}px`,
      "--sidebar-default": `${PANEL_LIMITS.sidebar.default}px`,
      "--properties-min": `${PANEL_LIMITS.properties.minimum}px`,
      "--properties-max": `${PANEL_LIMITS.properties.maximum}px`,
      "--properties-default": `${PANEL_LIMITS.properties.default}px`,
      "--editor-min": `${PANEL_LIMITS.editorMinimum}px`,
    } as CSSProperties}>
      {sidebarOpen && <Sidebar
        width={settings.ui.sidebarWidth}
        workspaceName={settings.workspaceName} entries={tree} activePath={activeDocument?.relativePath} selectedFolder={selectedFolder}
        expandedFolders={settings.ui.expandedFolders} search={sidebarSearch}
        onOpen={(entry) => void openFile(entry)} onSelectFolder={setSelectedFolder}
        onToggleFolder={(path) => setSettings((current) => ({ ...current, ui: { ...current.ui, expandedFolders: current.ui.expandedFolders.includes(path) ? current.ui.expandedFolders.filter((item) => item !== path) : [...current.ui.expandedFolders, path] } }))}
        onRefresh={() => void refreshTree()} onCreate={(kind) => setEntryDialog({ mode: kind === "file" ? "create-file" : "create-directory", value: kind === "file" ? t("app.untitledMarkdown") : t("app.newFolder") })}
        onRename={(entry) => setEntryDialog({ mode: "rename", value: entry.name, entry })} onDelete={(entry) => void handleDelete(entry)} onCollapse={() => setSidebarOpen(false)}
      />}
      {sidebarOpen && <div className="panel-resizer" role="separator" aria-label={t("app.resizeSidebar")} aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => beginPanelResize("sidebar", event)} onKeyDown={(event) => resizeHandleKeyDown("sidebar", event)} />}
      <main className="workspace-main">
        <header className="topbar" data-tauri-drag-region>
          <div className="breadcrumbs" data-tauri-drag-region>
            {!sidebarOpen && <button className="icon-button" aria-label={t("app.expandSidebar")} onClick={() => setSidebarOpen(true)}><Menu /></button>}
            <BookOpen />
            {breadcrumbs.map((part, index) => <span key={`${part}-${index}`}>{index > 0 && <ChevronRight />}{part}</span>)}
          </div>
          <div className="topbar-actions">
            {activeDocument && <span className={`save-state ${activeDocument.conflict ? "conflict" : ""}`}>{activeDocument.conflict ? <><AlertTriangle />{t("app.conflict")}</> : activeDocument.saving ? t("app.saving") : activeDocument.dirty ? t("app.unsaved") : <><Check />{t("app.saved")}</>}</span>}
            <button className="icon-button" title={t("app.saveNow")} aria-label={t("app.saveNow")} disabled={!activeDocument || activeDocument.saving} onClick={() => activeId && void persist(activeId)}><Save /></button>
            <button className="icon-button" title={t("app.pageProperties")} aria-label={t("app.pageProperties")} disabled={!activeDocument} onClick={() => setPropertiesOpen((value) => !value)}><PanelRightOpen /></button>
            <div className="tools-menu-wrap" ref={toolsMenuRef}>
              <button className="icon-button" title={t("app.workspaceTools")} aria-label={t("app.workspaceTools")} aria-expanded={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><Settings /></button>
              {toolsOpen && <div className="tools-menu">
                <label className="tools-toggle"><input type="checkbox" checked={settings.settings.autoSaveEnabled} onChange={(event) => setSettings((current) => ({ ...current, settings: { ...current.settings, autoSaveEnabled: event.target.checked } }))} /><span>{t("app.autoSave")}</span></label>
                <button onClick={() => void openWorkspace()}>{t("app.switchWorkspace")}</button>
                <button onClick={() => void handleImport()}>{t("app.importFolder")}</button>
                <button onClick={() => void handleExport()}>{t("app.exportZip")}</button>
                <button onClick={() => void handleOrphanScan()}>{t("app.scanOrphans")}</button>
              </div>}
            </div>
          </div>
        </header>
        <div className="tabs">
          <div className="tabs-scroll" role="tablist" aria-label={t("tabs.openDocuments")}>
            {settings.ui.tabGroups.length === 0 ? documents.map(renderTab) : <>
              <div className={`tab-group-zone ungrouped-tabs${tabDropTarget?.type === "group" && tabDropTarget.groupId === null ? " drop-group" : ""}`} data-tab-group="ungrouped">
                {ungroupedDocuments.map(renderTab)}
              </div>
              {settings.ui.tabGroups.map((group) => {
                const groupedDocuments = documents.filter((doc) => settings.ui.tabAssignments[doc.relativePath] === group.id);
                return <div className={`tab-group-zone${tabDropTarget?.type === "group" && tabDropTarget.groupId === group.id ? " drop-group" : ""}`} data-tab-group={group.id} key={group.id}>
                  <div className="tab-group-header" title={t("tabs.dropIntoGroup")} style={{ boxShadow: `inset 0 3px ${group.color}` }}>
                    <button onClick={() => toggleTabGroup(group.id)} aria-expanded={!group.collapsed}>{group.collapsed ? <ChevronRight /> : <ChevronDown />}<span>{group.name}</span><i>{groupedDocuments.length}</i></button>
                    <button className="tab-group-remove" aria-label={t("tabs.groupMenu", { name: group.name })} aria-expanded={groupMenu?.id === group.id} onClick={(event) => openTabGroupMenu(group.id, group.name, event.currentTarget)}><MoreHorizontal /></button>
                  </div>
                  {!group.collapsed && groupedDocuments.map(renderTab)}
                </div>;
              })}
            </>}
          </div>
          <div className="tab-bulk-actions" aria-label={t("tabs.closeActions")}>
            <button onClick={addTabGroup}>{t("tabs.addGroup")}</button>
            <button disabled={!activeId || documents.length <= 1} onClick={() => activeId && closeTabs(documents.filter((doc) => doc.id !== activeId).map((doc) => doc.id))}>{t("tabs.closeOthers")}</button>
            <button disabled={documents.length === 0} onClick={() => closeTabs(documents.map((doc) => doc.id))}>{t("tabs.closeAll")}</button>
          </div>
        </div>
        <section className="document-area">
          {activeDocument ? <EditorPane key={activeDocument.id} document={activeDocument} workspaceRoot={workspaceRoot} targetText={searchTarget?.path === activeDocument.relativePath ? searchTarget.text : undefined} targetNonce={searchTarget?.nonce} onChange={updateVisualDocument} onSourceChange={updateSourceDocument} /> : <div className="empty-document"><FileText /><h2>{t("empty.title")}</h2><p>{t("empty.description")}</p></div>}
          {activeDocument?.conflict && <div className="conflict-bar" role="alert"><AlertTriangle /><span>{activeDocument.conflict.diskHash === "deleted" ? t("conflict.deleted") : t("conflict.changed")}</span><button onClick={() => void reloadFromDisk(activeDocument.id)} disabled={activeDocument.conflict.diskHash === "deleted"}>{t("conflict.reload")}</button><button className="danger" onClick={() => void persist(activeDocument.id, true)}>{t("conflict.overwrite")}</button></div>}
          {activeDocument && propertiesOpen && <div className="panel-resizer properties-resizer" role="separator" aria-label={t("app.resizeProperties")} aria-orientation="vertical" tabIndex={0} onPointerDown={(event) => beginPanelResize("properties", event)} onKeyDown={(event) => resizeHandleKeyDown("properties", event)} />}
          {activeDocument && propertiesOpen && <PropertiesPanel width={settings.ui.propertiesWidth} state={activeDocument.parsed.frontMatter} onChange={updateFrontMatter} onClose={() => setPropertiesOpen(false)} />}
        </section>
        {settingsWarning && <div className="settings-warning"><AlertTriangle />{settingsWarning}<button aria-label={t("app.closeSettingsWarning")} onClick={() => setSettingsWarning(undefined)}><X /></button></div>}
      </main>
      {entryDialog && <div className="dialog-backdrop" role="presentation"><form className="entry-dialog" onSubmit={(event) => { event.preventDefault(); void submitEntryDialog(); }}><h2>{entryDialog.mode === "rename" ? t("entry.renameTitle") : entryDialog.mode === "create-file" ? t("entry.newMarkdownTitle") : t("entry.newFolderTitle")}</h2><label><span>{t("entry.name")}</span><input ref={entryNameInputRef} value={entryDialog.value} onChange={(event) => setEntryDialog((current) => current ? { ...current, value: event.target.value } : current)} /></label><div><button type="button" className="secondary-button" onClick={() => setEntryDialog(null)}>{t("common.cancel")}</button><button type="submit" className="primary-button" disabled={!entryDialog.value.trim()}>{t("common.confirm")}</button></div></form></div>}
      {groupMenu && (() => {
        const group = settings.ui.tabGroups.find((item) => item.id === groupMenu.id);
        if (!group) return null;
        const count = documents.filter((doc) => settings.ui.tabAssignments[doc.relativePath] === group.id).length;
        return <div ref={groupMenuRef} className="tab-group-menu" role="dialog" aria-label={t("tabs.groupSettings", { name: group.name })} style={{ left: groupMenu.left, top: groupMenu.top }}>
          <input aria-label={t("tabs.groupName")} value={groupMenu.draftName} maxLength={100} onChange={(event) => setGroupMenu((current) => current ? { ...current, draftName: event.target.value } : current)} onBlur={commitTabGroupName} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setGroupMenu(null); }} />
          <div className="tab-group-colors" aria-label={t("tabs.groupColor")}>{TAB_GROUP_COLORS.map((color) => <button key={color} aria-label={t("tabs.chooseColor", { color })} aria-pressed={group.color === color} style={{ backgroundColor: color }} onClick={() => setTabGroupColor(group.id, color)} />)}</div>
          <div className="tab-group-menu-actions">
            <button disabled={count === 0} onClick={() => closeTabGroup(group.id)}><X />{t("tabs.closeGroup")} <span>{count}</span></button>
            <button onClick={() => { removeTabGroup(group.id); setGroupMenu(null); }}><Unlink />{t("tabs.ungroup")}</button>
            <button className="danger" onClick={() => deleteTabGroup(group.id)}><Trash2 />{t("tabs.deleteGroup")}</button>
          </div>
        </div>;
      })()}
      {loading && <div className="loading-overlay" aria-live="polite"><span />{t("app.loading")}</div>}
      {toast && <div className="toast" role="status"><Check />{toast}</div>}
      {fatalError && <div className="error-toast" role="alert"><AlertTriangle /><span>{fatalError}</span><button aria-label={t("app.closeError")} onClick={() => setFatalError(null)}><X /></button></div>}
    </div>
  );
}

function FolderOpenIcon() {
  return <BookOpen aria-hidden="true" />;
}
