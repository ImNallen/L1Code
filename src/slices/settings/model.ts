// The settings registry and the decode boundary for stored values. Each setting is one row in a
// section; the page, the section ids, and validation all derive from this table.

import type { LucideIcon } from "lucide-react";
import { SquareCode, SquareTerminal } from "lucide-react";

export interface Settings {
  readonly editorFontSize: number;
  readonly editorWordWrap: boolean;
  readonly terminalFontSize: number;
}

export const defaultSettings: Settings = {
  editorFontSize: 13,
  editorWordWrap: false,
  terminalFontSize: 12.5,
};

type KeyOf<V> = { [K in keyof Settings]: Settings[K] extends V ? K : never }[keyof Settings];

interface SettingBase {
  readonly label: string;
  readonly description: string;
}

export type SettingDef =
  | (SettingBase & { readonly kind: "toggle"; readonly key: KeyOf<boolean> })
  | (SettingBase & { readonly kind: "choice"; readonly key: KeyOf<number>; readonly options: readonly number[] });

interface SectionDef {
  readonly id: string;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly settings: readonly SettingDef[];
}

const sections = [
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
  return def.kind === "toggle" ? typeof v === "boolean" : typeof v === "number" && def.options.includes(v);
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
