# Local MD

Local MD 是依照《Local-first 區塊式 Markdown 編輯器系統設計規劃書 v1.3》建立的 Tauri 2 + React/TypeScript 桌面編輯器。Markdown 檔案與實際 filesystem 是唯一事實來源；應用程式不含帳號、雲端同步、AI API 或文件資料庫。

## 已實作

- Tiptap / ProseMirror 區塊式編輯器與多分頁 UI。
- 表格支援欄寬拖曳、緊湊列高，以及新增／刪除列欄與刪除整張表格的浮動控制列。
- 分頁可拖曳重新排序，並可關閉目前分頁、其他分頁或全部分頁。
- 分頁群組預設不啟用；可新增群組、拖入／移出分頁及折疊群組。
- 群組支援修改名稱、九種顏色、關閉群組、取消分組與刪除群組。
- 受控的 remark / MDAST 單一轉換管線。
- MDAST node allowlist 與 Compatibility 純文字模式。
- Raw Markdown block、YAML front-matter 原文保留。
- CommonMark / GFM canonical serializer：Soft Break、Hard Break、清單起始值與 spread、表格 alignment、CJK / emoji 欄寬。
- Workspace tree、新增、重新命名、刪除（桌面版移至資源回收桶）。
- Raw Markdown source 全文搜尋與精確 line / source offset。
- 目前文件與整個工作區搜尋／取代，支援可選的 Regex 與捕獲群組取代。
- UTF-8、Big5、GBK、Shift-JIS、BOM、LF / CRLF / CR profile。
- 每分頁 autosave debounce、可關閉的自動儲存、disk hash conflict protection。
- 寫入暫存檔、replace 前第二次 hash 驗證、atomic replace。
- `.snapshots/` throttle 與 retention。
- Workspace recursive watcher。
- Markdown folder import、Workspace ZIP export、孤兒 asset 掃描。
- 預設阻擋遠端圖片，Tauri CSP 不允許外部連線或任意 script。
- 瀏覽器示範工作區；不具 Tauri runtime 時不會存取本機 filesystem。
- 側邊欄與頁面屬性面板可拖曳調整，並設有合理的最小與最大寬度。
- 停用網頁原生右鍵選單及瀏覽器導覽、重新整理、縮放、列印與開發者工具快捷鍵。

## 基本操作

### 工作區與文件

- 啟動後選擇 Markdown 工作區資料夾；瀏覽器模式可使用記憶體示範工作區。
- 左側 Workspace tree 可新增、開啟、重新命名及刪除 Markdown 文件或資料夾。
- 點擊分頁切換文件；拖曳分頁可重新排序。
- 「關閉其他」會保留目前分頁，「全部關閉」會關閉所有分頁。
- 文件尚未儲存時，關閉前會要求確認。

### 自動儲存

- 預設啟用自動儲存，編輯停止一段時間後寫入磁碟。
- 可從右上角「Workspace 工具」關閉或重新啟用自動儲存。
- 關閉自動儲存後可按工具列儲存按鈕或 `Ctrl/Cmd + S` 手動儲存。
- 儲存前後均會驗證磁碟 hash；偵測真正的外部變更時才進入衝突處理。

### 搜尋與取代

1. 點擊左側「搜尋」，或按 `Ctrl/Cmd + F`。
2. 選擇「目前文件」或「整個工作區」。
3. 輸入搜尋文字；需要正規表示式時勾選 `Regex`。
4. 在「取代為…」輸入替代文字，再按「全部取代」。按 `Ctrl/Cmd + H` 可直接聚焦取代欄。
5. 工作區取代會先顯示確認訊息，並保留 atomic save、hash 驗證及衝突保護。

Regex 模式支援 JavaScript 正規表示式與捕獲群組，例如搜尋 `item-(\d+)`、取代為 `[$1]`。

### 分頁群組

- 點擊「＋ 群組」建立群組；未加入群組的分頁維持一般分頁外觀，不顯示「未分組」標籤。
- 將分頁拖到群組標籤可加入群組，拖回一般分頁區可取消該分頁的群組指派。
- 點擊群組名稱可折疊或展開；開啟群組內文件時會自動展開群組。
- 點擊群組右側「⋯」可開啟管理選單：
  - 修改群組名稱。
  - 選擇九種群組顏色。
  - 「關閉群組」：關閉群組內分頁，但保留空群組。
  - 「取消分組」：保留分頁並移除群組。
  - 「刪除群組」：關閉群組內分頁並移除群組。
- 群組名稱、顏色、折疊狀態與分頁指派會寫入工作區設定。

### 快捷鍵

