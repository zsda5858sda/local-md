import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { OpenDocument, WorkspaceSettings } from "../domain/types";
import { t } from "../i18n";

export const TAB_GROUP_COLORS = ["#6b7280", "#5b8def", "#ef7d72", "#eabf3b", "#70bf8b", "#e879b0", "#b46de0", "#56c4d8", "#f0a15f"];
export type TabDropTarget = { type: "tab"; id: string; position: "before" | "after" } | { type: "group"; groupId: string | null } | null;
export type GroupMenu = { id: string; left: number; top: number; draftName: string } | null;

export function useTabGroups(
  documents: OpenDocument[],
  settings: WorkspaceSettings,
  setSettings: Dispatch<SetStateAction<WorkspaceSettings>>,
) {
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<TabDropTarget>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenu>(null);

  const setTabGroup = (relativePath: string, groupId: string | null) => setSettings((current) => {
    const assignments = { ...current.ui.tabAssignments };
    if (groupId) assignments[relativePath] = groupId;
    else delete assignments[relativePath];
    return { ...current, ui: { ...current.ui, tabAssignments: assignments } };
  });

  const toggleTabGroup = (groupId: string) => setSettings((current) => ({
    ...current,
    ui: { ...current.ui, tabGroups: current.ui.tabGroups.map((group) => group.id === groupId ? { ...group, collapsed: !group.collapsed } : group) },
  }));

  const addTabGroup = () => setSettings((current) => {
    const used = new Set(current.ui.tabGroups.map((group) => group.name));
    let number = 1;
    while (used.has(t("tabs.numberedGroup", { number }))) number += 1;
    return {
      ...current,
      ui: { ...current.ui, tabGroups: [...current.ui.tabGroups, { id: crypto.randomUUID(), name: t("tabs.numberedGroup", { number }), color: TAB_GROUP_COLORS[1], collapsed: false }] },
    };
  });

  const removeTabGroup = (groupId: string) => setSettings((current) => ({
    ...current,
    ui: {
      ...current.ui,
      tabGroups: current.ui.tabGroups.filter((group) => group.id !== groupId),
      tabAssignments: Object.fromEntries(Object.entries(current.ui.tabAssignments).filter(([, assigned]) => assigned !== groupId)),
    },
  }));

  const commitTabGroupName = () => {
    if (!groupMenu) return;
    const name = groupMenu.draftName.trim();
    const currentName = settings.ui.tabGroups.find((group) => group.id === groupMenu.id)?.name ?? t("tabs.defaultGroup");
    if (!name) { setGroupMenu({ ...groupMenu, draftName: currentName }); return; }
    setSettings((current) => ({ ...current, ui: { ...current.ui, tabGroups: current.ui.tabGroups.map((group) => group.id === groupMenu.id ? { ...group, name } : group) } }));
    setGroupMenu((current) => current ? { ...current, draftName: name } : current);
  };

  const setTabGroupColor = (groupId: string, color: string) => setSettings((current) => ({
    ...current,
    ui: { ...current.ui, tabGroups: current.ui.tabGroups.map((group) => group.id === groupId ? { ...group, color } : group) },
  }));

  const ungroupedDocuments = useMemo(() => {
    const knownGroupIds = new Set(settings.ui.tabGroups.map((group) => group.id));
    return documents.filter((document) => !knownGroupIds.has(settings.ui.tabAssignments[document.relativePath] ?? ""));
  }, [documents, settings.ui.tabAssignments, settings.ui.tabGroups]);

  return {
    draggedTabId, setDraggedTabId, tabDropTarget, setTabDropTarget, groupMenu, setGroupMenu,
    setTabGroup, toggleTabGroup, addTabGroup, removeTabGroup, commitTabGroupName, setTabGroupColor,
    ungroupedDocuments,
  };
}
