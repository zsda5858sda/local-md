import { useCallback } from "react";
import type { Dispatch } from "react";
import type { DiskDocument } from "../domain/types";
import type { DocAction } from "./useDocuments";

export function useSaveConflict(dispatch: Dispatch<DocAction>) {
  const saveConflict = useCallback((id: string, disk: DiskDocument) => dispatch({ type: "SAVE_CONFLICT", id, disk }), [dispatch]);
  const externalChange = useCallback((id: string, disk: DiskDocument) => dispatch({ type: "EXTERNAL_CHANGE", id, disk }), [dispatch]);
  const reloadFromDisk = useCallback((id: string, disk: DiskDocument) => dispatch({ type: "RELOAD_FROM_DISK", id, disk }), [dispatch]);
  return { saveConflict, externalChange, reloadFromDisk };
}
