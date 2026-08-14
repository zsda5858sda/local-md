<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# 目前還可以優化的項目清單

以下整理成三類：上一輪規劃但還沒動工的**表格 UX 優化**、原始 code review 報告裡**P3 潤飾項目**（優先度最低但一直沒處理）、以及**尚待確認**的部分。

## 表格 UX 優化（上一輪規劃，尚未實作）

- **欄寬拖曳視覺化**：`EditorPane.tsx` 已設定 `Table.configure({ resizable: true })`，但 `styles.css` 還沒補上 Tiptap resizable table 需要的 `.tableWrapper`／`.column-resize-handle`／`.resize-cursor` 樣式，拖曳手把目前看不到、也可能拖不動。
- **列高調整**：表格儲存格目前沿用一般段落的 `line-height: 1.85`，需要針對 `.ProseMirror td p, .ProseMirror th p` 另外設定較緊湊的行高與 padding，做出「比文字高約 0.5 公分」的效果。
- **新增/刪除列、欄的 UI**：`Toolbar.tsx` 目前只有「插入 3×3 表格」一顆按鈕，Tiptap 內建的 `addRowBefore/After`、`deleteRow`、`addColumnBefore/After`、`deleteColumn` 指令都還沒有任何按鈕或選單呼叫，需要新增一個仿 Notion 風格的 hover 浮現控制元件（`TableControls.tsx`）。
- **欄寬持久化（待決策）**：目前欄寬即使做出拖曳功能，也只會存在編輯器 session 內，關檔重開會重置。需要你決定要不要把欄寬資訊寫回 Markdown（例如用 `<!--colwidths:...-->` 之類的相容區塊保存），還是接受「session 內可調」的簡化版本。


## Code Review 報告 P3 項目（優先度最低，一直未處理）

- **`window.prompt()` 體驗不一致**：`Toolbar.tsx` 插入連結／插入圖片目前用瀏覽器原生 `window.prompt()`，跟其他自訂 UI 風格不一致，建議改成應用內自訂 Modal。
- **快捷鍵判斷用長串 if/Set**：`keyboardShortcuts.ts` 目前是一長串條件判斷，建議改成宣告式的 `Map<string, ShortcutAction>` 對照表，較好維護與測試。
- **大量型別斷言 `as unknown as X`**：`adapter.ts`、`pipeline.ts` 裡有不少型別繞過寫法，建議改寫成自訂 type guard 函式，避免繞過 TypeScript 型別檢查。
- **Regex 未快取**：Rust `lib.rs` 的 `read_workspace_asset`／`scan_orphan_assets` 每次呼叫都重新建構 Regex，建議用 `once_cell::sync::Lazy` 包成靜態常數，減少重複編譯開銷。
- **全域中文硬編碼**：目前所有 UI 文字都直接寫死中文，建議抽出成 i18n key，即使現階段只支援中文，也方便未來擴充其他語言。
- **自動儲存立即補跑邏輯**：`App.tsx`／`useDocuments.ts` 的 `persist()` 儲存成功後用 `setTimeout(0)` 立即補跑下一次自動儲存，繞過了 `scheduleSave` 原本的 debounce 機制，建議統一走 debounce 流程。


## 尚待確認的部分

- **Rust 後端編碼測試**：前端 `tests/services.test.ts` 已經用 `shared/encoding-vectors.json` 驗證了 `decodeFile`，但 Rust 後端（`detect_and_decode`）是否也有對應的單元測試跑同一份共用向量，目前還沒看到 `lib.rs` 裡的測試模組，需要你確認。
- **`withWorkspace()` 實際使用範圍**：`useWorkspace.ts` 已經提供了收斂 `if (!workspaceRoot) return` 判斷的高階函式，但 `App.tsx` 裡實際包了多少個 handler、還剩多少重複判斷，之前受限於檔案篇幅沒有逐一核對完，如果你要徹底解決 P2-5 的「重複守衛」問題，值得整份 `App.tsx` 再過一輪。

建議優先順序：**表格 UX 優化**（你剛提出、使用頻率高）→ **自動儲存 debounce 修正**（跟儲存邏輯相關，風險等級稍高於其他 P3）→ 其餘 P3 潤飾項目可以之後順手處理，不急。

