import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { save } from "@tauri-apps/plugin-dialog";
import type { DiskDocument, FileFormatProfile, WorkspaceEntry, WorkspaceSettings } from "../domain/types";
import { DEFAULT_WORKSPACE_SETTINGS } from "../domain/types";
import { parseMarkdown, serializeMarkdown } from "../markdown/pipeline";

const UTF8_LF: FileFormatProfile = { encoding: "utf-8", bom: "none", eol: "lf" };

export const isTauri = (): boolean => Boolean(window.__TAURI_INTERNALS__);

const demoFiles = new Map<string, string>([
  ["歡迎.md", `---\ntitle: 歡迎使用 Local MD\ntags: [local-first, markdown]\n---\n# 歡迎使用 Local MD\n\n這是一個**本機優先**、以 Markdown 為唯一事實來源的區塊式編輯器。\n\n- [x] 純文字、完全可攜\n- [x] 可靠的 canonical 儲存\n- [ ] 選擇資料夾開始工作\n\n> 瀏覽器模式使用記憶體示範工作區；Tauri 桌面版可直接操作本機檔案。\n\n| 原則 | 狀態 |\n| :--- | :---: |\n| Markdown 不被破壞 | ✅ |\n| 預設離線 | ✅ |\n`],
  ["指南/快捷鍵.md", "# 快捷鍵\n\n- **粗體**：Ctrl/Cmd + B\n- *斜體*：Ctrl/Cmd + I\n- 儲存：Ctrl/Cmd + S\n\n使用工具列可以插入標題、清單、引言、程式碼與表格。\n"],
  ["指南/相容模式.md", "# 相容模式\n\n遇到無法安全 round-trip 的語法時，Local MD 不會靜默刪除內容，而會保留原始 Markdown 或切換到純文字模式。\n"],
]);

function demoHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `demo-${(hash >>> 0).toString(16)}`;
}

function demoTree(): WorkspaceEntry[] {
  const root: WorkspaceEntry[] = [];
  for (const [path, content] of demoFiles) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((name, index) => {
      const relativePath = parts.slice(0, index + 1).join("/");
      let entry = level.find((item) => item.name === name);
      if (!entry) {
        entry = { name, path: relativePath, relativePath, kind: index === parts.length - 1 ? "file" : "directory", size: index === parts.length - 1 ? content.length : 0, modifiedAt: Date.now(), ...(index < parts.length - 1 ? { children: [] } : {}) };
        level.push(entry);
      }
      if (entry.children) level = entry.children;
    });
  }
  return root;
}

export async function chooseWorkspace(): Promise<string | null> {
  if (!isTauri()) return "demo://workspace";
  const selected = await open({ directory: true, multiple: false, title: "開啟 Markdown 工作區" });
  return typeof selected === "string" ? selected : null;
}

export async function scanWorkspace(root: string): Promise<WorkspaceEntry[]> {
  if (!isTauri()) return demoTree();
  return invoke("scan_workspace", { root });
}

export async function readDocument(root: string, relativePath: string): Promise<DiskDocument> {
  if (!isTauri()) {
    const content = demoFiles.get(relativePath) ?? "";
    return { path: relativePath, relativePath, content, hash: demoHash(content), profile: UTF8_LF, size: content.length };
  }
  return invoke("read_markdown", { root, relativePath });
}

export interface SaveRequest {
  root: string;
  relativePath: string;
  content: string;
  expectedHash: string | null;
  profile: FileFormatProfile;
  force?: boolean;
  saveGeneration: number;
}

export type SaveError =
  | { kind: "Conflict"; expected: string | null; actual: string | null }
  | { kind: "Io"; message: string }
  | { kind: "Encoding"; message: string };

export function isSaveError(error: unknown): error is SaveError {
  if (typeof error !== "object" || error === null || !("kind" in error)) return false;
  const candidate = error as Record<string, unknown>;
  if (candidate.kind === "Conflict") {
    return (typeof candidate.expected === "string" || candidate.expected === null)
      && (typeof candidate.actual === "string" || candidate.actual === null);
  }
  return (candidate.kind === "Io" || candidate.kind === "Encoding") && typeof candidate.message === "string";
}

