// CodeMirror 6 configuration: base extensions, theme, and lazy language loading.

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { settings } from "@/slices/settings";

/** Holds the language for a state. Shared across states: compartments are identity keys. */
export const languageSlot = new Compartment();
/** Holds line wrapping, reconfigured on every open doc when the setting changes. */
export const wrapSlot = new Compartment();

export const lineWrapping = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);

const palette = {
  fg: "#d7dce4",
  comment: "#6b7383",
  keyword: "#c792ea",
  string: "#a5d6a7",
  number: "#f78c6c",
  fn: "#82aaff",
  type: "#ffcb6b",
  prop: "#89ddff",
  tag: "#f07178",
  attr: "#ffcb6b",
  constant: "#f78c6c",
  invalid: "#f2777a",
};

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: palette.comment, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: palette.keyword },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: palette.string },
  { tag: [t.number, t.bool, t.null, t.atom], color: palette.number },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: palette.fn },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: palette.type },
  { tag: [t.propertyName, t.attributeName], color: palette.prop },
  { tag: [t.tagName, t.heading], color: palette.tag },
  { tag: [t.constant(t.variableName), t.standard(t.variableName), t.self], color: palette.constant },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "#a9b1c1" },
  { tag: t.heading, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: palette.fn, textDecoration: "underline" },
  { tag: t.invalid, color: palette.invalid },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", color: palette.fg, backgroundColor: "var(--bg)", fontSize: "var(--editor-font-size)" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
    ".cm-content": { caretColor: "var(--accent)", padding: "6px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#2a3b5c !important" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-gutters": { backgroundColor: "var(--bg)", color: "#4b5261", border: "none", paddingLeft: "6px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-muted)" },
    ".cm-foldGutter .cm-gutterElement": { color: "#4b5261", cursor: "pointer" },
    ".cm-matchingBracket": { backgroundColor: "rgba(122,162,255,0.18)", outline: "1px solid rgba(122,162,255,0.4)" },
    ".cm-selectionMatch": { backgroundColor: "rgba(122,162,255,0.12)" },
    ".cm-searchMatch": { backgroundColor: "rgba(229,192,123,0.25)", outline: "1px solid rgba(229,192,123,0.5)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(229,192,123,0.45)" },
    ".cm-panels": { backgroundColor: "var(--bg-elev)", color: palette.fg, borderColor: "var(--border)" },
    ".cm-panels input, .cm-panels button": { fontFamily: "var(--font-ui)", fontSize: "12px" },
    ".cm-textfield": { backgroundColor: "var(--bg-input)", border: "1px solid var(--border-strong)", borderRadius: "4px", color: palette.fg },
    ".cm-button": { backgroundImage: "none", backgroundColor: "var(--bg-hover)", border: "1px solid var(--border-strong)", borderRadius: "4px", color: palette.fg },
    ".cm-tooltip": { backgroundColor: "var(--bg-elev)", border: "1px solid var(--border-strong)", borderRadius: "6px" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--bg-selected)", color: palette.fg },
  },
  { dark: true },
);

/** Everything a document's EditorState needs except its language, which loads lazily. */
export function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    indentUnit.of("  "),
    syntaxHighlighting(highlight),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ activateOnTyping: true }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    theme,
    languageSlot.of([]),
    wrapSlot.of(lineWrapping(settings.state.get().editorWordWrap)),
  ];
}

/** Loads the language for `path`, or resolves null for plain text. */
export async function loadLanguage(path: string): Promise<Extension | null> {
  const name = path.split("/").pop() ?? path;
  const desc = LanguageDescription.matchFilename(languages, name);
  return desc ? desc.load() : null;
}
