import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Dispatch } from "react";
import type { OpenDocument, WorkspaceEntry, WorkspaceSettings } from "../domain/types";
import { DEFAULT_WORKSPACE_SETTINGS } from "../domain/types";
import { errorMessage, readDocument, scanWorkspace, watchWorkspace, writeWorkspaceSettings } from "../services/desktop";
import type { WorkspaceSearchIndex } from "../services/searchIndex";
import type { DocAction } from "./useDocuments";

export function useWorkspace(documentsRef: RefObject<OpenDocument[]>, activeIdRef: RefObject<string | null>) {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_WORKSPACE_SETTINGS);
  const [settingsReadOnly, setSettingsReadOnly] = useState(false);
  const [settingsWarning, setSettingsWarning] = useState<string | undefined>();
  const [sessionReady, setSessionReady] = useState(false);
  const [tree, setTree] = useState<WorkspaceEntry[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const settingsTimer = useRef(0);
  const refreshTree = useCallback(async (root = workspaceRoot) => {
    if (!root) return [];
    try {
      const entries = await scanWorkspace(root);
      setTree(entries);
      setWorkspaceError(null);
      return entries;
    } catch (error) {
      setWorkspaceError(errorMessage(error));
      return [];
    }
  }, [workspaceRoot]);
  const withWorkspace = useCallback(<Args extends unknown[], Result>(command: (root: string, ...args: Args) => Result) => (
    ...args: Args
  ): Result | undefined => workspaceRoot ? command(workspaceRoot, ...args) : undefined, [workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot || !sessionReady || settingsReadOnly) return;
    window.clearTimeout(settingsTimer.current);
    settingsTimer.current = window.setTimeout(() => {
      const active = documentsRef.current.find((document) => document.id === activeIdRef.current);
      const next: WorkspaceSettings = {
        ...settings,
        ui: { ...settings.ui, openTabs: documentsRef.current.map((document) => document.relativePath), lastOpenedFile: active?.relativePath ?? null },
      };
      void writeWorkspaceSettings(workspaceRoot, next).catch((error) => setSettingsWarning(errorMessage(error)));
    }, 400);
    return () => window.clearTimeout(settingsTimer.current);
  }, [activeIdRef, documentsRef, sessionReady, settings, settingsReadOnly, workspaceRoot]);
  return {
    workspaceRoot, setWorkspaceRoot, settings, setSettings, settingsReadOnly, setSettingsReadOnly,
    settingsWarning, setSettingsWarning, sessionReady, setSessionReady, tree, setTree,
    selectedFolder, setSelectedFolder, workspaceError, setWorkspaceError, refreshTree, withWorkspace,
  };
}

interface WorkspaceWatcherOptions {
  workspaceRoot: string | null;
  refreshTree: (root?: string | null) => Promise<WorkspaceEntry[]>;
  documentsRef: RefObject<OpenDocument[]>;
  savingIds: RefObject<Set<string>>;
  searchIndex: RefObject<WorkspaceSearchIndex>;
  searchQueryRef: RefObject<string>;
  dispatch: Dispatch<DocAction>;
  externalChange: (id: string, disk: Awaited<ReturnType<typeof readDocument>>) => void;
  refreshSearchResults: () => void;
}

export function useWorkspaceWatcher(options: WorkspaceWatcherOptions): void {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => {
    const root = options.workspaceRoot;
    if (!root) return;
    let disposed = false;
    let timer = 0;
    const pendingPaths = new Set<string>();
    let unlisten: (() => void) | undefined;
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
    const routeChanges = async () => {
      const current = optionsRef.current;
      const changedPaths = [...pendingPaths];
      pendingPaths.clear();
      await current.refreshTree(root);
      await Promise.all(changedPaths.filter((path) => /\.(?:md|markdown)$/i.test(path)).map(async (path) => {
        const normalizedPath = path.replace(/\\/g, "/");
        const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : normalizedPath.split("/").at(-1) ?? normalizedPath;
        try {
          const disk = await readDocument(root, relativePath);
          current.searchIndex.current.update(disk.path, disk.relativePath, disk.content);
          const affected = current.documentsRef.current.find((document) => document.relativePath === relativePath);
          if (affected && !current.savingIds.current.has(affected.id)) current.externalChange(affected.id, disk);
        } catch {
          const affected = current.documentsRef.current.find((document) => document.relativePath === relativePath);
          if (affected) {
            current.searchIndex.current.remove(affected.path);
            current.dispatch({ type: "EXTERNAL_DELETE", id: affected.id });
          }
        }
      }));
      if (current.searchQueryRef.current) current.refreshSearchResults();
    };
    void watchWorkspace(root, (event) => {
      event.paths.forEach((path) => pendingPaths.add(path));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!disposed) void routeChanges(); }, 180);
    }).then((stop) => { unlisten = stop; });
    return () => { disposed = true; window.clearTimeout(timer); unlisten?.(); };
  }, [options.workspaceRoot]);
}
