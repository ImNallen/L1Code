type HostInputField = "type" | "eventPhase" | "composedPath" | "ctrlKey" | "metaKey" | "shiftKey";

export type TreeInputEvent =
  | Pick<MouseEvent, HostInputField | "button">
  | Pick<KeyboardEvent, HostInputField | "key" | "code" | "isComposing" | "keyCode">;

export type SelectionIntent = "replace" | "delta" | "preserve";

export function selectionIntentFor(
  event: TreeInputEvent,
  { searchOpen, hasFocusedItem }: { searchOpen: boolean; hasFocusedItem: boolean },
): SelectionIntent | null {
  let row = false;
  let tree = false;
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    const role = target.getAttribute("role");
    const editable = target.getAttribute("contenteditable");
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      || (target.tagName === "BUTTON" && role !== "treeitem")
      || (editable !== null && editable !== "false")
      || role === "menu" || role?.startsWith("menuitem") || role === "textbox" || role === "combobox") return null;
    if (role === "treeitem") row = true;
    if (role === "tree") tree = true;
  }
  const modified = event.ctrlKey || event.metaKey;
  if (!("key" in event)) {
    if (event.type !== "click" || event.button !== 0 || !row) return null;
    return modified ? "delta" : "replace";
  }
  if (event.type !== "keydown" || (!row && !tree)) return null;
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === "F2") return "preserve";
  if (searchOpen) return event.key === "Enter" ? "replace" : "preserve";
  if (!hasFocusedItem) return "preserve";
  if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) return "delta";
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) return "preserve";
  if (modified && (event.code === "Space" || event.key === " " || event.key === "Spacebar")) return "delta";
  if (modified && event.key.toLowerCase() === "a") return "replace";
  return "preserve";
}
