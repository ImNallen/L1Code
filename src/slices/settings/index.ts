// Settings slice: app-wide preferences and the page that edits them. The shell decides when the page
// shows; consumers read `settings.state` and react to changes themselves.
// Public surface: `settings` (owner API), `settingsSections` (registry), `SettingsPage`.

import { lazy } from "react";
import { setSetting, settingsState, useSetting } from "./store";

export type { Settings, SettingsSectionId } from "./model";
export { settingsSections } from "./model";

export const settings = {
  state: settingsState,
  set: setSetting,
  useSetting,
};

export const SettingsPage = lazy(() => import("./SettingsPage"));
