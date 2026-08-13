import { describe, expect, it } from "vitest";
import { encodeFile, decodeFile, UTF8_LF } from "../src/services/fileFormat";
import { rewriteIncomingLinks, rewriteOutgoingLinks } from "../src/services/linkRewrite";
import { WorkspaceSearchIndex } from "../src/services/searchIndex";
import { applySaveSuccess, classifySaveConflict } from "../src/services/saveState";
import { reorderById } from "../src/services/tabOrder";
import { replaceMatches, searchPattern } from "../src/services/searchReplace";
import { shortcutAction } from "../src/services/keyboardShortcuts";
import { errorMessage, isSaveError } from "../src/services/desktop";
import { validateEntryName } from "../src/services/entryName";
import type { OpenDocument } from "../src/domain/types";
import encodingVectors from "../shared/encoding-vectors.json";
import panelLimits from "../shared/panel-limits.json";
import { PANEL_LIMITS, clampPanelWidth } from "../src/services/panelLimits";
import { documentReducer, openDocument } from "../src/hooks/useDocuments";
import { parseMarkdown } from "../src/markdown/pipeline";

describe("FileFormatProfile", () => {
  it.each(encodingVectors)("matches shared encoding vector $name", (vector) => {
    const decoded = decodeFile(Uint8Array.from(Buffer.from(vector.bytesBase64, "base64")), 0);
    expect(decoded.text).toBe(vector.content);
    expect(decoded.profile).toEqual(vector.profile);
  });
  it("round-trips UTF-8 LF", () => {
    const source = "中文 😀\nsecond\n";
    const encoded = encodeFile(source, UTF8_LF);
    const decoded = decodeFile(encoded);
    expect(decoded.text).toBe(source);
    expect(decoded.profile).toEqual(UTF8_LF);
  });

  it("preserves UTF-8 BOM and CRLF", () => {
    const profile = { encoding: "utf-8", bom: "utf8", eol: "crlf" } as const;
    const encoded = encodeFile("a\nb\n", profile);
    expect([...encoded.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const decoded = decodeFile(encoded);
    expect(decoded.text).toBe("a\nb\n");
    expect(decoded.profile).toEqual(profile);
  });

  it("blocks lossy Big5 saves", () => {
    expect(() => encodeFile("emoji 😀", { encoding: "big5", bom: "none", eol: "lf" })).toThrow(/UTF-8|無法表示/);
  });
});

describe("shared panel limits", () => {
  it("uses the JSON rules in the frontend", () => {
    expect(PANEL_LIMITS).toEqual(panelLimits);
    expect(clampPanelWidth("sidebar", 0)).toBe(panelLimits.sidebar.minimum);
    expect(clampPanelWidth("properties", 999)).toBe(panelLimits.properties.maximum);
  });
});

describe("relative link rewriting", () => {
  it("keeps outgoing targets stable when a document moves", () => {
    const markdown = "![cover](../assets/cover.png)\n[Guide](guide.md#start)\n";
    const output = rewriteOutgoingLinks(markdown, "notes/daily/today.md", "archive/today.md");
    expect(output).toContain("../notes/assets/cover.png");
    expect(output).toContain("../notes/daily/guide.md#start");
  });

  it("rewrites incoming references only for the moved target", () => {
    const markdown = "[Target](../notes/a.md) [Other](../notes/b.md)";
    const output = rewriteIncomingLinks(markdown, "docs/index.md", "notes/a.md", "archive/a.md");
    expect(output).toBe("[Target](../archive/a.md) [Other](../notes/b.md)");
  });
});

describe("raw-source search index", () => {
  it("returns line numbers and exact source offsets", () => {
    const index = new WorkspaceSearchIndex();
    index.update("C:/notes/a.md", "a.md", "# title\nbody title here\n");
    const results = index.search("title");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ lineNumber: 1, sourceStartOffset: 0, rawLineText: "# title" });
    expect(results[1]).toMatchObject({ lineNumber: 2, sourceStartOffset: 8, rawLineText: "body title here" });
  });
});

describe("tab ordering", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("moves a tab before the drop target", () => {
    expect(reorderById(tabs, "c", "a", "before").map((tab) => tab.id)).toEqual(["c", "a", "b"]);
  });

  it("moves a tab after the drop target", () => {
    expect(reorderById(tabs, "a", "c", "after").map((tab) => tab.id)).toEqual(["b", "c", "a"]);
  });
});

describe("search and replace", () => {
  it("replaces literal text case-insensitively", () => {
    expect(replaceMatches("Alpha alpha", "alpha", "beta", false)).toEqual({ content: "beta beta", count: 2 });
  });

  it("supports regular-expression capture groups", () => {
    expect(replaceMatches("item-12 item-34", "item-(\\d+)", "[$1]", true)).toEqual({ content: "[12] [34]", count: 2 });
  });

  it("rejects invalid regular expressions", () => {
    expect(() => searchPattern("(", true)).toThrow();
  });
});

