# Local MD 編輯器功能優化 — Codex 執行指令包

---

## 1. 工具列按鈕加上快捷鍵文字

### 1.1 變更定位
- Target File: `src/components/Toolbar.tsx`
- Target Scope: `ToolbarButton` 函數 + `Toolbar` 元件內所有按鈕呼叫

### 1.2 問題代碼分析
現有 `ToolbarButton` 只接收 `label`，`title={label}`，沒有任何快捷鍵資訊：
```tsx
function ToolbarButton({ label, active, disabled, onClick, children }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" className={active ? "tool-button active" : "tool-button"} aria-label={label} title={label} disabled={disabled} onMouseDown={(event) => { event.preventDefault(); onClick(); }}>
      {children}
    </button>
  );
}
```

修復規格要求：
1. `ToolbarButton` 新增可選 `shortcut` prop（例如 `"B"`、`"Shift+X"`）。
2. 依 `navigator.platform` 判斷 macOS 顯示 `⌘`，否則顯示 `Ctrl`，組成 `Ctrl+B` 這類文字。
3. 最終顯示文字格式為 `粗體 (Ctrl+B)`，同步寫入 `title`、`aria-label`、`data-tooltip`（供 CSS 自訂 tooltip 使用，比原生 title 更即時可見）。
4. 只在該指令確實有對應快捷鍵時傳入 `shortcut`（依 README 快捷鍵表與 `keyboardShortcuts.ts`）：Undo=Z、Redo=Shift+Z、Bold=B、Italic=I、Underline=U、Strike=Shift+X、InsertLink=K（`LinkShortcut` 的 `Mod-k`）。

### 1.3 完整修復代碼

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Braces, Code2, Heading1, Heading2, Image, Italic, Link2, List,
  ListChecks, ListOrdered, Minus, Quote, Redo2, Strikethrough, Table2,
  Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import { t } from "../i18n";
import { chooseAndImportImage } from "../services/desktop";
import { INSERT_LINK_REQUESTED_EVENT } from "../editor/extensions";

interface ToolbarProps {
  editor: Editor | null;
  workspaceRoot: string;
  documentRelativePath: string;
}

type InputDialog = { kind: "link" | "image"; value: string; imageTab?: "upload" | "url" };

const isMacPlatform = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const modifierKeyLabel = isMacPlatform ? "\u2318" : "Ctrl";

function shortcutText(shortcut?: string): string | undefined {
  return shortcut ? `${modifierKeyLabel}+${shortcut}` : undefined;
}

function ToolbarButton({ label, shortcut, active, disabled, onClick, children }: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const shortcutLabel = shortcutText(shortcut);
  const fullLabel = shortcutLabel ? `${label} (${shortcutLabel})` : label;
  return (
    <button
      type="button"
      className={active ? "tool-button active" : "tool-button"}
      aria-label={fullLabel}
      title={fullLabel}
      data-tooltip={fullLabel}
      disabled={disabled}
      onMouseDown={(event) => { event.preventDefault(); onClick(); }}
    >
      {children}
    </button>
  );
}

