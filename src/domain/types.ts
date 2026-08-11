export type EditorMode = "visual" | "source" | "compatibility";

export interface FileFormatProfile {
  encoding: "utf-8" | "big5" | "gbk" | "shift_jis";
  bom: "none" | "utf8";
  eol: "lf" | "crlf" | "cr";
}

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface MarkdownIssue {
  severity: "warning" | "error";
  kind: "unsupported" | "unsafe-html" | "frontmatter" | "encoding";
  message: string;
  start?: SourcePosition;
  end?: SourcePosition;
  recoverable: boolean;
}

export interface FrontMatterState {
  raw: string | null;
  body: string;
  data: Record<string, unknown>;
  format: "yaml" | "unsupported" | "none";
  dirty: boolean;
}

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

export interface ParsedMarkdown {
  doc: TiptapNode;
  source: string;
  frontMatter: FrontMatterState;
  issues: MarkdownIssue[];
  mode: EditorMode;
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  relativePath: string;
  kind: "file" | "directory";
  size: number;
  modifiedAt: number;
  children?: WorkspaceEntry[];
}

export interface DiskDocument {
  path: string;
  relativePath: string;
  content: string;
  hash: string;
  profile: FileFormatProfile;
  size: number;
}

export interface OpenDocument extends DiskDocument {
  id: string;
  title: string;
  parsed: ParsedMarkdown;
  dirty: boolean;
  saving: boolean;
  saveGeneration: number;
  revision: number;
  editorVersion: number;
  conflict?: { diskHash: string; diskContent: string };
}

export interface SearchHit {
  id: string;
  filePath: string;
  relativePath: string;
  lineNumber: number;
  sourceStartOffset: number;
  sourceEndOffset: number;
  rawLineText: string;
}

export interface WorkspaceSettings {
  version: 1;
  workspaceName: string;
  settings: {
    lineBreakMode: "soft";
    softBreakSerialization: "space";
    autoSaveDebounceMs: number;
    autoSaveEnabled: boolean;
    exportMode: "strict" | "htmlCompat";
    openFolderFileFormatPolicy: "preserve" | "utf8";
  };
  ui: {
    expandedFolders: string[];
    lastOpenedFile: string | null;
    openTabs: string[];
    sidebarWidth: number;
    propertiesWidth: number;
    tabGroups: Array<{ id: string; name: string; color: string; collapsed: boolean }>;
    tabAssignments: Record<string, string>;
  };
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  version: 1,
  workspaceName: "Notes",
  settings: {
    lineBreakMode: "soft",
    softBreakSerialization: "space",
    autoSaveDebounceMs: 1500,
    autoSaveEnabled: true,
    exportMode: "strict",
    openFolderFileFormatPolicy: "preserve",
  },
  ui: { expandedFolders: [], lastOpenedFile: null, openTabs: [], sidebarWidth: 276, propertiesWidth: 288, tabGroups: [], tabAssignments: {} },
};
