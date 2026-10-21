// Chord matching. "Mod" is Cmd on macOS and Ctrl elsewhere.

const isMac = navigator.platform.toLowerCase().includes("mac");

export function matchesChord(e: KeyboardEvent, chord: string): boolean {
  const parts = chord.split("+");
  const key = parts.pop()!.toLowerCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const wantCtrl = mods.has("ctrl") || (!isMac && mods.has("mod"));
  const wantMeta = isMac && mods.has("mod");
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta) return false;
  if (mods.has("shift") !== e.shiftKey || mods.has("alt") !== e.altKey) return false;
  const code = e.code.toLowerCase();
  return e.key.toLowerCase() === key || code === `key${key}` || code === `digit${key}` || (key === "`" && code === "backquote");
}

export function chordLabel(chord: string): string {
  return chord
    .split("+")
    .map((p) => (p === "Mod" ? (isMac ? "⌘" : "Ctrl") : p === "Ctrl" ? (isMac ? "⌃" : "Ctrl") : p === "Shift" ? (isMac ? "⇧" : "Shift") : p === "Alt" ? (isMac ? "⌥" : "Alt") : p.toUpperCase()))
    .join(isMac ? "" : "+");
}
