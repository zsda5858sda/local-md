import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { FrontMatterState } from "../domain/types";

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
      <header><strong>頁面屬性</strong><button className="icon-button" aria-label="關閉屬性" onClick={onClose}><X /></button></header>
      {state.format === "unsupported" ? <p className="muted">此文件使用非 YAML front-matter，已保留原文但不解析。</p> : (
        <div className="property-list">
          {entries.length === 0 && <p className="muted">尚無頁面屬性。</p>}
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
              <button className="property-delete" aria-label={`刪除屬性 ${key}`} onClick={() => remove(key)}><Trash2 /></button>
            </div>
          ))}
          <div className="property-add">
            <input aria-label="新屬性名稱" placeholder="新屬性名稱" value={newKey} onChange={(event) => setNewKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} />
            <button className="secondary-button" disabled={!newKey.trim() || Object.hasOwn(state.data, newKey.trim())} onClick={add}>新增</button>
          </div>
        </div>
      )}
    </aside>
  );
}
