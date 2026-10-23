// The settings registry and the decode boundary for stored values. Each setting is one row in a
// section, or belongs to a section that draws its own panel; the page, the section ids, and
// validation all derive from this table.

import type { LucideIcon } from "lucide-react";
import { Palette, SquareCode } from "lucide-react";
import { fontSurfaces, type FontDef } from "./fonts";
import { themeIds, type ThemeId } from "./themes";

export const appearanceModes = ["system", "light", "dark"] as const;
export type AppearanceMode = (typeof appearanceModes)[number];

export interface Settings {
  readonly appearanceMode: AppearanceMode;
  readonly lightTheme: ThemeId;
  readonly darkTheme: ThemeId;
  readonly uiFontFamily: string;
  readonly uiFontSize: number;
  readonly editorFontFamily: string;
  readonly editorFontSize: number;
  readonly editorWordWrap: boolean;
  readonly terminalFontFamily: string;
  readonly terminalFontSize: number;
}

export const defaultSettings: Settings = {
  appearanceMode: "system",
  lightTheme: "l1code",
  darkTheme: "l1code",
  uiFontFamily: "",
  uiFontSize: 13,
  editorFontFamily: "",
  editorFontSize: 13,
  editorWordWrap: false,
  terminalFontFamily: "",
  terminalFontSize: 12.5,
};

export type KeyOf<V> = { [K in keyof Settings]: Settings[K] extends V ? K : never }[keyof Settings];
/** Keys holding a font family list, where "" means the surface's default. */
export type FamilyKey = { [K in keyof Settings]: string extends Settings[K] ? K : never }[keyof Settings];

interface SettingBase {
  readonly label: string;
  readonly description: string;
}

type ToggleDef = SettingBase & { readonly kind: "toggle"; readonly key: KeyOf<boolean> };
type PickDef = { [K in KeyOf<string>]: SettingBase & { readonly kind: "pick"; readonly key: K; readonly options: readonly Settings[K][] } }[KeyOf<string>];

export type SettingDef = ToggleDef | PickDef | FontDef;
export type RowDef = ToggleDef;

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
      fontSurfaces.ui,
      fontSurfaces.editor,
      fontSurfaces.terminal,
    ],
  },
  {
    id: "editor",
    title: "Editor",
    icon: SquareCode,
    settings: [
      { kind: "toggle", key: "editorWordWrap", label: "Word wrap", description: "Wrap long lines at the editor's edge instead of scrolling sideways." },
    ],
  },
] as const satisfies readonly SectionDef[];

export type SettingsSectionId = (typeof sections)[number]["id"];
export type SettingsSection = SectionDef & { readonly id: SettingsSectionId };
export const settingsSections: readonly SettingsSection[] = sections;

const defs: readonly SettingDef[] = settingsSections.flatMap((s) => s.settings);

/** A stored value as the setting's value, or undefined to keep the default. */
type Decode = (v: unknown) => unknown;

const oneOf = (options: readonly unknown[]): Decode => (v) => (options.includes(v) ? v : undefined);
const toggle: Decode = (v) => (typeof v === "boolean" ? v : undefined);
const family: Decode = (v) => (typeof v === "string" && v.trim().length <= 200 ? v.trim() : undefined);

function fields(def: SettingDef): readonly (readonly [keyof Settings, Decode])[] {
  switch (def.kind) {
    case "toggle":
      return [[def.key, toggle]];
    case "pick":
      return [[def.key, oneOf(def.options)]];
    case "font":
      return [
        [def.family, family],
        [def.size, oneOf(def.options)],
      ];
  }
}

/** Stored JSON to settings. Each key falls back to its default on its own, so one bad value can't reset the rest. */
export function parseSettings(text: string | null): Settings {
  const raw = parseJson(text);
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<keyof Settings, unknown> = { ...defaultSettings };
  for (const [key, decode] of defs.flatMap(fields)) {
    const v = decode(stored[key]);
    if (v !== undefined) out[key] = v;
  }
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
