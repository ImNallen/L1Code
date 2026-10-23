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
import { appearance, settings } from "@/slices/settings";

/** Holds the language for a state. Shared across states: compartments are identity keys. */
export const languageSlot = new Compartment();
/** Holds line wrapping, reconfigured on every open doc when the setting changes. */
export const wrapSlot = new Compartment();
/** Holds CodeMirror's light or dark base theme, reconfigured on every open doc when the scheme changes. */
export const schemeSlot = new Compartment();

export const lineWrapping = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);
export const schemeFlag = (scheme: "light" | "dark"): Extension => EditorView.darkTheme.of(scheme === "dark");

/** Colors are CSS variables, so a theme switch repaints open and cached background states with no reconfigure. */
const syntax = (name: string) => `var(--syntax-${name})`;

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: syntax("comment"), fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: syntax("keyword") },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: syntax("string") },
  { tag: [t.number, t.bool, t.null, t.atom], color: syntax("number") },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: syntax("fn") },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: syntax("type") },
  { tag: [t.propertyName, t.attributeName], color: syntax("prop") },
  { tag: [t.tagName, t.heading], color: syntax("tag") },
  { tag: [t.constant(t.variableName), t.standard(t.variableName), t.self], color: syntax("constant") },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: syntax("punct") },
  { tag: t.heading, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: syntax("fn"), textDecoration: "underline" },
  { tag: t.invalid, color: syntax("invalid") },
]);

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--fg)", backgroundColor: "var(--bg)", fontSize: "var(--editor-font-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--accent)", padding: "6px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--editor-selection) !important" },
  ".cm-activeLine": { backgroundColor: "var(--editor-active-line)" },
  ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--editor-gutter)", border: "none", paddingLeft: "6px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-muted)" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--editor-gutter)", cursor: "pointer" },
  ".cm-matchingBracket": { backgroundColor: "var(--match-bg)", outline: "1px solid var(--match-line)" },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-bg)" },
  ".cm-searchMatch": { backgroundColor: "var(--search-bg)", outline: "1px solid var(--search-line)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--search-current)" },
  ".cm-panels": { backgroundColor: "var(--bg-elev)", color: "var(--fg)", borderColor: "var(--border)" },
  ".cm-panels input, .cm-panels button": { fontFamily: "var(--font-ui)", fontSize: "12px" },
  ".cm-textfield": { backgroundColor: "var(--bg-input)", border: "1px solid var(--border-strong)", borderRadius: "4px", color: "var(--fg)" },
  ".cm-button": { backgroundImage: "none", backgroundColor: "var(--bg-hover)", border: "1px solid var(--border-strong)", borderRadius: "4px", color: "var(--fg)" },
  ".cm-tooltip": { backgroundColor: "var(--bg-elev)", border: "1px solid var(--border-strong)", borderRadius: "6px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--bg-selected)", color: "var(--fg)" },
});

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
    schemeSlot.of(schemeFlag(appearance.state.get().scheme)),
  ];
}

/** Loads the language for `path`, or resolves null for plain text. */
export async function loadLanguage(path: string): Promise<Extension | null> {
  const name = path.split("/").pop() ?? path;
  const desc = LanguageDescription.matchFilename(languages, name);
  return desc ? desc.load() : null;
}
