import { X } from "lucide-react";
import { useStore } from "@/core/store";
import { activateTab, closeDocument, docDirty, docsState, moveTab } from "./documents";

interface TabView {
  path: string;
  name: string;
  dir: string;
  dirty: boolean;
  conflict: boolean;
  deleted: boolean;
}

function tabsEqual(a: TabView[], b: TabView[]) {
  return a.length === b.length && a.every((t, i) => {
    const u = b[i]!;
    return t.path === u.path && t.dirty === u.dirty && t.conflict === u.conflict && t.deleted === u.deleted && t.name === u.name && t.dir === u.dir;
  });
}

export function TabBar() {
  const active = useStore(docsState, (s) => s.active);
  const tabs = useStore(
    docsState,
    (s) => {
      const names = new Map<string, number>();
      for (const d of s.open) names.set(base(d.path), (names.get(base(d.path)) ?? 0) + 1);
      return s.open.map((d) => ({
        path: d.path,
        name: base(d.path),
        // Show the folder only when two open tabs share a name.
        dir: (names.get(base(d.path)) ?? 0) > 1 ? dir(d.path) : "",
        dirty: docDirty(d),
        conflict: d.disk.kind === "changed",
        deleted: d.disk.kind === "deleted",
      }));
    },
    tabsEqual,
  );
  if (!tabs.length) return null;
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t, i) => (
        <div
          key={t.path}
          role="tab"
          aria-selected={t.path === active}
          className={`tab${t.path === active ? " active" : ""}${t.deleted ? " deleted" : ""}${t.conflict ? " conflict" : ""}`}
          title={t.path}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/l1-tab", t.path)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const p = e.dataTransfer.getData("text/l1-tab");
            if (p) moveTab(p, i);
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              void closeDocument(t.path);
            }
          }}
          onClick={() => activateTab(t.path)}
        >
          <span className="tab-name">{t.name}</span>
          {t.dir && <span className="tab-dir">{t.dir}</span>}
          <button
            className={`tab-close${t.dirty ? " dirty" : ""}`}
            aria-label={`Close ${t.name}`}
            onClick={(e) => {
              e.stopPropagation();
              void closeDocument(t.path);
            }}
          >
            <span className="dot" />
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function base(p: string) {
  return p.slice(p.lastIndexOf("/") + 1);
}
function dir(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
