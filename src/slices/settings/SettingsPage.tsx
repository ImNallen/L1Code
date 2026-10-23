// One settings section: a heading, then the section's own panel or a card of rows, each a label, a
// description, and its control.

import { createElement, useId, type ComponentType } from "react";
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
      <Toggle def={def} id={id} />
    </div>
  );
}

function Toggle({ def, id }: { def: RowDef; id: string }) {
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
