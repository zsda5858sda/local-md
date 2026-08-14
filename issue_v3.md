<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# 我選取完一段文字後點插入連結雖然看起來會成功，但是它看起來不會真跳轉頁面，我希望游標滑上去她會有提示是連結到哪個頁面，而且應該要有快捷鍵可以用

三個需求分開處理，我把對應的程式碼改法整理出來——目前這幾個行為不是 bug，是專案原本的編輯器設計（`openOnClick: false`），但你要的體驗都可以加上去。

## 1. 滑鼠移上去顯示連結目標（hover tooltip）

目前 `EditorPane.tsx` 的 `Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } })` 沒有設定 `title` 屬性，瀏覽器原生的 hover 提示框是靠 `<a>` 的 `title` 屬性顯示的，不是靠 `href`，所以現在滑上去什麼都不會顯示。

解法是擴充 Link，讓渲染出來的 `<a>` 一律帶上 `title`（沒有自訂標題時就用網址本身）：

```ts
import { mergeAttributes } from "@tiptap/core";
import Link from "@tiptap/extension-link";

const AnnotatedLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    return ["a", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      title: HTMLAttributes.title || HTMLAttributes.href,
    }), 0];
  },
});
```

然後把 `EditorPane.tsx` 裡的 `Link.configure(...)` 換成 `AnnotatedLink.configure(...)`，設定內容不用改。這樣不管是工具列插入、還是 `autolink` 自動偵測出來的連結，滑鼠移上去都會顯示網址。

## 2. 點擊不會真的跳轉——這是設計，不是 bug

`openOnClick: false` 是刻意設定的：如果編輯模式下點連結就直接跳走，你會沒辦法正常編輯文字（跟 Notion、Google Docs 一樣，編輯狀態下點連結不會離開頁面）。如果你想要「按住 Ctrl/Cmd 點擊才真正打開」（多數編輯器的慣例），可以在 `editorProps` 加一個 `handleClick`：

```ts
editorProps: {
  // ...既有的 attributes、handlePaste 不變
  handleClick: (view, pos, event) => {
    if (!event.ctrlKey && !event.metaKey) return false;
    const { href } = view.state.doc.resolve(pos).marks().find((mark) => mark.type.name === "link")?.attrs ?? {};
    if (typeof href === "string" && /^https?:\/\//i.test(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  },
},
```

只處理 `http(s)` 開頭的網址，本機相對路徑的連結（例如連到另一份 `.md` 檔）不會被這段攔截，之後如果你想做「Ctrl+點擊跳轉到工作區內另一份文件」可以再擴充判斷條件。

## 3. 插入連結的快捷鍵

目前 `keyboardShortcuts.ts` 的 `SHORTCUTS` map 裡沒有對應到「插入連結」，而且 `addLink` 的觸發邏輯（開啟 `Toolbar.tsx` 裡的 `dialog` state）是元件內部狀態，不是 `App.tsx` 全域 `shortcutAction` 能直接控制的東西。比較乾淨的做法是用 Tiptap 自己的快捷鍵機制搭配事件通知，不用擠進全域的 `SHORTCUTS` map：

```ts
// src/editor/extensions.ts 新增
import { Extension } from "@tiptap/core";

export const LinkShortcut = Extension.create({
  name: "linkShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        this.editor.emit("insertLinkRequested");
        return true;
      },
    };
  },
});
```

`EditorPane.tsx` 的 `extensions` 陣列裡加入 `LinkShortcut`。`Toolbar.tsx` 則監聽這個事件來開啟同一個對話框：

```ts
useEffect(() => {
  if (!editor) return;
  const openLinkDialog = () => addLink();
  editor.on("insertLinkRequested", openLinkDialog);
  return () => { editor.off("insertLinkRequested", openLinkDialog); };
}, [editor]);
```

`Mod-k` 在 Tiptap 裡會自動對應 Windows/Linux 的 `Ctrl+K` 跟 macOS 的 `Cmd+K`，跟 Notion、Slack 插入連結的快捷鍵一致，使用者不用特別去背新的組合鍵。因為這是掛在 Tiptap 的 `addKeyboardShortcuts()` 上，只有在編輯器聚焦時才會生效，不會跟 `App.tsx` 裡處理 `Ctrl+S`／`Ctrl+F` 的全域監聽衝突。

三個改動都不需要新增套件，也不影響你之前修過的儲存/表格/i18n 邏輯，可以獨立測試後再合併。

