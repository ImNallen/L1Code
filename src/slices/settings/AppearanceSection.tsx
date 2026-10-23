// The Appearance panel: color scheme buttons and theme cards. The artwork reads the compiled palettes,
// so each mockup and orb shows that theme's real colors whatever theme is showing.

import type { KeyboardEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { appearanceModes, type AppearanceMode } from "./model";
import { palettes, type Palette } from "./palette";
import { setSetting, useSetting } from "./store";
import { themes, type Scheme, type ThemeId } from "./themes";
import "./appearance.css";

const MODES: Readonly<Record<AppearanceMode, { label: string; aria: string }>> = {
  system: { label: "System", aria: "Follow the system appearance" },
  light: { label: "Light", aria: "Use light mode" },
  dark: { label: "Dark", aria: "Use dark mode" },
};
const SCHEMES = ["light", "dark"] as const satisfies readonly Scheme[];
const THEME_KEY = { light: "lightTheme", dark: "darkTheme" } as const;
const ARROW_STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export default function AppearanceSection() {
  const mode = useSetting("appearanceMode");
  const chosen = { light: useSetting("lightTheme"), dark: useSetting("darkTheme") };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEP[e.key];
    if (!step) return;
    e.preventDefault();
    const i = (appearanceModes.indexOf(mode) + step + appearanceModes.length) % appearanceModes.length;
    setSetting("appearanceMode", appearanceModes[i]!);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus();
  };

  return (
    <>
      <h2 className="settings-subhead">Color scheme</h2>
      <div className="mode-grid" role="radiogroup" aria-label="Appearance mode" onKeyDown={onKeyDown}>
        {appearanceModes.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={m === mode}
            aria-label={MODES[m].aria}
            tabIndex={m === mode ? 0 : -1}
            className="mode-btn"
            onClick={() => setSetting("appearanceMode", m)}
          >
            <span className="mode-art">
              {m !== "dark" && <Mockup p={palettes[chosen.light].light} />}
              {m !== "light" && <Mockup p={palettes[chosen.dark].dark} />}
            </span>
            <span className="mode-label">{MODES[m].label}</span>
          </button>
        ))}
      </div>
      <h2 className="settings-subhead">Themes</h2>
      <div className="theme-grid">
        {themes.map((t) => (
          <ThemeCard key={t.id} id={t.id} label={t.label} chosen={chosen} />
        ))}
      </div>
    </>
  );
}

function Mockup({ p: { ui } }: { p: Palette }) {
  return (
    <span className="mock" aria-hidden style={{ background: ui.bg, borderColor: ui.border }}>
      <span className="mock-side" style={{ background: ui.bgPanel, borderColor: ui.border }}>
        <i style={{ background: ui.bgSelected }} />
        <i style={{ background: ui.bgActive }} />
        <i style={{ background: ui.bgActive }} />
      </span>
      <span className="mock-main">
        <i style={{ background: ui.fgSubtle }} />
        <i style={{ background: ui.borderStrong }} />
        <i style={{ background: ui.borderStrong }} />
        <i style={{ background: ui.borderStrong }} />
      </span>
      <b style={{ background: ui.accent }} />
    </span>
  );
}

function ThemeCard({ id, label, chosen }: { id: ThemeId; label: string; chosen: Readonly<Record<Scheme, ThemeId>> }) {
  return (
    <div className="theme-card" data-active={SCHEMES.some((s) => chosen[s] === id) || undefined}>
      <button type="button" className="theme-card-main" title="Use for both light and dark" onClick={() => SCHEMES.forEach((s) => setSetting(THEME_KEY[s], id))}>
        {label}
      </button>
      <div className="theme-orbs" role="group" aria-label="Light and dark theme variants">
        {SCHEMES.map((s) => (
          <Orb key={s} id={id} label={label} scheme={s} active={chosen[s] === id} />
        ))}
      </div>
    </div>
  );
}

function Orb({ id, label, scheme, active }: { id: ThemeId; label: string; scheme: Scheme; active: boolean }) {
  const { fill, accent, glow } = palettes[id][scheme].orb;
  const Badge = scheme === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      className="theme-orb"
      aria-label={`Use ${scheme} variant of ${label}`}
      aria-pressed={active}
      onClick={() => setSetting(THEME_KEY[scheme], id)}
    >
      <span
        className="theme-orb-fill"
        style={{ background: `radial-gradient(circle at 28% 24%, ${accent}, transparent 62%), radial-gradient(circle at 76% 80%, ${glow}, transparent 60%), ${fill}` }}
      />
      {active && <Badge className="theme-badge" aria-hidden />}
    </button>
  );
}
