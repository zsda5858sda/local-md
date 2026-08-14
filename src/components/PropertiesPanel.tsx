import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { FrontMatterState } from "../domain/types";
import { t } from "../i18n";

interface PropertiesPanelProps {
  width: number;
  state: FrontMatterState;
  onChange: (state: FrontMatterState) => void;
  onClose: () => void;
}

export function PropertiesPanel({ state, onChange, onClose, width }: PropertiesPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(state.data);
  const replace = (data: Record<string, unknown>) => onChange({ ...state, data, format: "yaml", dirty: true });
  const update = (key: string, value: unknown) => replace({ ...state.data, [key]: value });
  const remove = (key: string) => {
    const data = { ...state.data };
    delete data[key];
    replace(data);
  };
  const add = () => {
    const key = newKey.trim();
    if (!key || Object.hasOwn(state.data, key)) return;
    update(key, "");
    setNewKey("");
  };

  return (
    <aside className="properties-panel" style={{ flexBasis: `${width}px` }}>
      <header><strong>{t("properties.title")}</strong><button className="icon-button" aria-label={t("properties.close")} onClick={onClose}><X /></button></header>
      {state.format === "unsupported" ? <p className="muted">{t("properties.unsupported")}</p> : (
        <div className="property-list">
          {entries.length === 0 && <p className="muted">{t("properties.empty")}</p>}
          {entries.map(([key, value]) => (
            <div className="property-row" key={key}>
              <label>
                <span>{key}</span>
                {typeof value === "boolean" ? (
                  <select value={String(value)} onChange={(event) => update(key, event.target.value === "true")}>
                    <option value="true">true</option><option value="false">false</option>
                  </select>
                ) : typeof value === "number" ? (
                  <input type="number" value={value} onChange={(event) => update(key, Number(event.target.value))} />
                ) : value !== null && typeof value === "object" ? (
                  <textarea defaultValue={JSON.stringify(value, null, 2)} onBlur={(event) => {
                    try { update(key, JSON.parse(event.target.value) as unknown); }
                    catch { event.target.value = JSON.stringify(value, null, 2); }
                  }} />
                ) : (
                  <input value={String(value ?? "")} onChange={(event) => update(key, event.target.value)} />
                )}
              </label>
              <button className="property-delete" aria-label={t("properties.delete", { key })} onClick={() => remove(key)}><Trash2 /></button>
            </div>
          ))}
          <div className="property-add">
            <input aria-label={t("properties.newName")} placeholder={t("properties.newName")} value={newKey} onChange={(event) => setNewKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} />
            <button className="secondary-button" disabled={!newKey.trim() || Object.hasOwn(state.data, newKey.trim())} onClick={add}>{t("common.add")}</button>
          </div>
        </div>
      )}
    </aside>
  );
}
