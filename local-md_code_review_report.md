# Local MD 專案審核報告
**審核角色**：系統最終規劃與架構審核設計師
**審核範圍**：`zsda5858sda/local-md`（Tauri + React + TypeScript 前端／Rust 後端）
**審核日期**：2026-08-12

---

## 使用說明

本報告依「使用者資料安全與信任 > 功能正確性 > 架構健康度 > UX/一致性」原則排序。每一項問題附上：**問題描述、影響範圍、根本原因、具體修改建議**。建議依 P0 → P3 順序處理，P0/P1 修正時應順勢把邏輯抽成可測試的獨立函式，不需等到 P2 大重構才處理架構。

---

## P0｜資料完整性與信任問題（必須立即修正）

### P0-1：取消刪除分頁群組，群組仍被刪除

- **位置**：`App.tsx` → `deleteTabGroup()`
- **問題**：`deleteTabGroup` 呼叫 `closeTabs(ids)` 後，不論使用者在 `window.confirm` 對話框按下「取消」與否，都會無條件執行 `removeTabGroup(groupId)`。`closeTabs` 在使用者取消時會 `return`，但呼叫端沒有檢查這個結果，導致分頁沒被關閉、但群組定義與 `tabAssignments` 已被清空——使用者的選擇被忽略。
- **根本原因**：`closeTabs` 是「有副作用但不回報是否真的執行」的函式（回傳值是 `void`）。
- **修改建議**：
  1. 把 `closeTabs` 改成回傳 `boolean`（是否真的關閉了），取消時回傳 `false`。
  2. `deleteTabGroup` 改為：
     ```ts
     const deleteTabGroup = (groupId: string) => {
       const ids = documentsRef.current
         .filter((doc) => settings.ui.tabAssignments[doc.relativePath] === groupId)
         .map((doc) => doc.id);
       const closed = closeTabs(ids); // 現在回傳 boolean
       if (!closed) return; // 使用者取消，不刪除群組
       removeTabGroup(groupId);
       setGroupMenu(null);
     };
     ```
  3. 同時檢查 `closeTabGroup`（只關閉、不刪除群組的版本）是否有類似的「忽略取消結果」問題，一併修正。

### P0-2：儲存衝突偵測依賴錯誤訊息字串比對

- **位置**：`App.tsx` → `persist()` 的 `catch` 區塊，判斷條件 `message.includes("CONFLICT")`
- **問題**：前端用字串包含關係判斷是否為儲存衝突，這個字串來自 Rust 後端 `verify_expected` 回傳的 `"CONFLICT: 磁碟版本已變更…"`。只要後端錯誤訊息格式、語言、或未來 i18n 化，這個判斷就會整組失效，衝突保護機制（app 的核心賣點）會悄悄失效而不自知。
- **修改建議**：
  1. **後端**：把 Rust 端的錯誤從單純 `String` 改為結構化錯誤 enum，序列化時附帶明確的 `kind` 欄位：
     ```rust
     #[derive(Serialize)]
     #[serde(tag = "kind")]
     enum SaveError {
       Conflict { expected: Option<String>, actual: Option<String> },
       Io { message: String },
       Encoding { message: String },
     }
     ```
     所有 `#[tauri::command]` 回傳 `Result<T, SaveError>` 而非 `Result<T, String>`。
  2. **前端**：`saveDocument` 的 catch 改為檢查 `error.kind === "Conflict"`，不再比對字串內容：
     ```ts
     } catch (error) {
       if (isSaveError(error) && error.kind === "Conflict") { /* 走衝突流程 */ }
       else { /* 一般錯誤 */ }
     }
     ```
  3. 若短期內不想動後端介面，至少把字串比對改成比對一個**不會 i18n 化的固定前綴常數**（如 `ERROR_CODE_CONFLICT`），並在前後端各定義一次同名常數，降低漂移風險。

### P0-3：重新命名未過濾路徑分隔字元

