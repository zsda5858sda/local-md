import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderInput, FolderOpen,
  FolderPlus, MoreHorizontal, PanelLeftClose, RefreshCw, Search,
} from "lucide-react";
import type { SearchHit, WorkspaceEntry } from "../domain/types";
import { t } from "../i18n";

export interface SearchProps {
  query: string;
  replacementText: string;
  scope: "document" | "workspace";
  regex: boolean;
  error?: string;
  hits: SearchHit[];
  shortcut: { mode: "search" | "replace"; nonce: number } | null;
  onQueryChange: (query: string) => void;
  onReplacementChange: (value: string) => void;
  onScopeChange: (scope: "document" | "workspace") => void;
  onRegexChange: (enabled: boolean) => void;
  onReplaceAll: () => void;
  onOpenHit: (hit: SearchHit) => void;
}

interface SidebarProps {
  width: number;
  workspaceName: string;
  entries: WorkspaceEntry[];
  activePath?: string;
  selectedFolder?: string;
  expandedFolders: string[];
  search: SearchProps;
  onOpen: (entry: WorkspaceEntry) => void;
  onSelectFolder: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onRefresh: () => void;
  onOpenWorkspace: () => void;
  onCreate: (kind: "file" | "directory") => void;
  onMove: (entry: WorkspaceEntry) => void;
  draggedFilePath: string | null;
  fileDropTarget: string | null;
  onFileDragStart: (entry: WorkspaceEntry) => void;
  onFileDragEnd: () => void;
  onFileDragOver: (destination: string | null) => void;
  onFileDrop: (destination: string) => void;
  onRename: (entry: WorkspaceEntry) => void;
  onDelete: (entry: WorkspaceEntry) => void;
  onCollapse: () => void;
}

function visibleEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries
    .filter((entry) => !(entry.kind === "directory" && entry.name === "assets"))
    .map((entry) => entry.kind === "directory"
      ? { ...entry, children: visibleEntries(entry.children ?? []) }
      : entry);
}

export function keyboardNavigableEntries(entries: WorkspaceEntry[], expandedFolders: string[], depth = 0): Array<{ entry: WorkspaceEntry; depth: number }> {
  return entries.flatMap((entry) => {
    if (entry.kind === "directory" && entry.name === "assets") return [];
    const current = [{ entry, depth }];
    return entry.kind === "directory" && expandedFolders.includes(entry.relativePath)
      ? [...current, ...keyboardNavigableEntries(entry.children ?? [], expandedFolders, depth + 1)]
      : current;
  });
}

interface TreeItemProps {
  entry: WorkspaceEntry;
  depth: number;
  props: SidebarProps;
  selectedTreePath: string | null;
  onSelect: (entry: WorkspaceEntry) => void;
  registerRow: (path: string, element: HTMLDivElement | null) => void;
}

