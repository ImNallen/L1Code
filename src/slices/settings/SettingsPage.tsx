// One settings section: a heading, then the section's own panel or a card of rows, each a label, a
// description, and its control.

import { createElement, useId, type ComponentType } from "react";
import { ChevronDown } from "lucide-react";
import AppearanceSection from "./AppearanceSection";
import { settingsSections, type PanelId, type RowDef, type SettingsSectionId } from "./model";
import { setSetting, useSetting } from "./store";
import "./settings.css";

const panels: Record<PanelId, ComponentType> = { appearance: AppearanceSection };

export default function SettingsPage({ section }: { section: SettingsSectionId }) {
  const def = settingsSections.find((s) => s.id === section)!;
  return (
    <div className="settings-page">
      <div className="settings-top" data-tauri-drag-region>
        Settings
      </div>
      <div className="settings-scroll">
        <section className="settings-column" aria-labelledby="settings-heading">
          <h1 id="settings-heading">{def.title}</h1>
          {def.panel ? (
            createElement(panels[def.panel])
          ) : (
            <div className="settings-card">
              {def.settings.map((s) => (
                <SettingRow key={s.key} def={s} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SettingRow({ def }: { def: RowDef }) {
  const id = useId();
  return (
    <div className="settings-row">
      <div className="settings-text">
        <label id={`${id}-label`} htmlFor={`${id}-control`}>
          {def.label}
        </label>
        <p id={`${id}-desc`}>{def.description}</p>
      </div>
      {def.kind === "toggle" ? <Toggle def={def} id={id} /> : <Choice def={def} id={id} />}
    </div>
  );
}

function Toggle({ def, id }: { def: Extract<RowDef, { kind: "toggle" }>; id: string }) {
  const on = useSetting(def.key);
  return (
    <button
      id={`${id}-control`}
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-desc`}
      className="switch"
      onClick={() => setSetting(def.key, !on)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

function Choice({ def, id }: { def: Extract<RowDef, { kind: "choice" }>; id: string }) {
  const value = useSetting(def.key);
  return (
    <div className="settings-select">
      <select
        id={`${id}-control`}
        aria-describedby={`${id}-desc`}
        value={String(value)}
        onChange={(e) => setSetting(def.key, Number(e.target.value))}
      >
        {def.options.map((o) => (
          <option key={o} value={String(o)}>
            {o} px
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden />
    </div>
  );
}
