import limits from "../../shared/panel-limits.json";

export const PANEL_LIMITS = limits;

export type PanelName = "sidebar" | "properties";

export function clampPanelWidth(panel: PanelName, width: number): number {
  const rule = PANEL_LIMITS[panel];
  return Math.min(Math.max(width, rule.minimum), rule.maximum);
}