function TreeItem({ entry, depth, props, selectedTreePath, onSelect, registerRow }: TreeItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isFolder = entry.kind === "directory";
  const expanded = props.expandedFolders.includes(entry.relativePath);
  const active = isFolder ? props.selectedFolder === entry.relativePath : props.activePath === entry.relativePath;
  const validDropTarget = isFolder && props.draggedFilePath !== null && props.draggedFilePath.split("/").slice(0, -1).join("/") !== entry.relativePath;
  const onFolderDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!validDropTarget) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    props.onFileDragOver(entry.relativePath);
  };
  return (
    <li>
      <div ref={(element) => registerRow(entry.relativePath, element)} className={`tree-row ${active ? "active" : ""}${selectedTreePath === entry.relativePath ? " keyboard-selected" : ""}${props.fileDropTarget === entry.relativePath ? " file-drop-target" : ""}`} style={{ paddingInlineStart: `${10 + depth * 16}px` }} onDragOver={onFolderDragOver} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && props.fileDropTarget === entry.relativePath) props.onFileDragOver(null); }} onDrop={(event) => { if (!validDropTarget) return; event.preventDefault(); props.onFileDrop(entry.relativePath); }}>
        <button className="tree-main" type="button" draggable={!isFolder} aria-expanded={isFolder ? expanded : undefined} onDragStart={(event) => { if (isFolder) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.relativePath); props.onFileDragStart(entry); }} onDragEnd={props.onFileDragEnd} onFocus={() => onSelect(entry)} onClick={() => {
          onSelect(entry);
          if (isFolder) {
            props.onSelectFolder(entry.relativePath);
            props.onToggleFolder(entry.relativePath);
          } else props.onOpen(entry);
        }}>
          <span className="tree-disclosure" aria-hidden="true">
            {isFolder ? (expanded ? <ChevronDown /> : <ChevronRight />) : null}
          </span>
          <span className="tree-icon" aria-hidden="true">
            {isFolder ? (expanded ? <FolderOpen /> : <Folder />) : <FileText />}
          </span>
          <span className="tree-label">{entry.name}</span>
        </button>
        <button className="tree-more" aria-label={t("sidebar.entryMenu", { name: entry.name })} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal /></button>
        {menuOpen && (
          <div className="tree-context-menu" role="menu">
            {!isFolder && <button role="menuitem" onClick={() => { setMenuOpen(false); props.onMove(entry); }}><FolderInput />移動到資料夾</button>}
            <button role="menuitem" onClick={() => { setMenuOpen(false); props.onRename(entry); }}>{t("common.rename")}</button>
            <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); props.onDelete(entry); }}>{t("sidebar.trash")}</button>
          </div>
        )}
      </div>
      {isFolder && expanded && entry.children && (
        <ul>{entry.children.map((child) => <TreeItem key={child.relativePath} entry={child} depth={depth + 1} props={props} selectedTreePath={selectedTreePath} onSelect={onSelect} registerRow={registerRow} />)}</ul>
      )}
    </li>
  );
}

