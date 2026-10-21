// The middle column: tab bar, conflict banner, and the one EditorView that renders the active doc.

import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { useStore } from "@/core/store";
import { bindView, dispatchFromView, docsState } from "./documents";
import { TabBar } from "./TabBar";
import { ConflictBanner } from "./ConflictBanner";
import "./editor.css";

export default function EditorPane() {
  const host = useRef<HTMLDivElement>(null);
  const binding = useRef<ReturnType<typeof bindView> | null>(null);
  const active = useStore(docsState, (s) => s.active);
  const hasDocs = useStore(docsState, (s) => s.open.length > 0);

  useEffect(() => {
    const view = new EditorView({ parent: host.current!, dispatchTransactions: dispatchFromView });
    binding.current = bindView(view);
    binding.current.show(docsState.get().active);
    return () => {
      binding.current?.unbind();
      binding.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    binding.current?.show(active);
  }, [active]);

  return (
    <div className="editor-pane">
      <TabBar />
      <ConflictBanner />
      <div className="editor-host" ref={host} style={{ display: hasDocs ? undefined : "none" }} />
      {!hasDocs && <EmptyEditor />}
    </div>
  );
}

function EmptyEditor() {
  const mod = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";
  return (
    <div className="editor-empty">
      <div className="editor-empty-mark">L1</div>
      <dl>
        <dt>Quick open</dt>
        <dd>{mod}P</dd>
        <dt>Filter files</dt>
        <dd>{mod}⇧E</dd>
        <dt>Terminal</dt>
        <dd>⌃`</dd>
        <dt>Toggle sidebars</dt>
        <dd>{mod}B / {mod}J</dd>
      </dl>
    </div>
  );
}
