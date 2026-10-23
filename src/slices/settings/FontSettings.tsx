// The Fonts card on the Appearance panel: one row per font surface with its family, its size, and a
// live preview in that surface's font.

import { useEffect, useId } from "react";
import { ChevronDown } from "lucide-react";
import { useStore } from "@/core/store";
import FontPicker, { loadFonts } from "./FontPicker";
import { fontStack, fontSurfaces, type FontSurface } from "./fonts";
import { setSetting, settingsState, useSetting } from "./store";

const SURFACES = ["ui", "editor", "terminal"] as const satisfies readonly FontSurface[];

const SAMPLE: Readonly<Record<FontSurface, string>> = {
  ui: "The quick brown fox jumps over the lazy dog.",
  editor: "const total = items.reduce((sum, x) => sum + x, 0); // 0O 1lI",
  terminal: "~/l1code $ git log --oneline -3",
};

export default function FontSettings() {
  // Load the installed list now, not when a picker opens: the closed pickers name the default face from it.
  useEffect(loadFonts, []);
  return (
    <div className="settings-card">
      {SURFACES.map((s) => (
        <FontRow key={s} surface={s} />
      ))}
    </div>
  );
}

function FontRow({ surface }: { surface: FontSurface }) {
  const id = useId();
  const def = fontSurfaces[surface];
  const size = useSetting(def.size);
  const stack = useStore(settingsState, (s) => fontStack(surface, s));
  return (
    <div className="settings-row font-row">
      <div className="settings-text">
        <label id={`${id}-label`} htmlFor={`${id}-family`}>
          {def.label}
        </label>
        <p id={`${id}-desc`}>{def.description}</p>
      </div>
      <div className="font-controls">
        <FontPicker surface={surface} id={`${id}-family`} labelledBy={`${id}-label`} describedBy={`${id}-desc`} />
        <div className="settings-select">
          <select
            id={`${id}-size`}
            aria-label={`${def.label} font size`}
            aria-describedby={`${id}-desc`}
            value={String(size)}
            onChange={(e) => setSetting(def.size, Number(e.target.value))}
          >
            {def.options.map((o) => (
              <option key={o} value={String(o)}>
                {o} px
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden />
        </div>
      </div>
      <div className="font-preview" aria-hidden style={{ fontFamily: stack, fontSize: `${size}px` }}>
        {SAMPLE[surface]}
      </div>
    </div>
  );
}