export function Sidebar(props: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const treeNavRef = useRef<HTMLElement>(null);
  const treeRowRefs = useRef(new Map<string, HTMLDivElement>());
  const keyboardEntries = useMemo(() => keyboardNavigableEntries(props.entries, props.expandedFolders), [props.entries, props.expandedFolders]);

  const registerRow = (path: string, element: HTMLDivElement | null) => {
    if (element) treeRowRefs.current.set(path, element);
    else treeRowRefs.current.delete(path);
  };
  const selectTreeEntry = (entry: WorkspaceEntry) => {
    setSelectedTreePath(entry.relativePath);
    window.requestAnimationFrame(() => treeRowRefs.current.get(entry.relativePath)?.scrollIntoView({ block: "nearest" }));
  };
  const handleTreeKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const selectedPath = selectedTreePath ?? props.selectedFolder ?? props.activePath ?? keyboardEntries[0]?.entry.relativePath;
    const currentIndex = keyboardEntries.findIndex((item) => item.entry.relativePath === selectedPath);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      const next = keyboardEntries[currentIndex < 0
        ? (event.key === "ArrowUp" ? keyboardEntries.length - 1 : 0)
        : currentIndex + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) selectTreeEntry(next.entry);
      return;
    }
    const entry = keyboardEntries[currentIndex]?.entry;
    if (!entry) return;
    if (event.key === " " && entry.kind === "file") {
      event.preventDefault();
      event.stopPropagation();
      props.onOpen(entry);
      return;
    }
    if (event.key !== "Enter" && event.key !== "F2") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter" && entry.kind === "directory" && !props.expandedFolders.includes(entry.relativePath)) {
      props.onSelectFolder(entry.relativePath);
      props.onToggleFolder(entry.relativePath);
      return;
    }
    props.onRename(entry);
  };

  useEffect(() => {
    if (selectedTreePath && !keyboardEntries.some((item) => item.entry.relativePath === selectedTreePath)) setSelectedTreePath(props.selectedFolder || null);
  }, [keyboardEntries, props.selectedFolder, selectedTreePath]);

  useEffect(() => {
    if (!props.search.shortcut) return;
    setSearchOpen(true);
  }, [props.search.shortcut]);

  useEffect(() => {
    if (!searchOpen || !props.search.shortcut) return;
    const frame = window.requestAnimationFrame(() => {
      const input = props.search.shortcut?.mode === "replace" ? replacementInputRef.current : searchInputRef.current;
      input?.focus();
      input?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.search.shortcut, searchOpen]);
  return (
    <aside className="sidebar" style={{ flexBasis: `${props.width}px` }}>
      <header className="sidebar-header">
        <button className="workspace-root-button" type="button" aria-label="開啟或切換工作區" data-tooltip="開啟或切換工作區" onClick={props.onOpenWorkspace}>
          <Folder className="workspace-mark" aria-hidden="true" />
          <strong>{props.workspaceName}</strong>
        </button>
        <button className="icon-button" aria-label={t("sidebar.collapse")} onClick={props.onCollapse}><PanelLeftClose /></button>
      </header>
      <div className="sidebar-actions">
        <button aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search />{t("sidebar.search")}</button>
        <button onClick={props.onRefresh}><RefreshCw />{t("sidebar.refresh")}</button>
      </div>
      {searchOpen && (
        <div className="search-panel">
          <label className="search-field"><Search /><input ref={searchInputRef} autoFocus value={props.search.query} onChange={(event) => props.search.onQueryChange(event.target.value)} placeholder={t("sidebar.searchPlaceholder")} /></label>
          <label className="search-field"><span>{t("sidebar.replace")}</span><input ref={replacementInputRef} value={props.search.replacementText} onChange={(event) => props.search.onReplacementChange(event.target.value)} placeholder={t("sidebar.replacePlaceholder")} /></label>
          <div className="search-options">
            <select aria-label={t("sidebar.searchScope")} value={props.search.scope} onChange={(event) => props.search.onScopeChange(event.target.value as "document" | "workspace")}>
              <option value="document">{t("sidebar.currentDocument")}</option>
              <option value="workspace">{t("sidebar.workspace")}</option>
            </select>
            <label><input type="checkbox" checked={props.search.regex} onChange={(event) => props.search.onRegexChange(event.target.checked)} />Regex</label>
          </div>
          {props.search.error && <div className="search-error" role="alert">{props.search.error}</div>}
          <div className="search-summary"><span>{props.search.query ? t("sidebar.resultCount", { count: props.search.hits.length, limit: props.search.hits.length >= 50 ? t("sidebar.resultLimit") : "" }) : t("sidebar.searchHint")}</span><button disabled={!props.search.query.trim() || Boolean(props.search.error)} onClick={props.search.onReplaceAll}>{t("sidebar.replaceAll")}</button></div>
          <ul>
            {props.search.hits.map((hit) => (
              <li key={hit.id}><button onClick={() => props.search.onOpenHit(hit)}><strong>{hit.relativePath}</strong><span>{hit.lineNumber} · {hit.rawLineText || t("sidebar.emptyLine")}</span></button></li>
            ))}
          </ul>
        </div>
      )}
      <div className={`tree-heading${props.fileDropTarget === "" && props.draggedFilePath !== null ? " file-drop-target" : ""}`} onDragOver={(event) => { if (props.draggedFilePath === null || !props.draggedFilePath.includes("/")) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; props.onFileDragOver(""); }} onDrop={(event) => { if (props.draggedFilePath === null || !props.draggedFilePath.includes("/")) return; event.preventDefault(); props.onFileDrop(""); }}>
        <button className="tree-root" title={t("sidebar.rootTitle")} onClick={() => props.onSelectFolder("")}>{props.selectedFolder ? t("sidebar.folderPath", { path: props.selectedFolder }) : t("sidebar.rootPath")}</button>
        <div>
          <button aria-label={t("sidebar.newMarkdown")} title={t("sidebar.newMarkdown")} onClick={() => props.onCreate("file")}><FilePlus2 /></button>
          <button aria-label={t("sidebar.newFolder")} title={t("sidebar.newFolder")} onClick={() => props.onCreate("directory")}><FolderPlus /></button>
        </div>
      </div>
      <nav ref={treeNavRef} className="tree" tabIndex={0} aria-label={t("sidebar.workspaceFiles")} onKeyDown={handleTreeKeyDown} onClick={(event) => { if (!(event.target instanceof Element) || !event.target.closest(".tree-row")) { setSelectedTreePath(null); props.onSelectFolder(""); } window.requestAnimationFrame(() => treeNavRef.current?.focus()); }}><ul>{visibleEntries(props.entries).map((entry) => <TreeItem key={entry.relativePath} entry={entry} depth={0} props={props} selectedTreePath={selectedTreePath} onSelect={selectTreeEntry} registerRow={registerRow} />)}</ul></nav>
      <footer className="sidebar-footer"><span className="status-dot" />{t("sidebar.offline")}</footer>
    </aside>
  );
}
