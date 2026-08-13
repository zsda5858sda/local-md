<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# 在我給你的檔案中有一份這個專案的code review，請你幫我檢查P2部分的重構有沒有問題

我檢查了 `local-md_code_review_report.md` 中的 P2 章節（P2-1～P2-5），並對照實際程式碼（`App.tsx`、`useDocuments.ts`、`useSaveConflict.ts`、`useWorkspace.ts`、`nodeRegistry.ts`、`panelLimits.ts`、`Sidebar.tsx`）逐項核對。**多數 P2 項目已正確落實，但 P2-2（儲存狀態機收斂成 reducer）引入了一個會讓「儲存衝突」永遠卡在 saving 狀態、UI 也不會出現的實質性回歸 bug**，需要優先修正。

## P2-2：Reducer 收斂有 Bug（需修正）

`useDocuments.ts` 的 `documentReducer` 把 `EXTERNAL_CHANGE` 與 `SAVE_CONFLICT` 兩種 action 共用同一段 fallthrough 邏輯，開頭的守衛判斷是：

```ts
const disk = action.disk;
if (document.hash === disk.hash || document.saving) return document;   // ← 問題點
if (action.type === "EXTERNAL_CHANGE" && !document.dirty) { ... }
const classification = classifySaveConflict(...);
// ...才會寫入 conflict 欄位
```

問題在於：`persist()`（`useDocuments.ts`）在真正發生儲存衝突時的流程是：

1. `dispatch({ type: "SAVE_STARTED", id })` → `saving: true`
2. `saveDocument()` 拋出 `Conflict` 錯誤
3. `catch` 裡直接 `dispatch({ type: "SAVE_CONFLICT", id, disk })`，**中間沒有任何動作把 `saving` 設回 `false`**

於是 `SAVE_CONFLICT` 進到 reducer 時，`document.saving` 仍是 `true`，守衛 `|| document.saving` 直接 `return document`（不變），導致：

- `conflict` 欄位永遠不會被寫入 → 衝突解決 UI（重新載入磁碟版本/覆寫等）永遠不會出現。
- `saving` 永遠卡在 `true` → 儲存按鈕/spinner 會一直顯示「儲存中」，使用者以為系統卡死。
- `persist()` 裡本地算好的 `classification`（`already-saved` / `stale-hash` / `external-change`）只被用來決定是否要重跑自動儲存，**實際的狀態更新從未發生**，等於整段判斷邏輯被靜默丟棄。

值得注意的是，同一個 `catch` 區塊裡「非衝突錯誤」分支反而有手動補一次 `dispatch({ type: "UPDATE_DOCUMENTS", update: ... saving:false ... })` 來重設 `saving`，證明作者其實知道要重設，只是漏了 `Conflict` 這條路徑。這正是 P0-2 想避免的「分散邏輯各自為政」的翻版——收斂成 reducer 反而在共用 guard 時踩到自己的假設。

**建議修正**：在 fallthrough 前為 `SAVE_CONFLICT` 加一個明確分支，不要讓它經過 `document.saving` 守衛：

```ts
if (action.type === "SAVE_CONFLICT") {
  return { ...document, saving: false, conflict: { diskHash: action.disk.hash, diskContent: action.disk.content } };
}
```

（`document.saving` 這個守衛應該只保護 `EXTERNAL_CHANGE`：避免 watcher 通知與正在進行的儲存互相打架；`SAVE_CONFLICT` 本身就是「這次儲存已經結束（失敗）」的訊號，不該再被 saving 擋住。）[^1][^2]

## P2-1：App.tsx 拆分 Hook — 已落實

實際拆出的 hook 與報告建議的對照表幾乎一致：


| 建議 Hook | 實際狀況 |
| :-- | :-- |
| `useWorkspace()` | 存在，管理 workspaceRoot/tree/settings，另外加了 `useWorkspaceWatcher` 處理檔案監控 |
| `useDocuments()` | 存在，含 `documentReducer`、`closeTab`/`closeTabs` |
| `useSaveConflict()` | 存在，包裝 `saveConflict`/`externalChange`/`reloadFromDisk` 三個 dispatch 動作 |
| `useTabGroups()` | 存在，群組增刪、拖拉排序、命名邏輯都在裡面 |
| `useWorkspaceSearch()` | 存在，含索引、搜尋、取代邏輯 |

`App.tsx` 目前確實只組裝這些 hook 的回傳值，符合「只保留 JSX 組裝」的目標。[^3][^4][^5][^6][^7][^1]

## P2-3 與 P2-5：資料驅動化、Prop 收斂 — 已落實

`nodeRegistry.ts` 建立了單一 `NODE_REGISTRY`（含 `toTiptap`/`toMdast`/`supported`），`adapter.ts`、`allowlist.ts`（透過 `isSupportedMdastNode`）、`pipeline.ts`（透過 `isRegisteredTiptapNode`）都改為查表，不再各自寫 switch，完全符合建議的方向。[^8][^9][^10]

P2-5 提到的兩個痛點也都有對應解法：`Sidebar.tsx` 把搜尋相關的一大堆 props 收斂進單一 `SearchProps` 物件；`useWorkspace.ts` 新增了 `withWorkspace()` 高階函式，把「`if (!workspaceRoot) return`」的重複守衛收斂成一個包裝器，可以讓 `App.tsx` 裡的 handler 少寫很多次判斷。[^5][^11]

## P2-4：規則共用 — 前端可驗證、後端無法確認

前端部分做得到位：`shared/panel-limits.json` 定義單一數值來源，`panelLimits.ts` 直接 import 使用；另外 `shared/encoding-vectors.json` 也確實存在，對應報告建議的「前後端共用編碼測試向量」。[^12][^13]

但 Rust 後端（`normalize_settings`、編碼偵測相關邏輯，應該在 `src-tauri/src/lib.rs`）並未出現在目前提供的專案檔案清單中，我無法確認後端是否真的讀取同一份 JSON、或是否已補上前後端數值一致的單元測試斷言。建議你確認一下 `lib.rs` 是否已經同步這兩份 shared 檔案，這部分暫時無法從現有資料判斷完成度。

**總結**：P2-1、P2-3、P2-5 的重構方向與實作都符合報告建議；P2-4 前端已做、後端待確認；**P2-2 是這次 P2 重構裡唯一發現的實質 bug**，會導致真正的儲存衝突（多裝置/多視窗同時編輯同一檔案時最容易觸發）永遠無法在 UI 上呈現，屬於應該優先補的回歸。
<span style="display:none">[^14][^15]</span>

<div align="center">⁂</div>

[^1]: src/hooks/useDocuments.ts

[^2]: local-md_code_review_report.md

[^3]: src/App.tsx

[^4]: src/hooks/useSaveConflict.ts

[^5]: src/hooks/useWorkspace.ts

[^6]: src/hooks/useTabGroups.ts

[^7]: src/hooks/useWorkspaceSearch.ts

[^8]: src/markdown/nodeRegistry.ts

[^9]: src/markdown/allowlist.ts

[^10]: src/markdown/pipeline.ts

[^11]: src/components/Sidebar.tsx

[^12]: shared/panel-limits.json

[^13]: src/services/panelLimits.ts

[^14]: src/markdown/adapter.ts

[^15]: src/services/saveState.ts

