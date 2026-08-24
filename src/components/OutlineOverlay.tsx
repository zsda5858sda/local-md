import { ListTree } from "lucide-react";
import type { OutlineItem } from "../hooks/useOutline";
import { t } from "../i18n";

export interface OutlineOverlayProps {
  items: OutlineItem[];
  activeIndex: number;
  activeSectionIndex: number;
  onSelect: (index: number) => void;
}

export function OutlineOverlay({ items, activeIndex, activeSectionIndex, onSelect }: OutlineOverlayProps) {
  if (items.length === 0) return null;
  const minimumLevel = items.reduce((minimum, item) => Math.min(minimum, item.level), 6);

  return (
    <div className="outline-overlay" tabIndex={0} aria-label={t("sidebar.outline")}>
      <div className="outline-overlay-trigger" aria-hidden="true">
        <ListTree />
      </div>
      <nav className="outline-overlay-panel" aria-label={t("sidebar.outline")}>
        <strong className="outline-overlay-title">{t("sidebar.outline")}</strong>
        <ul>
          {items.map((item, index) => {
            const classes = [
              "outline-item",
              index === activeIndex ? "active" : "",
              index === activeSectionIndex ? "active-section" : "",
            ].filter(Boolean).join(" ");
            return (
              <li key={item.pos}>
                <button
                  type="button"
                  className={classes}
                  style={{ paddingInlineStart: `${8 + (item.level - minimumLevel) * 14}px` }}
                  aria-current={index === activeIndex ? "location" : undefined}
                  onClick={() => onSelect(index)}
                >
                  {item.text || t("sidebar.outlineUntitled")}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