- **位置**：`App.tsx` → `submitEntryDialog()`（rename 分支）
- **問題**：只檢查名稱是否為空或與原名相同，沒有阻擋 `/`、`\`、`:` 等字元。使用者若在重新命名輸入框誤打 `abc/def`，會因為 `[parentPath, targetName].join("/")` 拼接路徑而建立非預期的巢狀路徑。
- **修改建議**：
  ```ts
  const INVALID_NAME = /[\\/:*?"<>|]/;
  if (INVALID_NAME.test(raw)) {
    setFatalError("名稱不能包含 / \\ : * ? \" < > | 等字元");
    return;
  }
  ```
  建議把這段驗證抽成 `validateEntryName(raw: string): string | null`，回傳錯誤訊息或 `null`，方便在 `create-file`／`create-directory`／`rename` 三個分支共用。

---

## P1｜安全性強化（應盡快處理）

### P1-1：HTML 清洗採用黑名單正規表達式，容易被繞過

- **位置**：`allowlist.ts`（`validateAndPreserve`）、`EditorPane.tsx`（`handlePaste`）
- **問題**：用 `/<\s*(script|iframe)\b|\bon\w+\s*=|javascript:/i` 判斷「危險 HTML」，屬於黑名單式偵測，容易被 `<svg onload=..>`、`data:` URI 內嵌 SVG 腳本、大小寫混淆等方式繞過。
- **修改建議**：
  1. 引入成熟的 HTML sanitizer（如 `DOMPurify`），採用**白名單**而非黑名單模式：只允許 `b/i/u/strong/em/code/pre` 等固定標籤與 `href/src/alt/title` 等固定屬性，其餘一律剝除。
  2. `allowlist.ts` 的 `dangerous` 判斷改為：先用 sanitizer 清洗一份，再比對清洗前後是否有差異，有差異就視為「含不安全內容」，比正規表達式判斷更可靠。
  3. `EditorPane.tsx` 的 `handlePaste` 同樣改用 sanitizer 清洗整段貼上的 HTML，而不是只在符合黑名單時才攔截，其餘情況交給 Tiptap 預設處理。

### P1-2：本機圖片副檔名檢查未驗證檔案內容（magic bytes）

- **位置**：Rust `lib.rs` → `read_workspace_asset()`
- **問題**：只憑副檔名判斷 MIME type，沒有檢查檔案實際內容是否為對應格式的圖片。
- **修改建議**：
  ```rust
  fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
      match bytes {
          [0x89, 0x50, 0x4E, 0x47, ..] => Some("image/png"),
          [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
          [0x47, 0x49, 0x46, 0x38, ..] => Some("image/gif"),
          b if b.starts_with(b"RIFF") && b[8..12] == *b"WEBP" => Some("image/webp"),
          [0x42, 0x4D, ..] => Some("image/bmp"),
          _ => None,
      }
  }
  ```
  讀檔後用 `sniff_image_mime` 驗證，副檔名與內容不符時拒絕回傳，並記錄警告。

### P1-3：Markdown/圖片讀取無檔案大小上限

- **位置**：Rust `lib.rs` → `read_markdown()`
- **問題**：未限制讀取檔案大小，異常大檔案可能造成 UI 凍結。`read_workspace_asset` 有 20MB 限制但是在讀完之後才檢查，等於已經浪費了 I/O。
- **修改建議**：
  ```rust
  const MAX_MARKDOWN_BYTES: u64 = 20 * 1024 * 1024;
  let metadata = fs::metadata(&path).map_err(...)?;
  if metadata.len() > MAX_MARKDOWN_BYTES {
      return Err(format!("檔案超過 {}MB 限制，請使用其他工具開啟", MAX_MARKDOWN_BYTES / 1024 / 1024));
  }
  ```
  圖片同理，把大小檢查移到 `fs::read` **之前**（用 `fs::metadata` 先看檔案大小）。

---

## P2｜架構重構（功能穩定後排時間處理）

### P2-1：`App.tsx` 巨石元件拆分

- **問題**：單一元件內含 20+ `useState`、7 個 `useRef`、數十個 handler，橫跨工作區、分頁、搜尋、儲存、拖拉、對話框等職責。
- **修改建議**：拆成以下自訂 hook，`App.tsx` 只保留 JSX 組裝：
  | Hook | 負責範圍 |
  |---|---|
  | `useWorkspace()` | workspaceRoot、tree、settings 讀寫、`watchWorkspace` |
  | `useDocuments()` | documents 陣列、開檔/關檔、`persist`/`scheduleSave` |
  | `useSaveConflict()` | 衝突分類與解決（見 P2-2） |
  | `useTabGroups()` | tabGroups、拖拉排序、群組選單 |
  | `useWorkspaceSearch()` | searchQuery/searchHits/replaceAll |

### P2-2：文件儲存狀態機收斂成 reducer

- **問題**：`classifySaveConflict` 的判斷結果在 `persist()` 的 catch 分支、workspace watcher 的 `routeChanges`、`handleReplaceAll` 三處各自重寫一次「怎麼更新 document」的邏輯，容易顧此失彼（P0-2 的 bug 正是這種分散邏輯的產物）。
- **修改建議**：定義明確 action 型別，用 `useReducer` 收斂：
  ```ts
  type DocAction =
    | { type: "SAVE_SUCCESS"; id: string; result: SaveResult }
    | { type: "SAVE_CONFLICT"; id: string; disk: DiskDocument }
    | { type: "EXTERNAL_CHANGE"; id: string; disk: DiskDocument }
    | { type: "RELOAD_FROM_DISK"; id: string; disk: DiskDocument };
  ```
  三處呼叫點都改成 `dispatch(action)`，衝突分類邏輯只寫一次在 reducer 裡。

### P2-3：Markdown 轉換層資料驅動化

- **問題**：`adapter.ts`（mdast↔tiptap）與 `allowlist.ts`（白名單）各自定義重疊的 `MdNode` 型別，新增一種語法需同時改 4 個檔案（`adapter.ts` 兩個方向、`allowlist.ts`、`pipeline.ts`）。
- **修改建議**：建立單一設定表，例如：
  ```ts
  const NODE_REGISTRY: Record<string, NodeSpec> = {
    heading: { supported: true, toTiptap: ..., toMdast: ... },
    footnote: { supported: false, reason: "尚未支援" },
    // ...
  };
  ```
  `adapter.ts`、`allowlist.ts`、`pipeline.ts` 都改為查表，而非各自寫 `switch`。

### P2-4：前後端規則重複（面板寬度、編碼偵測）

- **問題**：Sidebar/Properties 面板寬度上下限（224–420、240–480）同時寫在前端 `clamp()` 呼叫與 Rust `normalize_settings`；編碼偵測前端用 `chardet+iconv-lite`、後端用 `chardetng+encoding_rs`，兩套獨立實作。
- **修改建議**：
  1. 面板寬度：把數值定義成單一 JSON schema（例如 `panel-limits.json`），前端直接 import，後端透過 build script 或手動同步時加上單元測試斷言兩邊數值一致。
  2. 編碼偵測：至少建立一組共用測試向量（Big5/GBK/Shift_JIS 範例檔案），前後端各自跑一次，CI 斷言輸出的 `encoding`/`eol`/`bom` 完全一致，避免行為隨套件升級而分裂。

### P2-5：Prop drilling 與重複守衛

- **問題**：`Sidebar.tsx` 接收 20+ props；`App.tsx` 幾乎每個 handler 開頭都是 `if (!workspaceRoot) return;`。
- **修改建議**：搜尋相關 props 收斂成一個 `search: SearchProps` 物件傳入 `Sidebar`；`workspaceRoot` 判斷可透過 Context 或讓相關 handler 只在工作區存在時才建立（例如包在 `useMemo`/`useCallback` 外層一次性判斷），減少重複判斷散落各處。

---

## P3｜一致性與潤飾（優先度最低，可隨手改善）

| 項目 | 位置 | 建議 |
|---|---|---|
| `window.prompt()` 體驗不一致 | `Toolbar.tsx`（插入連結/圖片） | 改用應用內自訂 Modal，統一視覺風格 |
| 快捷鍵判斷用長串 if/Set | `keyboardShortcuts.ts` | 改為宣告式 `Map<string, ShortcutAction>` 對照表 |
| 大量型別斷言 `as unknown as X` | `adapter.ts`、`pipeline.ts` | 改寫為自訂 type guard 函式，避免繞過型別檢查 |
| Regex 未快取 | Rust `lib.rs`（`read_workspace_asset`、`scan_orphan_assets`） | 用 `once_cell::sync::Lazy` 包成靜態常數 |
| 全域中文硬編碼 | 所有 UI 元件 | 抽出 i18n key，即使目前只支援中文，也方便未來擴充 |
| 自動儲存立即補跑 | `App.tsx` → `persist()` | 補跑邏輯應重新走 `scheduleSave` 的 debounce，而非 `setTimeout(0)` 立即觸發 |

---

## 建議執行時間軸

1. **本週**：P0-1、P0-2、P0-3（皆為局部修改，預估每項 0.5–1 天，含測試）
2. **下週**：P1-1～P1-3（安全強化，P1-1 需要引入新依賴 `dompurify`，需評估 bundle size 影響）
3. **功能穩定後排一個獨立 sprint**：P2 全部（架構重構，建議搭配 App.tsx 拆分前後的手動回歸測試清單）
4. **穿插在日常開發中**：P3（不需要專門排時間，遇到相關檔案時順手改）
