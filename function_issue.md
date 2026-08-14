<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# 測試發現的問題清單

## 表格

| 項目 | 內容 |
| :-- | :-- |
| 問題 | 儲存格內有多個段落（使用者在格子裡按 Enter 換行）時，第二段之後的內容會在存檔時被靜默丟棄 |
| 位置 | `src/markdown/nodeRegistry.ts` → `table.toMdast`，`children: context.inline(cell.content?.[0]?.content)` 只取 `content[0]` |
| 重現步驟 | 插入表格 → 在任一格子打字 → 按 Enter 換行再打第二行 → 儲存 → 重新開啟文件 |
| 影響 | 資料遺失，且無任何警告或相容模式提示，屬於嚴重問題（等級接近 P0） |
| 建議修法 | `toMdast` 應轉出儲存格內所有段落，或偵測到多段落時觸發相容模式提示，而非默默截斷 |

## 超連結（搭配其他格式時）

| 項目 | 內容 |
| :-- | :-- |
| 問題 | 文字同時套用「粗體/斜體」+「行內程式碼」+「連結」時，儲存後粗體/斜體會消失，只留下 code + link |
| 位置 | `src/markdown/adapter.ts` → `withMarks()`，marks 依字母順序套用，`MARK_TO_MDAST.code` 無條件忽略傳入的 `current`，直接用原始文字重建 `inlineCode` |
| 重現步驟 | 選取文字 → 同時套用粗體＋行內程式碼＋連結 → 儲存文件 |
| 驗證方式 | 已用程式模擬轉換邏輯確認：`bold+code` → 只剩 `inlineCode`；`bold+code+link` → 只剩 `link` 包 `inlineCode`，粗體不見 |
| 影響 | 格式跑掉（非資料遺失），屬於中等問題 |
| 建議修法 | `code` 轉換函式不該丟棄 `current`；或在 `allowlist.ts` 加規則，偵測此組合時觸發相容模式提示 |

## 圖片

| 項目 | 內容 |
| :-- | :-- |
| 問題 | 工具列提示文字寫「遠端圖片預設不載入」，但實際上遠端圖片（`https://...`）仍會被瀏覽器直接發出網路請求載入 |
| 位置 | `src/components/EditorPane.tsx` → `hydrateImages()`，遇到有協定的網址直接 `return` 不處理，`attrs.src` 仍是原始遠端網址 |
| 影響 | 說明文字與實際行為不一致，屬於隱私/追蹤保護未落實，非資料損毀 |
| 建議修法 | 補上「先顯示佔位符、使用者點擊才載入」機制，或修改提示文字使其與實際行為一致 |
| 備註 | 本機圖片插入與 hydration 流程本身核對過沒有發現資料遺失或路徑錯誤問題 |

## 未發現問題的部分（供對照）

- 單一情境的圖片插入、表格插入、連結插入（不疊加其他格式）皆正常，現有測試已覆蓋。
- 本機圖片的 `markdownSrc` / `src` 分離設計（序列化用 `markdownSrc`、顯示用 `src`）運作正確，不會把暫存的 blob/base64 寫回 Markdown。

建議優先處理**表格多段落遺失**，其次是**超連結+粗體/斜體+程式碼組合丟格式**，並把這三個情境補進 `tests/markdown.test.ts` 的 round-trip 測試組以鎖住回歸。

