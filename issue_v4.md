# 外部連結安全開啟功能 — 實作規劃

## 問題背景

Ctrl/Cmd + 點擊連結原本用 `window.open()` 呼叫系統瀏覽器，測試後沒有成功。

**原因**：這是 Tauri 桌面應用，`window.open()` 在 Tauri webview 裡對外部網址通常會被擋掉或沒有反應，因為專案目前完全沒有裝 `@tauri-apps/plugin-shell`，也沒有對應的權限設定 —— `package.json`、`Cargo.toml`、`capabilities/default.json` 裡都沒有 shell plugin 的蹤跡。

**目標行為**：Ctrl/Cmd + 點擊連結 → 跳出確認警告視窗（顯示目標網址與安全提示）→ 使用者按確認才呼叫系統預設瀏覽器開啟。

---

## 1. 安裝並授權 Tauri Shell Plugin

### `package.json`

加入依賴：

```json
"@tauri-apps/plugin-shell": "^2.0.0",
```

### `src-tauri/Cargo.toml`

加入：

```toml
tauri-plugin-shell = "2"
```

### `src-tauri/src/lib.rs`

在 `run()` 裡註冊這個 plugin（跟現有的 `tauri_plugin_dialog::init()` 放在一起）：

```rust
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_shell::init())   // 新增這一行
```

### `src-tauri/capabilities/default.json`

`permissions` 陣列加入：

```json
"shell:allow-open"
```

> 這個權限是 Tauri v2 的白名單機制，沒有明確授權的話即使裝了套件也叫不動系統瀏覽器。

---

## 2. 在 `desktop.ts` 包一層呼叫函式

`src/services/desktop.ts` 目前 `import { open } from "@tauri-apps/plugin-dialog"` 已經佔用了 `open` 這個名字，所以 shell 的 `open` 要取別名：

```ts
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";

export async function openExternalLink(url: string): Promise<void> {
  if (!isTauri()) { window.open(url, "_blank", "noopener,noreferrer"); return; }
  await openExternalUrl(url);
}
```

保留 `!isTauri()` 分支是因為專案本身也支援瀏覽器示範模式（`demo://workspace`），瀏覽器環境下就還是用原本的 `window.open`。

---

## 3. i18n 補上警告文字

`src/i18n.ts` 的 `zhTW` 字典加入：

```ts
"link.externalWarningTitle": "即將開啟外部連結",
"link.externalWarningBody": "您即將前往：\n{url}\n\n請確認該網站是否安全，Local MD 無法驗證外部連結內容。",
"link.openInBrowser": "開啟連結",
```

`common.cancel`／`common.confirm` 已經有現成的，可以重複使用。

---

## 4. `EditorPane.tsx`：先彈確認視窗，使用者按確認才開啟

把 `handleClick` 改成只負責記錄「使用者按住 Ctrl/Cmd 點了哪個連結」，不直接開網址，另外加一個 dialog state 跟渲染區塊，風格沿用 `Toolbar.tsx` 的 `.dialog-backdrop`／`.entry-dialog`：

```tsx
import { useEffect, useRef, useState } from "react";
import { loadWorkspaceAsset, openExternalLink } from "../services/desktop";
// ...其餘 import 不變

export function EditorPane({ document, onChange, onSourceChange, workspaceRoot, targetText, targetNonce }: EditorPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const editor = useEditor({
    // ...extensions 不變
    editorProps: {
      attributes: { /* 不變 */ },
      handleClick: (_view, _position, event) => {
        if (!event.ctrlKey && !event.metaKey) return false;
        const href = externalHttpLinkFromTarget(event.target);
        if (!href) return false;
        event.preventDefault();
        setPendingLink(href);   // 改成先跳確認視窗，不直接開
        return true;
      },
      handlePaste: (view, event) => { /* 不變 */ },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as TiptapNode),
  });

  // ...其餘 useEffect 不變

  return (
    <div className="editor-pane">
      {/* ...既有內容不變 */}
      {pendingLink && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingLink(null); }}>
          <div className="entry-dialog" role="alertdialog" aria-modal="true" aria-labelledby="external-link-title">
            <h2 id="external-link-title">{t("link.externalWarningTitle")}</h2>
            <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{t("link.externalWarningBody", { url: pendingLink })}</p>
            <div>
              <button type="button" className="secondary-button" onClick={() => setPendingLink(null)}>{t("common.cancel")}</button>
              <button type="button" className="primary-button" onClick={() => { void openExternalLink(pendingLink); setPendingLink(null); }}>{t("link.openInBrowser")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 完整行為流程

1. 一般點擊連結（沒按 Ctrl/Cmd）：`handleClick` 直接 `return false`，交給編輯器正常處理，可以繼續編輯文字，不受影響。
2. Ctrl/Cmd + 點擊連結：跳出「即將開啟外部連結：`https://xxx`，請確認該網站是否安全」的對話框。
3. 使用者按「開啟連結」→ 呼叫 `openExternalLink()` → 叫出系統預設瀏覽器開啟該網址。
4. 使用者按「取消」或點擊背景 → 對話框關閉，什麼都不會發生。

---

## 部署注意事項

- 改完 `package.json` 後要跑一次 `pnpm install`，讓 `@tauri-apps/plugin-shell` 套件真正裝進 `node_modules`。
- Rust 端加了新依賴後要重新 `cargo build` 一次讓新的 `tauri-plugin-shell` 生效。
- 建議在 `tests/markdown.test.ts` 或 `tests/services.test.ts` 補一個測試案例，驗證非 `http(s)` 開頭的連結（例如本機相對路徑）不會誤觸這個外部連結警告流程。
