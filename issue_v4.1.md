## 1. 核心問題診斷（人類速讀區）

- **影響範圍**：`src/components/EditorPane.tsx` → `AnnotatedLink.configure()` 呼叫（Tiptap Link 擴充設定）
- **問題類型**：狀態管理異常（第三方擴充預設值未被正確覆寫，導致底層平台行為劫持前端事件處理）
- **問題本質**：`AnnotatedLink.configure()` 只覆寫了 `HTMLAttributes.rel`，沒有覆寫 `HTMLAttributes.target`，導致 Tiptap Link 擴充的預設值 `target: '_blank'` 仍然生效，渲染出來的 `<a>` 標籤帶有 `target="_blank"`。Tauri 對帶 `target="_blank"` 的錨點會在 webview 底層直接攔截並開新視窗／叫瀏覽器，這個攔截發生在 DOM `click` 事件預設行為判斷之外，因此 `editorProps.handleDOMEvents.click` 裡呼叫的 `event.preventDefault()` 完全無法阻止這個跳轉，跟該函式本身的邏輯正確與否無關。

---

## 2. Codex 執行指令（AI 助手修復指令）

### 2.1 變更定位

- **Target File/Module**: `src/components/EditorPane.tsx`
- **Target Scope**: `EditorPane` 元件內 `useEditor()` 呼叫中 `AnnotatedLink.configure(...)` 這一段設定物件

### 2.2 問題代碼分析（Diff Context）

- **現有邏輯缺陷**：
  ```ts
  AnnotatedLink.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
  ```
  `HTMLAttributes` 只給了 `rel`，Tiptap 會把這個物件跟 Link 擴充的預設 `HTMLAttributes`（其中包含 `target: '_blank'`）做合併，未覆寫的鍵會保留預設值，最終渲染出 `target="_blank"` 的錨點標籤。

- **修復規格要求**：
  1. 在 `HTMLAttributes` 裡明確加入 `target: null`，徹底移除渲染出來的 `<a>` 標籤上的 `target` 屬性，使其成為一般同視窗連結。
  2. 不要修改 `extensions.ts` 裡的 `handleEditorLinkClick`、`linkHrefFromTarget`、`externalHttpLinkFromTarget` 函式，這三個函式邏輯已經正確，不是本次問題根因。
  3. 不要修改 `editorProps.handleDOMEvents.click` 的掛載方式，該部分已經是正確的 API（`handleDOMEvents.click` 而非 `handleClick`）。
  4. 修改後需確認：一般點擊連結時游標可以正常落在文字上編輯、不會發生任何跳轉或開新視窗；按住 Ctrl/Cmd 點擊時才會跳出 `pendingLink` 對應的確認對話框。

### 2.3 完整修復代碼（Full Implementation）

> 僅需替換 `EditorPane.tsx` 中 `useEditor()` 的 `extensions` 陣列裡 `AnnotatedLink.configure(...)` 這一行，其餘檔案內容不變。

```tsx
AnnotatedLink.configure({
  openOnClick: false,
  autolink: true,
  HTMLAttributes: { rel: "noopener noreferrer", target: null },
}),
```

完整比對用的上下文（`useEditor` 的 `extensions` 陣列，其餘項目維持原樣不變）：

```tsx
const editor = useEditor({
  extensions: [
    StarterKit.configure({ codeBlock: false, link: false, underline: false }),
    CodeBlockLowlight.configure({ lowlight }),
    AnnotatedLink.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: { rel: "noopener noreferrer", target: null },
    }),
    LinkShortcut,
    Underline,
    SafeImage.configure({ inline: true, allowBase64: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    RawMarkdown,
    MarkdownMetadata,
  ],
  content: document.parsed.doc,
  editorProps: {
    attributes: { class: "prose-editor", "aria-label": t("editor.aria", { title: document.title }), spellcheck: "true" },
    handleDOMEvents: {
      click: (_view, event) => handleEditorLinkClick(event, setPendingLink),
    },
    handlePaste: (view, event) => {
      const html = event.clipboardData?.getData("text/html") ?? "";
      if (!html) return false;
      event.preventDefault();
      const sanitized = sanitizeHtml(html);
      if (sanitized) editor?.commands.insertContent(sanitized);
      else view.dispatch(view.state.tr.insertText(event.clipboardData?.getData("text/plain") ?? ""));
      return true;
    },
  },
  onUpdate: ({ editor: current }) => onChange(current.getJSON() as TiptapNode),
});
```

---

## 給 Codex 的溝通訊息（可直接複製貼上）

> 連結點擊還是會直接跳轉，跟 `handleDOMEvents.click` 的邏輯無關，是因為 `EditorPane.tsx` 裡 `AnnotatedLink.configure()` 的 `HTMLAttributes` 只設了 `rel`，沒有設 `target: null`，導致 Tiptap Link 擴充預設的 `target: '_blank'` 還留著。Tauri 對帶 `target="_blank"` 的 `<a>` 標籤會在 webview 層直接攔截開新視窗/瀏覽器，這個攔截在 DOM click 事件的 `preventDefault()` 判斷範圍之外，所以現有的事件處理邏輯完全擋不住。請把 `HTMLAttributes` 改成 `{ rel: "noopener noreferrer", target: null }`，其他程式碼都不要動。