export function errorMessage(error: unknown): string {
  if (isSaveError(error)) return error.kind === "Conflict" ? "磁碟版本已變更" : error.message;
  return error instanceof Error ? error.message : String(error);
}

export async function saveDocument(request: SaveRequest): Promise<{ hash: string; saveGeneration: number }> {
  if (!isTauri()) {
    const current = demoFiles.get(request.relativePath) ?? "";
    const actual = demoHash(current);
    if (!request.force && request.expectedHash && actual !== request.expectedHash) {
      throw { kind: "Conflict", expected: request.expectedHash, actual } satisfies SaveError;
    }
    demoFiles.set(request.relativePath, request.content);
    return { hash: demoHash(request.content), saveGeneration: request.saveGeneration + 1 };
  }
  return invoke("write_markdown", { request });
}

export async function createEntry(root: string, relativePath: string, kind: "file" | "directory"): Promise<void> {
  if (!isTauri()) {
    if (kind === "file") demoFiles.set(relativePath, "# 未命名\n");
    return;
  }
  await invoke("create_entry", { root, relativePath, kind });
}

export async function renameEntry(root: string, from: string, to: string): Promise<void> {
  if (!isTauri()) {
    for (const [path, content] of [...demoFiles]) {
      if (path === from || path.startsWith(`${from}/`)) {
        demoFiles.delete(path);
        demoFiles.set(`${to}${path.slice(from.length)}`, content);
      }
    }
    return;
  }
  await invoke("rename_entry", { root, from, to });
}

export async function deleteEntry(root: string, relativePath: string): Promise<void> {
  if (!isTauri()) {
    for (const path of [...demoFiles.keys()]) if (path === relativePath || path.startsWith(`${relativePath}/`)) demoFiles.delete(path);
    return;
  }
  await invoke("delete_entry", { root, relativePath });
}

export async function readWorkspaceSettings(root: string): Promise<{ settings: WorkspaceSettings; readOnly: boolean; warning?: string }> {
  if (!isTauri()) return { settings: { ...DEFAULT_WORKSPACE_SETTINGS, workspaceName: "示範工作區" }, readOnly: false };
  return invoke("read_workspace_settings", { root });
}

export async function writeWorkspaceSettings(root: string, settings: WorkspaceSettings): Promise<void> {
  if (!isTauri()) return;
  await invoke("write_workspace_settings", { root, settings });
}

export async function loadWorkspaceAsset(root: string, documentRelativePath: string, assetReference: string): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke("read_workspace_asset", { root, documentRelativePath, assetReference });
}

export interface WorkspaceWatchEvent {
  paths: string[];
}

export async function watchWorkspace(root: string, onChange: (event: WorkspaceWatchEvent) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  const unlisten = await listen<WorkspaceWatchEvent>("workspace-event", (event) => onChange(event.payload));
  await invoke("watch_workspace", { root });
  return unlisten;
}

export interface ImportFileResult {
  relativePath: string;
  status: "imported" | "failed";
  sourceEncoding?: string;
  error?: string;
}

export interface ImportReport {
  succeeded: number;
  failed: number;
  files: ImportFileResult[];
}

export async function importFolder(targetRoot: string): Promise<ImportReport | null> {
  if (!isTauri()) {
    return { succeeded: 0, failed: 0, files: [] };
  }
  const source = await open({ directory: true, multiple: false, title: "選擇要匯入的 Markdown 與資源資料夾" });
  if (typeof source !== "string") return null;
  return invoke("import_workspace", { source, target: targetRoot });
}

export async function exportWorkspace(root: string, workspaceName: string): Promise<boolean> {
  if (!isTauri()) return false;
  const destination = await save({
    title: "匯出 Workspace ZIP",
    defaultPath: `${workspaceName || "workspace"}.zip`,
    filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
  });
  if (!destination) return false;
  await invoke("export_workspace", { root, destination });
  return true;
}

export async function scanOrphanAssets(root: string): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke("scan_orphan_assets", { root });
}

export function canonicalizeForSave(content: string): string {
  const parsed = parseMarkdown(content);
  return parsed.mode === "compatibility" ? content.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n") : serializeMarkdown(parsed.doc, parsed.frontMatter);
}
