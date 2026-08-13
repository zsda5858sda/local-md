import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { OpenDocument, SearchHit, WorkspaceEntry } from "../domain/types";
import { errorMessage, readDocument } from "../services/desktop";
import { WorkspaceSearchIndex } from "../services/searchIndex";
import { searchPattern } from "../services/searchReplace";

export type SearchScope = "document" | "workspace";

function flattenFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries.flatMap((entry) => entry.kind === "file" ? [entry] : flattenFiles(entry.children ?? []));
}

export function useWorkspaceSearch(documentsRef: RefObject<OpenDocument[]>, activeIdRef: RefObject<string | null>) {
  const [searchQuery, setSearchQuery] = useState("");
  const [replacementText, setReplacementText] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("workspace");
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>();
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchTarget, setSearchTarget] = useState<{ path: string; text: string; nonce: number } | null>(null);
  const [searchShortcut, setSearchShortcut] = useState<{ mode: "search" | "replace"; nonce: number } | null>(null);
  const searchQueryRef = useRef(searchQuery);
  const searchScopeRef = useRef(searchScope);
  const searchRegexRef = useRef(searchRegex);
  const searchIndex = useRef(new WorkspaceSearchIndex());
  const indexGeneration = useRef(0);

  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { searchScopeRef.current = searchScope; }, [searchScope]);
  useEffect(() => { searchRegexRef.current = searchRegex; }, [searchRegex]);

  const refreshSearchResults = useCallback((query = searchQueryRef.current, regex = searchRegexRef.current, scope = searchScopeRef.current) => {
    if (!query.trim()) { setSearchError(undefined); setSearchHits([]); return; }
    try {
      if (regex) searchPattern(query, true, false);
      const active = documentsRef.current.find((document) => document.id === activeIdRef.current);
      setSearchError(undefined);
      setSearchHits(searchIndex.current.search(query, 50, regex, scope === "document" ? active?.relativePath : undefined));
    } catch (error) {
      setSearchError(errorMessage(error));
      setSearchHits([]);
    }
  }, [activeIdRef, documentsRef]);

  const indexWorkspace = useCallback(async (root: string, entries: WorkspaceEntry[]) => {
    const generation = ++indexGeneration.current;
    searchIndex.current.clear();
    const files = flattenFiles(entries);
    for (let index = 0; index < files.length; index += 8) {
      await Promise.all(files.slice(index, index + 8).map(async (entry) => {
        try {
          const disk = await readDocument(root, entry.relativePath);
          if (generation === indexGeneration.current) searchIndex.current.update(disk.path, disk.relativePath, disk.content);
        } catch { /* A single unreadable file must not block the workspace. */ }
      }));
    }
    if (generation === indexGeneration.current && searchQueryRef.current) refreshSearchResults();
  }, [refreshSearchResults]);

  const handleSearch = (query: string) => { setSearchQuery(query); refreshSearchResults(query, searchRegex, searchScope); };
  const handleSearchScopeChange = (scope: SearchScope) => { setSearchScope(scope); refreshSearchResults(searchQuery, searchRegex, scope); };
  const handleSearchRegexChange = (enabled: boolean) => { setSearchRegex(enabled); refreshSearchResults(searchQuery, enabled, searchScope); };

  return {
    searchQuery, setSearchQuery, replacementText, setReplacementText, searchScope, setSearchScope,
    searchRegex, setSearchRegex, searchError, setSearchError, searchHits, setSearchHits,
    searchTarget, setSearchTarget, searchShortcut, setSearchShortcut,
    searchQueryRef, searchScopeRef, searchRegexRef, searchIndex, indexGeneration,
    refreshSearchResults, indexWorkspace, handleSearch, handleSearchScopeChange, handleSearchRegexChange,
  };
}
