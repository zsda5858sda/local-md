import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderOpen,
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
  onCreate: (kind: "file" | "directory") => void;
  onRename: (entry: WorkspaceEntry) => void;
  onDelete: (entry: WorkspaceEntry) => void;
  onCollapse: () => void;
}

function TreeItem({ entry, depth, props }: { entry: WorkspaceEntry; depth: number; props: SidebarProps }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isFolder = entry.kind === "directory";
  const expanded = props.expandedFolders.includes(entry.relativePath);
  const active = isFolder ? props.selectedFolder === entry.relativePath : props.activePath === entry.relativePath;
  return (
    <li>
      <div className={`tree-row ${active ? "active" : ""}`} style={{ paddingInlineStart: `${10 + depth * 16}px` }}>
        <button className="tree-main" type="button" aria-expanded={isFolder ? expanded : undefined} onClick={() => {
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
            <button role="menuitem" onClick={() => { setMenuOpen(false); props.onRename(entry); }}>{t("common.rename")}</button>
            <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); props.onDelete(entry); }}>{t("sidebar.trash")}</button>
          </div>
        )}
      </div>
      {isFolder && expanded && entry.children && (
        <ul>{entry.children.map((child) => <TreeItem key={child.relativePath} entry={child} depth={depth + 1} props={props} />)}</ul>
      )}
    </li>
  );
}

export function Sidebar(props: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replacementInputRef = useRef<HTMLInputElement>(null);

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
        <div className="workspace-mark">L</div>
        <strong title={props.workspaceName}>{props.workspaceName}</strong>
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
      <div className="tree-heading">
        <button className="tree-root" title={t("sidebar.rootTitle")} onClick={() => props.onSelectFolder("")}>{props.selectedFolder ? t("sidebar.folderPath", { path: props.selectedFolder }) : t("sidebar.rootPath")}</button>
        <div>
          <button aria-label={t("sidebar.newMarkdown")} title={t("sidebar.newMarkdown")} onClick={() => props.onCreate("file")}><FilePlus2 /></button>
          <button aria-label={t("sidebar.newFolder")} title={t("sidebar.newFolder")} onClick={() => props.onCreate("directory")}><FolderPlus /></button>
        </div>
      </div>
      <nav className="tree" aria-label={t("sidebar.workspaceFiles")}><ul>{props.entries.map((entry) => <TreeItem key={entry.relativePath} entry={entry} depth={0} props={props} />)}</ul></nav>
      <footer className="sidebar-footer"><span className="status-dot" />{t("sidebar.offline")}</footer>
    </aside>
  );
}