describe("keyboard shortcuts", () => {
  const shortcut = (key: string, options: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => shortcutAction({
    key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...options,
  });

  it("maps search and replace shortcuts to the app", () => {
    expect(shortcut("f", { ctrlKey: true })).toBe("search");
    expect(shortcut("h", { metaKey: true })).toBe("replace");
  });

  it("keeps editor formatting shortcuts", () => {
    expect(shortcut("b", { ctrlKey: true })).toBe("allow-editor");
    expect(shortcut("u", { ctrlKey: true })).toBe("allow-editor");
    expect(shortcut("8", { ctrlKey: true, shiftKey: true })).toBe("allow-editor");
  });

  it("blocks browser navigation and developer shortcuts", () => {
    expect(shortcut("r", { ctrlKey: true })).toBe("block-browser");
    expect(shortcut("i", { ctrlKey: true, shiftKey: true })).toBe("block-browser");
    expect(shortcut("c", { ctrlKey: true, shiftKey: true })).toBe("block-browser");
    expect(shortcut("b", { ctrlKey: true, shiftKey: true })).toBe("block-browser");
    expect(shortcut("F12")).toBe("block-browser");
    expect(shortcut("ArrowLeft", { altKey: true })).toBe("block-browser");
  });
});

describe("autosave revisions", () => {
  const document = (revision: number): OpenDocument => ({
    id: "a", path: "C:/notes/a.md", relativePath: "a.md", title: "a.md",
    content: "old\n", hash: "old-hash", size: 4,
    profile: { encoding: "utf-8", bom: "none", eol: "lf" },
    parsed: { doc: { type: "doc" }, source: "newest\n", frontMatter: { raw: null, body: "newest\n", data: {}, format: "none", dirty: false }, issues: [], mode: "visual" },
    dirty: true, saving: true, saveGeneration: 0, revision, editorVersion: 0,
  });

  it("does not clear a newer edit when an older save completes", () => {
    const result = applySaveSuccess(document(2), 1, "older-save\n", { hash: "saved-hash", saveGeneration: 1 });
    expect(result.dirty).toBe(true);
    expect(result.parsed.source).toBe("newest\n");
    expect(result.hash).toBe("saved-hash");
  });

  it("clears dirty only when the saved revision is still current", () => {
    const result = applySaveSuccess(document(2), 2, "newest\n", { hash: "saved-hash", saveGeneration: 1 });
    expect(result.dirty).toBe(false);
    expect(result.parsed.source).toBe("newest\n");
  });

  it("does not report a conflict when the disk already contains the pending save", () => {
    expect(classifySaveConflict("old\n", "new\n", "new\n")).toBe("already-saved");
  });

  it("retries when only the remembered hash is stale", () => {
    expect(classifySaveConflict("old\n", "new\n", "old\n")).toBe("stale-hash");
  });

  it("reports a conflict only for a real content change", () => {
    expect(classifySaveConflict("old\n", "mine\n", "theirs\n")).toBe("external-change");
  });
});

describe("document reducer", () => {
  const disk = (content: string, hash: string) => ({
    path: "C:/notes/a.md", relativePath: "a.md", content, hash, size: content.length,
    profile: { encoding: "utf-8", bom: "none", eol: "lf" } as const,
  });

  it("classifies external changes in one reducer path", () => {
    const document = { ...openDocument(disk("old\n", "old-hash")), dirty: true, parsed: parseMarkdown("mine\n") };
    const [next] = documentReducer([document], { type: "EXTERNAL_CHANGE", id: document.id, disk: disk("theirs\n", "new-hash") });
    expect(next.conflict).toEqual({ diskHash: "new-hash", diskContent: "theirs\n" });
  });

  it("finishes the saving state and exposes a save conflict", () => {
    const document = { ...openDocument(disk("old\n", "old-hash")), dirty: true, saving: true, parsed: parseMarkdown("mine\n") };
    const [next] = documentReducer([document], { type: "SAVE_CONFLICT", id: document.id, disk: disk("theirs\n", "new-hash") });
    expect(next.saving).toBe(false);
    expect(next.conflict).toEqual({ diskHash: "new-hash", diskContent: "theirs\n" });
  });

  it("still ignores watcher changes while a save is running", () => {
    const document = { ...openDocument(disk("old\n", "old-hash")), dirty: true, saving: true, parsed: parseMarkdown("mine\n") };
    const [next] = documentReducer([document], { type: "EXTERNAL_CHANGE", id: document.id, disk: disk("theirs\n", "new-hash") });
    expect(next).toBe(document);
  });

  it("reloads disk state through the explicit action", () => {
    const document = { ...openDocument(disk("old\n", "old-hash")), dirty: true };
    const [next] = documentReducer([document], { type: "RELOAD_FROM_DISK", id: document.id, disk: disk("disk\n", "disk-hash") });
    expect(next.content).toBe("disk\n");
    expect(next.dirty).toBe(false);
    expect(next.editorVersion).toBe(1);
  });
});

describe("structured save errors", () => {
  it("recognizes conflict errors without inspecting localized messages", () => {
    const error = { kind: "Conflict", expected: "old-hash", actual: "new-hash" };
    expect(isSaveError(error)).toBe(true);
    expect(errorMessage(error)).toBe("磁碟版本已變更");
  });

  it("preserves general structured error messages", () => {
    const error = { kind: "Encoding", message: "Big5 無法表示此字元" };
    expect(isSaveError(error)).toBe(true);
    expect(errorMessage(error)).toBe(error.message);
  });
});

describe("entry name validation", () => {
  it.each(["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"])(
    "rejects reserved path characters in %s",
    (name) => expect(validateEntryName(name)).toMatch(/名稱不能包含/),
  );

  it("accepts a plain entry name", () => {
    expect(validateEntryName("會議記錄.md")).toBeNull();
  });
});