| 快捷鍵 | 功能 |
| --- | --- |
| `Ctrl/Cmd + S` | 儲存目前文件 |
| `Ctrl/Cmd + W` | 關閉目前文件分頁 |
| `Ctrl/Cmd + F` | 開啟搜尋並聚焦搜尋欄 |
| `Ctrl/Cmd + H` | 開啟搜尋並聚焦取代欄 |
| `Ctrl/Cmd + B` | 粗體 |
| `Ctrl/Cmd + I` | 斜體 |
| `Ctrl/Cmd + U` | 底線 |
| `Ctrl/Cmd + Shift + X` | 刪除線 |
| `Ctrl/Cmd + Z` | 復原 |
| `Ctrl/Cmd + Shift + Z` | 重做 |

複製、剪下、貼上、全選及文字導覽快捷鍵維持可用。其他瀏覽器層級快捷鍵會被攔截，避免在桌面編輯器中觸發重新整理、縮放、列印、網址列、瀏覽器分頁或開發者工具。

## 開發

需求：Node.js 20+、pnpm 11+、Rust stable，以及 Tauri 2 的平台 prerequisites。

```powershell
pnpm install
pnpm test:run
pnpm build
pnpm tauri dev
```

建立不含安裝程式的桌面 binary：

```powershell
pnpm tauri build --debug --no-bundle --ci
```

Windows 輸出位於 `src-tauri/target/debug/local-md.exe`。

## Windows 正式打包

專案根目錄提供 [`build-windows.bat`](./build-windows.bat)，可一次完成前端 production build、Rust release build，以及 Windows 安裝包封裝。

在 PowerShell 進入專案目錄後執行：

```powershell
.\build-windows.bat
```

批次檔會依序：

1. 檢查 Node.js、pnpm 與 Rust/Cargo。
2. 系統 `PATH` 找不到 Node.js/pnpm 時，嘗試使用 Codex 隨附的 runtime。
3. 系統 `PATH` 找不到 Cargo 時，嘗試使用 `%USERPROFILE%\.cargo\bin`。
4. 執行 `pnpm tauri build`。
5. 成功後顯示執行檔與安裝包的實際路徑。

看到以下訊息代表完整打包成功：

```text
[SUCCESS] Local MD build completed.
```

若失敗，批次檔會回傳非零 exit code，並顯示：

```text
[ERROR] Build failed. Review the messages above for details.
```

PowerShell 可用 `$LASTEXITCODE` 再次確認；`0` 表示成功，非 `0` 表示失敗。

### 正式產物

| 類型 | 輸出位置 |
| --- | --- |
| 直接執行檔 | `src-tauri/target/release/local-md.exe` |
| NSIS 安裝程式 | `src-tauri/target/release/bundle/nsis/*.exe` |
| MSI 安裝程式 | `src-tauri/target/release/bundle/msi/*.msi` |

只建立特定格式時，可將 Tauri build 參數直接傳給批次檔：

```powershell
# 只封裝一般 Windows Setup.exe
.\build-windows.bat --bundles nsis

# 只封裝 MSI
.\build-windows.bat --bundles msi

# 只建立 release 執行檔，不建立安裝包
.\build-windows.bat --no-bundle
```

第一次在新的開發環境建置時，仍建議先執行 `pnpm install`。若電腦沒有 Codex runtime，請安裝 Node.js LTS、pnpm 與 Rust stable，並重新開啟終端機。

## 驗證

```powershell
pnpm typecheck
pnpm test:run
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

目前驗證結果：TypeScript typecheck、65 個前端測試、14 個 Rust 測試及 Tauri release／Windows 安裝包建置均通過。

測試涵蓋 canonical semantic round-trip、Soft / Hard Break、多層與 loose / tight list、自訂 ordered-list start、task list、CJK / emoji table、code fence、YAML / TOML front-matter、reference-link compatibility、危險 HTML 隔離、property-based 生成案例、encoding、link rewrite、raw-source 搜尋定位、搜尋取代、分頁排序、自動儲存 revision 與快捷鍵白名單。

## 資料安全邊界

- 所有一般 filesystem command 都先正規化路徑並拒絕 `..`、絕對路徑與 symlink escape。
- Open Folder 預設依 `FileFormatProfile` 保存來源 encoding、BOM 與 EOL；無法表示的新字元會中止儲存，不使用 replacement character。
- expected disk hash 不一致時 autosave 會停止並回報 `CONFLICT`。
- 遠端圖片只顯示 placeholder，不主動發出 HTTP request。
- `.snapshots/` 不顯示於 Workspace tree，也不加入搜尋索引。
