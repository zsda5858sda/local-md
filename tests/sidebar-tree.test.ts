import { describe, expect, it } from "vitest";
import { keyboardNavigableEntries } from "../src/components/Sidebar";
import type { WorkspaceEntry } from "../src/domain/types";

function entry(relativePath: string, kind: WorkspaceEntry["kind"], children?: WorkspaceEntry[]): WorkspaceEntry {
  return { name: relativePath.split("/").at(-1) ?? relativePath, path: `/${relativePath}`, relativePath, kind, size: 0, modifiedAt: 0, children };
}

describe("keyboardNavigableEntries", () => {
  it("follows expanded folders and excludes asset folders", () => {
    const entries = [
      entry("notes", "directory", [entry("notes/one.md", "file")]),
      entry("assets", "directory", [entry("assets/logo.png", "file")]),
      entry("readme.md", "file"),
    ];

    expect(keyboardNavigableEntries(entries, [])).toEqual([
      { entry: entries[0], depth: 0 },
      { entry: entries[2], depth: 0 },
    ]);
    expect(keyboardNavigableEntries(entries, ["notes"])).toEqual([
      { entry: entries[0], depth: 0 },
      { entry: entries[0].children![0], depth: 1 },
      { entry: entries[2], depth: 0 },
    ]);
  });
});