export function Toolbar({ editor, workspaceRoot, documentRelativePath }: ToolbarProps) {
  const [dialog, setDialog] = useState<InputDialog | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const addLink = useCallback(() => {
    if (!editor) return;
    const href = editor.getAttributes("link").href;
    setDialog({ kind: "link", value: typeof href === "string" ? href : "https://" });
  }, [editor]);

  useEffect(() => {
    if (!dialog || dialog.kind !== "link") return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog?.kind]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const editorElement = editor.view.dom;
    editorElement.addEventListener(INSERT_LINK_REQUESTED_EVENT, addLink);
    return () => editorElement.removeEventListener(INSERT_LINK_REQUESTED_EVENT, addLink);
  }, [addLink, editor]);

  if (!editor) return <div className="toolbar" aria-label={t("toolbar.aria")} />;
  const command = () => editor.chain().focus();

  const submitLinkDialog = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    if (!value) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
    setDialog(null);
  };

  const submitImageUrl = () => {
    if (!dialog) return;
    const value = dialog.value.trim();
    if (value) editor.chain().focus().setImage({ src: value }).run();
    setDialog(null);
  };

  const browseLocalImage = useCallback(async () => {
    setImportError(null);
    setImporting(true);
    try {
      const asset = await chooseAndImportImage(workspaceRoot, documentRelativePath);
      if (asset) {
        editor.chain().focus().setImage({ src: asset.relativePath }).run();
        setDialog(null);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }, [documentRelativePath, editor, workspaceRoot]);

  return (
    <div className="toolbar" role="toolbar" aria-label={t("toolbar.aria")}>
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.undo")} shortcut="Z" disabled={!editor.can().undo()} onClick={() => command().undo().run()}><Undo2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.redo")} shortcut="Shift+Z" disabled={!editor.can().redo()} onClick={() => command().redo().run()}><Redo2 /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.bold")} shortcut="B" active={editor.isActive("bold")} onClick={() => command().toggleBold().run()}><Bold /></ToolbarButton>
        <ToolbarButton label={t("toolbar.italic")} shortcut="I" active={editor.isActive("italic")} onClick={() => command().toggleItalic().run()}><Italic /></ToolbarButton>
        <ToolbarButton label={t("toolbar.underline")} shortcut="U" active={editor.isActive("underline")} onClick={() => command().toggleUnderline().run()}><UnderlineIcon /></ToolbarButton>
        <ToolbarButton label={t("toolbar.strike")} shortcut="Shift+X" active={editor.isActive("strike")} onClick={() => command().toggleStrike().run()}><Strikethrough /></ToolbarButton>
        <ToolbarButton label={t("toolbar.inlineCode")} active={editor.isActive("code")} onClick={() => command().toggleCode().run()}><Braces /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.heading1")} active={editor.isActive("heading", { level: 1 })} onClick={() => command().toggleHeading({ level: 1 }).run()}><Heading1 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.heading2")} active={editor.isActive("heading", { level: 2 })} onClick={() => command().toggleHeading({ level: 2 }).run()}><Heading2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.bulletList")} active={editor.isActive("bulletList")} onClick={() => command().toggleBulletList().run()}><List /></ToolbarButton>
        <ToolbarButton label={t("toolbar.orderedList")} active={editor.isActive("orderedList")} onClick={() => command().toggleOrderedList().run()}><ListOrdered /></ToolbarButton>
        <ToolbarButton label={t("toolbar.taskList")} active={editor.isActive("taskList")} onClick={() => command().toggleTaskList().run()}><ListChecks /></ToolbarButton>
        <ToolbarButton label={t("toolbar.blockquote")} active={editor.isActive("blockquote")} onClick={() => command().toggleBlockquote().run()}><Quote /></ToolbarButton>
        <ToolbarButton label={t("toolbar.codeBlock")} active={editor.isActive("codeBlock")} onClick={() => command().toggleCodeBlock().run()}><Code2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.horizontalRule")} onClick={() => command().setHorizontalRule().run()}><Minus /></ToolbarButton>
      </div>
      <div className="tool-separator" />
      <div className="tool-group">
        <ToolbarButton label={t("toolbar.insertLink")} shortcut="K" active={editor.isActive("link")} onClick={addLink}><Link2 /></ToolbarButton>
        <ToolbarButton label={t("toolbar.insertImage")} onClick={() => setDialog({ kind: "image", value: "https://", imageTab: "upload" })}><Image /></ToolbarButton>
        <ToolbarButton label={t("toolbar.insertTable")} onClick={() => command().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></ToolbarButton>
      </div>

      {dialog?.kind === "link" && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <form className="entry-dialog toolbar-input-dialog" role="dialog" aria-modal="true" aria-labelledby="toolbar-dialog-title" onSubmit={(event) => { event.preventDefault(); submitLinkDialog(); }} onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}>
            <h2 id="toolbar-dialog-title">{t("toolbar.linkDialogTitle")}</h2>
            <label>
              <span>{t("toolbar.linkField")}</span>
              <input ref={inputRef} value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} inputMode="url" />
            </label>
            <div>
              <button type="button" className="secondary-button" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
              <button type="submit" className="primary-button">{t("common.confirm")}</button>
            </div>
          </form>
        </div>
      )}

      {dialog?.kind === "image" && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="entry-dialog toolbar-input-dialog image-dialog" role="dialog" aria-modal="true" aria-labelledby="image-dialog-title" onKeyDown={(event) => { if (event.key === "Escape") setDialog(null); }}>
            <h2 id="image-dialog-title">{t("toolbar.imageDialogTitle")}</h2>
            <div className="image-dialog-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={dialog.imageTab !== "url"} className={dialog.imageTab !== "url" ? "active" : ""} onClick={() => setDialog({ ...dialog, imageTab: "upload" })}>{t("toolbar.imageTabUpload")}</button>
              <button type="button" role="tab" aria-selected={dialog.imageTab === "url"} className={dialog.imageTab === "url" ? "active" : ""} onClick={() => setDialog({ ...dialog, imageTab: "url" })}>{t("toolbar.imageTabUrl")}</button>
            </div>
            {dialog.imageTab === "url" ? (
              <form onSubmit={(event) => { event.preventDefault(); submitImageUrl(); }}>
                <label>
                  <span>{t("toolbar.imageField")}</span>
                  <input value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} inputMode="url" autoFocus />
                </label>
                <div>
                  <button type="button" className="secondary-button" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
                  <button type="submit" className="primary-button" disabled={!dialog.value.trim()}>{t("common.confirm")}</button>
                </div>
              </form>
            ) : (
              <div>
                <button type="button" className="upload-file-button" disabled={importing} onClick={() => void browseLocalImage()}>
                  {importing ? t("toolbar.imageImporting") : t("toolbar.imageUploadButton")}
                </button>
                {importError && <p className="search-error">{importError}</p>}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button type="button" className="secondary-button" onClick={() => setDialog(null)}>{t("common.cancel")}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

CSS 附加（加入 `src/styles.css`）：
```css
.tool-button { position: relative; }
.tool-button[data-tooltip]:hover::after,
.tool-button[data-tooltip]:focus-visible::after {
  content: attr(data-tooltip);
  position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  margin-top: 6px; padding: 4px 8px; white-space: nowrap;
  background: #272622; color: #fff; font-size: 10.5px; border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,.18); z-index: 50; pointer-events: none;
}
.image-dialog-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
.image-dialog-tabs button { padding: 8px 4px; border: 0; background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; }
.image-dialog-tabs button.active { color: var(--ink); border-bottom-color: var(--green); font-weight: 600; }
.upload-file-button { width: 100%; padding: 14px; border: 1px dashed var(--line); background: var(--sidebar); border-radius: 6px; color: var(--ink); font-size: 12px; cursor: pointer; }
.upload-file-button:hover:not(:disabled) { border-color: var(--green); background: var(--green-soft); }
.upload-file-button:disabled { opacity: .55; cursor: default; }
```

（`i18n.ts` 需新增 key：`toolbar.imageTabUpload`、`toolbar.imageTabUrl`、`toolbar.imageUploadButton`、`toolbar.imageImporting`，值分別對應「上傳」「連結」「瀏覽本機圖片…」「匯入中…」。）

`EditorPane.tsx` 呼叫端同步修改：
```tsx
<Toolbar editor={editor} workspaceRoot={workspaceRoot} documentRelativePath={document.relativePath} />
```

---

## 2. 修復斜體無作用

### 2.1 變更定位
- Target File: `src/styles.css`
- Target Scope: `:root` 區塊

### 2.2 問題代碼分析
`toggleItalic()` 指令本身正確運作（`StarterKit` 未停用 `italic`，`nodeRegistry.ts` 的 `emphasis` mapping 也正確），問題出在渲染層：
```css
:root {
  font-family: Inter, "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
  ...
  font-synthesis: none;
  ...
}
```
`Inter`、`Noto Sans TC`、微軟正黑體多數字重沒有內建真實斜體字型檔；瀏覽器原本會用 `font-synthesis` 合成傾斜樣式，但 `none` 明確關閉了這個機制，導致 `<em>` 標籤語意存在、`font-style: italic` 也被套用，但畫面上完全看不出差異。

修復規格要求：
1. 將 `font-synthesis: none;` 改為 `font-synthesis: style;`，只允許合成斜體，不合成粗體字重（避免非必要的假粗體）。
2. 不需修改 `pipeline.ts`/`adapter.ts`/`nodeRegistry.ts`，序列化邏輯本身正確。

### 2.3 完整修復代碼
```css
:root {
  font-family: Inter, "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif;
  color: #272622;
  background: #f8f7f3;
  font-synthesis: style;
  text-rendering: optimizeLegibility;
  --paper: #fbfaf7;
  --sidebar: #f1f0eb;
  --line: #deddd6;
  --line-soft: #e9e7e0;
  --ink: #272622;
  --muted: #77746c;
  --green: #1f7357;
  --green-soft: #e0eee7;
  --amber: #a16624;
  --danger: #a9463c;
  --shadow: 0 20px 60px rgba(50, 47, 38, .12);
}
```

---

## 3. 插入圖片：支援本機檔案瀏覽

### 3.1 變更定位
- Target File: `src/services/desktop.ts`（新增函數）
- Target Scope: 新增 `chooseAndImportImage`，並依賴新的 Tauri 指令 `import_image_asset`（需在 Rust 後端補齊，比照現有 `read_workspace_asset` 的路徑防跳出規則）

### 3.2 問題代碼分析
目前 `Toolbar.tsx` 的圖片對話框只有一個文字輸入框：
```tsx
} else if (value) editor.chain().focus().setImage({ src: value }).run();
```
沒有任何 `open()` dialog 呼叫，無法選擇本機檔案；也沒有把選中的檔案複製進 workspace 的機制（區別於純 URL 參考）。

修復規格要求：
1. 新增 TS 包裝函數 `chooseAndImportImage(root, documentRelativePath)`：非 Tauri 環境回傳 `null`（瀏覽器示範模式不支援檔案系統存取，與現有 `importFolder`/`exportWorkspace` 慣例一致）。
2. Tauri 環境呼叫 `@tauri-apps/plugin-dialog` 的 `open()`，`filters` 限定圖片格式。
3. 選中後呼叫 `invoke("import_image_asset", { root, documentRelativePath, sourcePath })`，取得複製後的相對路徑（相對於該文件所在資料夾，格式須與現有 `loadWorkspaceAsset`/markdown 圖片連結解析規則一致）。
4. Rust 端 `import_image_asset` 指令規格（需比照現有 `read_workspace_asset`/`create_entry` 的實作模式新增）：
   - 輸入：`root: String`, `document_relative_path: String`, `source_path: String`
   - 邏輯：正規化並拒絕 `source_path`/`document_relative_path` 中的 `..`、絕對路徑跳出 `root`；目標放在文件所在資料夾下的 `assets/` 子資料夾，若不存在則建立；檔名採 `原始檔名去除非法字元 + "-" + 短 hash/timestamp + 副檔名` 避免覆蓋；以二進位複製（非搬移）來源檔案。
   - 輸出：`{ relativePath: String }`，`relativePath` 為相對於該文件的路徑（例如 `assets/photo-1a2b3c.png`），可直接寫入 markdown `![](assets/photo-1a2b3c.png)`。

### 3.3 完整修復代碼

`src/services/desktop.ts` 新增內容（置於 `importFolder` 函數之後）：
```ts
export interface ImportedImageAsset {
  relativePath: string;
}

export async function chooseAndImportImage(root: string, documentRelativePath: string): Promise<ImportedImageAsset | null> {
  if (!isTauri()) return null;
  const selected = await open({
    multiple: false,
    directory: false,
    title: t("desktop.chooseImage"),
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
  });
  if (typeof selected !== "string") return null;
  return invoke("import_image_asset", { root, documentRelativePath, sourcePath: selected });
}
```

`i18n.ts` 新增 key：`desktop.chooseImage` → 「選擇圖片檔案」。

---

## 4. 已插入圖片的互動功能（說明 / 縮放檢視 / 刪除 / 拖曳 / 調整大小）

### 4.1 變更定位
- Target File: `src/editor/extensions.ts`
- Target Scope: `SafeImage` node spec、`createSafeImageNodeView` 函數
- 連動檔案：`src/components/EditorPane.tsx`（新增 lightbox 覆蓋層）、`src/styles.css`

### 4.2 問題代碼分析
現有 `createSafeImageNodeView` 只處理「遠端圖片阻擋成 placeholder」，沒有任何互動 UI：
```ts
export function createSafeImageNodeView(initialAttributes: SafeImageAttributes) {
  ...
  dom.className = "safe-image-node";
  ...
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  if (title) image.title = title;
  dom.replaceChildren(image);
  ...
}
```
`SafeImage` 也沒有 `width`/`caption` attrs，無法記錄使用者調整過的大小或說明文字；`addNodeView()` 沒有傳入 `getPos`/`view`，無法對文件做刪除、屬性更新等 transaction。

修復規格要求：
1. `SafeImage` 新增 `width`（`string | null`，如 `"60%"`）、`caption`（`string | null`）attrs，並在 `renderHTML` 輸出對應樣式，確保存回 Markdown 時不影響 `markdownSrc` 序列化（`width`/`caption` 需標記 `rendered: false`，避免污染 HTML 輸出，只在 Tiptap JSON 內部使用；若需要持久化到 Markdown，改用 HTML comment attrs 或另建 `imageCaption` block，此處先落地編輯器內互動）。
2. `createSafeImageNodeView` 改為接收 `(node, view, getPos)`，回傳 `<figure>` 結構：`img` + 可選 `figcaption`（contenteditable）+ hover 顯示的 `.image-toolbar`（說明、放大檢視、刪除三個按鈕）+ 右下角 `.image-resize-handle`。
3. 縮放檢視：點擊放大鈕時 `dom.dispatchEvent(new CustomEvent(IMAGE_ZOOM_REQUESTED_EVENT, { bubbles: true, detail: { src, alt } }))`；`EditorPane.tsx` 監聽該事件開啟全螢幕 lightbox。
4. 刪除：直接以 `view.dispatch(view.state.tr.delete(getPos(), getPos() + node.nodeSize))`。
5. 拖曳：`SafeImage` node spec 加 `draggable: true`，nodeView 的 `dom.draggable = true`；ProseMirror 對 `draggable: true` 的節點會自動處理拖曳排序，不需額外邏輯。
6. 調整大小：resize handle 的 `pointerdown` 記錄起始寬度與滑鼠位置，`pointermove` 依編輯區最大寬度（850px）換算百分比，寫回 `width` attr（透過 `view.dispatch` 呼叫 `setNodeAttribute`）；`pointerup` 結束監聽。
7. 說明文字：點擊「說明」按鈕切換 `figcaption` 顯示；`figcaption` 的 `blur` 事件把內容寫回 `caption` attr。

### 4.3 完整修復代碼

`src/editor/extensions.ts` 中 `SafeImage` 與 `createSafeImageNodeView` 整段取代如下：

```ts
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export const IMAGE_ZOOM_REQUESTED_EVENT = "local-md:image-zoom-requested";

function setImageAttribute(view: EditorView, getPos: () => number, patch: Record<string, unknown>) {
  const pos = getPos();
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
}

function deleteImageNode(view: EditorView, getPos: () => number, node: ProseMirrorNode) {
  const pos = getPos();
  view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
}

export function createSafeImageNodeView(node: ProseMirrorNode, view: EditorView, getPos: () => number) {
  let attributes = node.attrs as SafeImageAttributes;
  let remoteLoaded = false;
  let showCaptionInput = Boolean(attributes.caption);
  let resizing = false;

  const figure = document.createElement("figure");
  figure.className = "safe-image-node";
  figure.setAttribute("contenteditable", "false");
  figure.draggable = true;

  const mediaWrap = document.createElement("div");
  mediaWrap.className = "safe-image-media";

  const toolbar = document.createElement("div");
  toolbar.className = "image-toolbar";

  const captionButton = document.createElement("button");
  captionButton.type = "button";
  captionButton.className = "image-toolbar-btn";
  captionButton.title = t("image.toggleCaption");
  captionButton.textContent = t("image.toggleCaptionShort");

  const zoomButton = document.createElement("button");
  zoomButton.type = "button";
  zoomButton.className = "image-toolbar-btn";
  zoomButton.title = t("image.zoom");
  zoomButton.textContent = t("image.zoomShort");

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "image-toolbar-btn image-toolbar-danger";
  deleteButton.title = t("image.delete");
  deleteButton.textContent = t("image.deleteShort");

  toolbar.append(captionButton, zoomButton, deleteButton);

  const resizeHandle = document.createElement("span");
  resizeHandle.className = "image-resize-handle";
  resizeHandle.setAttribute("aria-hidden", "true");

  const figcaption = document.createElement("figcaption");
  figcaption.contentEditable = "true";
  figcaption.className = "image-caption";
  figcaption.setAttribute("data-placeholder", t("image.captionPlaceholder"));

  const render = () => {
    const source = imageSource(attributes);
    const src = String(attributes.src ?? source);
    const alt = imageAlt(attributes);
    const title = typeof attributes.title === "string" ? attributes.title : "";
    const width = typeof attributes.width === "string" ? attributes.width : null;
    figure.style.width = width ?? "";

    if (isRemoteImageSource(source) && !remoteLoaded) {
      mediaWrap.className = "remote-image-placeholder";
      mediaWrap.setAttribute("role", "button");
      mediaWrap.setAttribute("tabindex", "0");
      mediaWrap.setAttribute("data-remote-src", source);
      mediaWrap.setAttribute("aria-label", t("image.remoteBlockedAria", { source: alt || source }));
      mediaWrap.replaceChildren(document.createTextNode(t("image.remoteBlocked", { source: alt || source })));
      figure.replaceChildren(mediaWrap);
      return;
    }

    mediaWrap.className = "safe-image-media";
    mediaWrap.removeAttribute("role");
    mediaWrap.removeAttribute("tabindex");
    mediaWrap.removeAttribute("data-remote-src");
    mediaWrap.removeAttribute("aria-label");
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt;
    if (title) image.title = title;
    mediaWrap.replaceChildren(image, resizeHandle);

    figcaption.textContent = typeof attributes.caption === "string" ? attributes.caption : "";
    figure.replaceChildren(mediaWrap, toolbar, ...(showCaptionInput ? [figcaption] : []));
  };

  const loadRemote = () => {
    if (!isRemoteImageSource(imageSource(attributes)) || remoteLoaded) return;
    remoteLoaded = true;
    render();
  };
  mediaWrap.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".remote-image-placeholder")) loadRemote();
  });
  mediaWrap.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    loadRemote();
  });

  captionButton.addEventListener("click", () => {
    showCaptionInput = !showCaptionInput;
    render();
    if (showCaptionInput) window.requestAnimationFrame(() => figcaption.focus());
  });
  figcaption.addEventListener("blur", () => {
    setImageAttribute(view, getPos, { caption: figcaption.textContent?.trim() || null });
  });

  zoomButton.addEventListener("click", () => {
    const source = imageSource(attributes);
    figure.dispatchEvent(new CustomEvent(IMAGE_ZOOM_REQUESTED_EVENT, {
      bubbles: true,
      detail: { src: String(attributes.src ?? source), alt: imageAlt(attributes) },
    }));
  });

  deleteButton.addEventListener("click", () => deleteImageNode(view, getPos, node));

  const onResizePointerDown = (event: PointerEvent) => {
    event.preventDefault();
    resizing = true;
    const startX = event.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const editorMaxWidth = 850;
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextPx = Math.max(80, Math.min(editorMaxWidth, startWidth + delta));
      const percent = Math.round((nextPx / editorMaxWidth) * 1000) / 10;
      figure.style.width = `${percent}%`;
    };
    const finish = () => {
      resizing = false;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      setImageAttribute(view, getPos, { width: figure.style.width || null });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish, { once: true });
  };
  resizeHandle.addEventListener("pointerdown", onResizePointerDown);

  render();

  return {
    dom: figure,
    update(nextNode: ProseMirrorNode) {
      if (nextNode.type !== node.type) return false;
      attributes = nextNode.attrs as SafeImageAttributes;
      if (!resizing) render();
      return true;
    },
    stopEvent(event: Event) {
      return event.type.startsWith("drag") ? false : figcaption.contains(event.target as Node);
    },
    destroy() {
      resizeHandle.removeEventListener("pointerdown", onResizePointerDown);
    },
  };
}

export const SafeImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownSrc: { default: null, rendered: false },
      width: { default: null, rendered: false },
      caption: { default: null, rendered: false },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const src = imageSource(node.attrs);
    if (isRemoteImageSource(src)) {
      return ["span", {
        class: "remote-image-placeholder",
        "data-remote-src": src,
        role: "button",
        tabindex: "0",
        "aria-label": t("image.remoteBlockedAria", { source: String(HTMLAttributes.alt ?? src) }),
      }, t("image.remoteBlocked", { source: String(HTMLAttributes.alt || src) })];
    }
    return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },
  addNodeView() {
    return ({ node, view, getPos }) => createSafeImageNodeView(node, view, getPos as () => number);
  },
});
```

`EditorPane.tsx` 新增 lightbox（於既有 `pendingLink` 覆蓋層之後追加）：
```tsx
import { IMAGE_ZOOM_REQUESTED_EVENT } from "../editor/extensions";

// 在 EditorPane 內部新增狀態
const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);

useEffect(() => {
  if (!editor || editor.isDestroyed) return;
  const editorElement = editor.view.dom;
  const onZoom = (event: Event) => {
    const detail = (event as CustomEvent<{ src: string; alt: string }>).detail;
    if (detail?.src) setZoomedImage(detail);
  };
  editorElement.addEventListener(IMAGE_ZOOM_REQUESTED_EVENT, onZoom);
  return () => editorElement.removeEventListener(IMAGE_ZOOM_REQUESTED_EVENT, onZoom);
}, [editor]);

// 在既有 return 的最外層 <div className="editor-pane"> 內、pendingLink 區塊之後加入：
{zoomedImage && (
  <div className="image-lightbox-backdrop" role="presentation" onMouseDown={() => setZoomedImage(null)}>
    <img className="image-lightbox-img" src={zoomedImage.src} alt={zoomedImage.alt} />
  </div>
)}
```

`src/styles.css` 新增：
```css
.safe-image-node { position: relative; display: block; margin: 1.2em auto; max-width: 100%; }
.safe-image-media { position: relative; display: block; }
.safe-image-media img { display: block; width: 100%; border-radius: 4px; }
.image-toolbar { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; padding: 3px; background: rgba(39,38,34,.82); border-radius: 6px; opacity: 0; transition: opacity .12s ease; }
.safe-image-node:hover .image-toolbar, .safe-image-node:focus-within .image-toolbar { opacity: 1; }
.image-toolbar-btn { padding: 5px 7px; border: 0; background: transparent; color: #fff; font-size: 11px; border-radius: 4px; cursor: pointer; }
.image-toolbar-btn:hover { background: rgba(255,255,255,.18); }
.image-toolbar-danger:hover { background: var(--danger); }
.image-resize-handle { position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; background: var(--green); border: 2px solid #fff; border-radius: 50%; cursor: nwse-resize; }
.image-caption { margin-top: 6px; padding: 4px 2px; text-align: center; color: var(--muted); font-size: 11.5px; outline: none; }
.image-caption:empty::before { content: attr(data-placeholder); color: #b3b0a6; }
.image-lightbox-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 40px; background: rgba(20,19,16,.86); cursor: zoom-out; }
.image-lightbox-img { max-width: 92vw; max-height: 92vh; border-radius: 6px; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
```

`i18n.ts` 新增 key：`image.toggleCaption`（說明）、`image.toggleCaptionShort`（說明）、`image.zoom`（放大檢視）、`image.zoomShort`（放大）、`image.delete`（刪除圖片）、`image.deleteShort`（刪除）、`image.captionPlaceholder`（新增說明文字…）。

---

## 5. Topbar / 分頁列 UI 溢出修復

### 5.1 變更定位
- Target File: `src/styles.css`
- Target Scope: `.topbar`、`.breadcrumbs`、`.topbar-actions`、`.tabs`

### 5.2 問題代碼分析
```css
.topbar { height: 58px; padding: 0 15px 0 19px; display: flex; align-items: center; justify-content: space-between; gap: 20px; ... }
.breadcrumbs { min-width: 0; flex: 1; align-self: stretch; display: flex; align-items: center; color: var(--muted); font-size: 11.5px; cursor: default; }
.breadcrumbs span { display: flex; align-items: center; white-space: nowrap; }
.breadcrumbs span:last-child { color: var(--ink); font-weight: 600; }
.topbar-actions { display: flex; align-items: center; gap: 2px; }
```
`.breadcrumbs` 本身有 `min-width: 0` 可收縮，但其子項 `.breadcrumbs span`（尤其 `:last-child` 顯示目前檔名）沒有 `min-width: 0`/`overflow: hidden`，`white-space: nowrap` 讓長檔名（如圖 2 的 `03_Network_Security.md`）撐開整個 flex 容器寬度；`.topbar-actions` 沒有 `flex-shrink: 0`/`min-width`，在空間不足時與麵包屑、收合鈕、設定齒輪一起被擠壓重疊，對應圖 2 紅框處。

### 5.3 完整修復代碼
```css
.topbar { height: 58px; flex: 0 0 58px; padding: 0 15px 0 19px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); background: rgba(251,250,247,.96); user-select: none; overflow: hidden; }
.breadcrumbs { min-width: 0; flex: 1 1 auto; align-self: stretch; display: flex; align-items: center; color: var(--muted); font-size: 11.5px; cursor: default; overflow: hidden; }
.breadcrumbs > svg { width: 15px; margin: 0 8px; color: var(--green); flex: 0 0 auto; }
.breadcrumbs span { min-width: 0; display: flex; align-items: center; white-space: nowrap; overflow: hidden; }
.breadcrumbs span:last-child { min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; color: var(--ink); font-weight: 600; }
.breadcrumbs span svg { width: 12px; margin: 0 5px; color: #aaa69c; flex: 0 0 auto; }
.topbar-actions { flex: 0 0 auto; min-width: 0; display: flex; align-items: center; gap: 2px; }
.tabs { height: 37px; flex: 0 0 37px; display: flex; overflow: hidden; min-width: 0; border-bottom: 1px solid var(--line); background: #f4f3ee; }
.tabs-scroll { min-width: 0; flex: 1 1 auto; display: flex; overflow-x: auto; scrollbar-width: thin; }
.tab-bulk-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 3px; padding: 0 7px; border-left: 1px solid var(--line); background: #eeede7; box-shadow: -6px 0 12px rgba(50,47,40,.04); }
```

驗證要點：中間文件麵包屑名稱過長時應以 `…` 截斷而非撐開版面；`topbar-actions`（分頁切換、收合、設定）在任何視窗寬度下維持固定寬度且不被覆蓋；分頁列在分頁數量過多時可水平捲動但右側「＋群組／關閉其他／全部關閉」永遠可見不被推出可視範圍。
