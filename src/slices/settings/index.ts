// Settings slice: app-wide preferences, the page that edits them, and the color palette they resolve
// to. The shell decides when the page shows; consumers read `settings.state` or `appearance.state` and
// react to changes themselves.
// Public surface: `settings` (owner API), `appearance` (palette), `settingsSections` (registry), `SettingsPage`.

import { lazy } from "react";
import { paletteState, startAppearance } from "./appearance";
import { setSetting, settingsState, useSetting } from "./store";

export type { Settings, SettingsSectionId } from "./model";
export type { Palette } from "./palette";
export { settingsSections } from "./model";

export const settings = {
  state: settingsState,
  set: setSetting,
  useSetting,
};

/** The palette showing now. CSS reads it as variables on `<html>`; canvas consumers read the record. */
export const appearance = { start: startAppearance, state: paletteState };

export const SettingsPage = lazy(() => import("./SettingsPage"));
