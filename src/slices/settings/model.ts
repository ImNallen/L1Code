// The settings registry and the decode boundary for stored values. Each setting is one row in a
// section, or belongs to a section that draws its own panel; the page, the section ids, and
// validation all derive from this table.

import type { LucideIcon } from "lucide-react";
import { Palette, SquareCode, SquareTerminal } from "lucide-react";
import { themeIds, type ThemeId } from "./themes";

export const appearanceModes = ["system", "light", "dark"] as const;
export type AppearanceMode = (typeof appearanceModes)[number];

export interface Settings {
  readonly appearanceMode: AppearanceMode;
  readonly lightTheme: ThemeId;
  readonly darkTheme: ThemeId;
  readonly editorFontSize: number;
  readonly editorWordWrap: boolean;
  readonly terminalFontSize: number;
}

export const defaultSettings: Settings = {
  appearanceMode: "system",
  lightTheme: "l1code",
  darkTheme: "l1code",
  editorFontSize: 13,
  editorWordWrap: false,
  terminalFontSize: 12.5,
};

type KeyOf<V> = { [K in keyof Settings]: Settings[K] extends V ? K : never }[keyof Settings];

interface SettingBase {
  readonly label: string;
  readonly description: string;
}

type ToggleDef = SettingBase & { readonly kind: "toggle"; readonly key: KeyOf<boolean> };
type ChoiceDef = SettingBase & { readonly kind: "choice"; readonly key: KeyOf<number>; readonly options: readonly number[] };
type PickDef = { [K in KeyOf<string>]: SettingBase & { readonly kind: "pick"; readonly key: K; readonly options: readonly Settings[K][] } }[KeyOf<string>];

export type SettingDef = ToggleDef | ChoiceDef | PickDef;
export type RowDef = ToggleDef | ChoiceDef;

export type PanelId = "appearance";

type SectionDef = { readonly id: string; readonly title: string; readonly icon: LucideIcon } & (
  | { readonly panel?: undefined; readonly settings: readonly RowDef[] }
  | { readonly panel: PanelId; readonly settings: readonly SettingDef[] }
);

const sections = [
  {
    id: "appearance",
    title: "Appearance",
    icon: Palette,
    panel: "appearance",
    settings: [
      { kind: "pick", key: "appearanceMode", label: "Color scheme", description: "Follow the system, or stay light or dark.", options: appearanceModes },
      { kind: "pick", key: "lightTheme", label: "Light theme", description: "The theme in light mode.", options: themeIds },
      { kind: "pick", key: "darkTheme", label: "Dark theme", description: "The theme in dark mode.", options: themeIds },
    ],
  },
  {
    id: "editor",
    title: "Editor",
    icon: SquareCode,
    settings: [
      {
        kind: "choice",
        key: "editorFontSize",
        label: "Font size",
        description: "Text size in the code editor, in pixels.",
        options: [11, 12, 13, 14, 15, 16, 18, 20],
      },
      { kind: "toggle", key: "editorWordWrap", label: "Word wrap", description: "Wrap long lines at the editor's edge instead of scrolling sideways." },
    ],
  },
  {
    id: "terminal",
    title: "Terminal",
    icon: SquareTerminal,
    settings: [
      {
        kind: "choice",
        key: "terminalFontSize",
        label: "Font size",
        description: "Text size in terminal sessions, in pixels.",
        options: [11, 12, 12.5, 13, 14, 15, 16, 18],
      },
    ],
  },
] as const satisfies readonly SectionDef[];

export type SettingsSectionId = (typeof sections)[number]["id"];
export type SettingsSection = SectionDef & { readonly id: SettingsSectionId };
export const settingsSections: readonly SettingsSection[] = sections;

const defs: readonly SettingDef[] = settingsSections.flatMap((s) => s.settings);

function accepts(def: SettingDef, v: unknown): boolean {
  return def.kind === "toggle" ? typeof v === "boolean" : (def.options as readonly unknown[]).includes(v);
}

/** Stored JSON to settings. Each key falls back to its default on its own, so one bad value can't reset the rest. */
export function parseSettings(text: string | null): Settings {
  const raw = parseJson(text);
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<keyof Settings, unknown> = { ...defaultSettings };
  for (const def of defs) if (accepts(def, stored[def.key])) out[def.key] = stored[def.key];
  return out as Settings;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
