import MiniSearch from "minisearch";
import type { SearchHit } from "../domain/types";

interface IndexedLine extends SearchHit {
  searchable: string;
}

export class WorkspaceSearchIndex {
  private index = new MiniSearch<IndexedLine>({
    fields: ["searchable"],
    storeFields: ["filePath", "relativePath", "lineNumber", "sourceStartOffset", "sourceEndOffset", "rawLineText"],
    searchOptions: { prefix: true, fuzzy: 0.15 },
  });
  private idsByPath = new Map<string, string[]>();
  private linesByPath = new Map<string, IndexedLine[]>();

  update(filePath: string, relativePath: string, source: string): void {
    this.remove(filePath);
    let offset = 0;
    const documents: IndexedLine[] = source.split("\n").map((rawLineText, index) => {
      const id = `${filePath}:${index + 1}:${offset}`;
      const item: IndexedLine = {
        id,
        filePath,
        relativePath,
        lineNumber: index + 1,
        sourceStartOffset: offset,
        sourceEndOffset: offset + rawLineText.length,
        rawLineText,
        searchable: rawLineText.toLocaleLowerCase(),
      };
      offset += rawLineText.length + 1;
      return item;
    });
    if (documents.length) this.index.addAll(documents);
    this.idsByPath.set(filePath, documents.map((item) => item.id));
    this.linesByPath.set(filePath, documents);
  }

  remove(filePath: string): void {
    for (const id of this.idsByPath.get(filePath) ?? []) {
      if (this.index.has(id)) this.index.discard(id);
    }
    this.idsByPath.delete(filePath);
    this.linesByPath.delete(filePath);
  }

  search(query: string, limit = 50, regex = false, relativePath?: string): SearchHit[] {
    if (!query.trim()) return [];
    if (regex) {
      const pattern = new RegExp(query, "mu");
      return [...this.linesByPath.values()].flat()
        .filter((line) => (!relativePath || line.relativePath === relativePath) && pattern.test(line.rawLineText))
        .slice(0, limit);
    }
    return this.index.search(query.toLocaleLowerCase(), { prefix: true }).slice(0, limit).map((result) => ({
      id: String(result.id),
      filePath: String(result.filePath),
      relativePath: String(result.relativePath),
      lineNumber: Number(result.lineNumber),
      sourceStartOffset: Number(result.sourceStartOffset),
      sourceEndOffset: Number(result.sourceEndOffset),
      rawLineText: String(result.rawLineText),
    })).filter((hit) => !relativePath || hit.relativePath === relativePath);
  }

  clear(): void {
    this.index.removeAll();
    this.idsByPath.clear();
    this.linesByPath.clear();
  }
}
