// The window: title bar, three resizable columns, overlays, and toasts.

import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { PanelLeft, PanelRight, Plus, Search as SearchIcon, X } from "lucide-react";
import { chordLabel, matchesChord } from "@/core/keys";
import { onReveal } from "@/core/reveal";
import { allExtras, type Command, type LeftView, type RightTool } from "@/core/slice";
import { useStore } from "@/core/store";
import { dismissToast, toasts } from "@/core/toast";
import { workspaceState } from "@/core/workspace";
import { manifest, type LeftViewId, type RightToolId } from "@/slices/manifest";
import { pickFolder } from "./boot";
import { closeTool, columnResized, layout, revealView, setColumnOpen, showLeft, showRight, toggleColumn, toggleView } from "./layout";
import { Welcome } from "./Welcome";
import "./shell.css";

const extras = allExtras(manifest);

const shellCommands: Command[] = [
  { id: "shell.toggleLeft", chord: "Mod+b", run: () => toggleColumn("left") },
  { id: "shell.toggleRight", chord: "Mod+j", run: () => toggleColumn("right") },
  { id: "shell.toggleRightAlt", chord: "Mod+Alt+b", run: () => toggleColumn("right") },
  { id: "shell.openFolder", chord: "Mod+o", run: () => pickFolder() },
];

const commands: Command[] = [
  ...shellCommands,
  ...extras.flatMap((e) => e.commands ?? []),
  ...[...manifest.left, ...manifest.right]
    .filter((v) => v.shortcut)
    .map((v) => ({ id: `reveal.${v.id}`, chord: v.shortcut!, run: () => toggleView(v.id) })),
];

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = commands.find((c) => matchesChord(e, c.chord));
      if (!cmd) return;
      e.preventDefault();
      e.stopPropagation();
      void cmd.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => onReveal(revealView), []);
  // Text fields hold code and paths: no autocorrect, capitalization, or spellcheck anywhere.
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.setAttribute("autocorrect", "off");
        el.setAttribute("autocapitalize", "off");
        el.spellcheck = false;
      }
    };
    document.addEventListener("focusin", onFocus, true);
    return () => document.removeEventListener("focusin", onFocus, true);
  }, []);
}

export function Shell() {
  useGlobalKeys();
  const ws = useStore(workspaceState);
  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">{ws.status === "open" ? <Workbench /> : <Welcome />}</div>
      {ws.status === "open" &&
        extras.map((e, i) => {
          const Overlay = e.overlay;
          return Overlay ? (
            <Suspense key={i} fallback={null}>
              <Overlay />
            </Suspense>
          ) : null;
        })}
      <Toasts />
    </div>
  );
}

function TitleBar() {
  const ws = useStore(workspaceState);
  const leftOpen = useStore(layout, (s) => s.leftOpen);
  const rightOpen = useStore(layout, (s) => s.rightOpen);
  const open = ws.status === "open";
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        {open && (
          <button className={`icon-btn${leftOpen ? " active" : ""}`} title={`Toggle sidebar (${chordLabel("Mod+b")})`} onClick={() => toggleColumn("left")}>
            <PanelLeft />
          </button>
        )}
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {open ? (
          <button className="titlebar-search" onClick={() => void commands.find((c) => c.id === "explorer.quickOpen")?.run()}>
            <SearchIcon size={13} />
            <span>{ws.info.name}</span>
            <kbd>{chordLabel("Mod+p")}</kbd>
          </button>
        ) : (
          <span className="titlebar-title" data-tauri-drag-region>
            L1Code
          </span>
        )}
      </div>
      <div className="titlebar-right" data-tauri-drag-region>
        {open && (
          <button className={`icon-btn${rightOpen ? " active" : ""}`} title={`Toggle tools (${chordLabel("Mod+j")})`} onClick={() => toggleColumn("right")}>
            <PanelRight />
          </button>
        )}
      </div>
    </header>
  );
}

function Workbench() {
  const st = useStore(layout);
  const leftRef = useRef<PanelImperativeHandle | null>(null);
  const rightRef = useRef<PanelImperativeHandle | null>(null);
  const Main = manifest.main.component;

  // The layout store is the source of truth; drive the panels from it.
  useEffect(() => {
    const p = leftRef.current;
    if (p) syncPanel(p, st.leftOpen, layout.get().leftWidth);
  }, [st.leftOpen]);
  useEffect(() => {
    const p = rightRef.current;
    if (p) syncPanel(p, st.rightOpen, layout.get().rightWidth);
  }, [st.rightOpen]);

  return (
    <Group orientation="horizontal" className="workbench">
      <Panel
        id="left"
        panelRef={leftRef}
        defaultSize={st.leftOpen ? st.leftWidth : 0}
        minSize={180}
        collapsible
        collapsedSize={0}
        className="column column-left"
        onResize={(size, _id, prev) => prev && columnResized("left", size.inPixels)}
      >
        <LeftColumn active={st.left} />
      </Panel>
      <Separator className="sash" />
      <Panel id="main" minSize={300} className="column column-main">
        <Suspense fallback={null}>
          <Main />
        </Suspense>
      </Panel>
      <Separator className="sash" />
      <Panel
        id="right"
        panelRef={rightRef}
        defaultSize={st.rightOpen ? st.rightWidth : 0}
        minSize={260}
        collapsible
        collapsedSize={0}
        className="column column-right"
        onResize={(size, _id, prev) => prev && columnResized("right", size.inPixels)}
      >
        <RightColumn active={st.right} visited={st.visited} closed={st.closed} />
      </Panel>
    </Group>
  );
}

function syncPanel(p: PanelImperativeHandle, open: boolean, width: number) {
  const isOpen = !p.isCollapsed() && p.getSize().inPixels > 0;
  if (open && !isOpen) p.resize(width);
  if (!open && isOpen) p.collapse();
}

function LeftColumn({ active }: { active: LeftViewId }) {
  return (
    <div className="side">
      <div className="segmented" role="tablist">
        {manifest.left.map((v) => (
          <Segment key={v.id} view={v} active={v.id === active} onClick={() => showLeft(v.id as LeftViewId)} />
        ))}
      </div>
      <div className="side-body">
        {manifest.left.map((v) => (v.id === active || v.keepAlive ? <ViewHost key={v.id} view={v} visible={v.id === active} /> : null))}
      </div>
    </div>
  );
}

// Which right tools are available right now, from each tool's own `available` store.
function subscribeAvailability(listener: () => void) {
  const offs = manifest.right.map((v) => v.available?.subscribe(listener));
  return () => offs.forEach((off) => off?.());
}
function availableKey() {
  return manifest.right
    .filter((v) => v.available?.get() ?? true)
    .map((v) => v.id)
    .join(",");
}
function useAvailableTools(): readonly string[] {
  const key = useSyncExternalStore(subscribeAvailability, availableKey);
  return useMemo(() => (key ? key.split(",") : []), [key]);
}

function RightColumn({ active, visited, closed }: { active: RightToolId; visited: readonly RightToolId[]; closed: readonly RightToolId[] }) {
  const available = useAvailableTools();
  const open = manifest.right.filter((v) => available.includes(v.id) && !closed.includes(v.id as RightToolId));
  const reopenable = manifest.right.filter((v) => available.includes(v.id) && closed.includes(v.id as RightToolId));
  // An unavailable or closed active tool falls back to the first open one; the choice isn't stored.
  const current = open.find((v) => v.id === active) ?? open[0];
  return (
    <div className="side">
      <div className="tool-tabs" role="tablist">
        {open.map((v) => (
          <ToolTab
            key={v.id}
            view={v}
            active={v === current}
            onClick={() => showRight(v.id as RightToolId)}
            onClose={() => closeTool(v.id as RightToolId)}
          />
        ))}
        {reopenable.length > 0 && <ReopenMenu tools={reopenable} />}
        <div className="spacer" />
        <button className="icon-btn" title={`Hide panel (${chordLabel("Mod+j")})`} onClick={() => setColumnOpen("right", false)}>
          <PanelRight />
        </button>
      </div>
      <div className="side-body">
        {open.map((v) =>
          v === current || (v.keepAlive && visited.includes(v.id as RightToolId)) ? <ViewHost key={v.id} view={v} visible={v === current} /> : null,
        )}
        {!current && (
          <div className="empty">
            No tools open.
            {reopenable.length > 0 && (
              <div className="tool-empty-actions">
                {reopenable.map((v) => (
                  <button key={v.id} className="btn" onClick={() => showRight(v.id as RightToolId)}>
                    <v.icon size={14} /> {v.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReopenMenu({ tools }: { tools: readonly RightTool[] }) {
  // Fixed position from the button's rect: the scrolling tab strip would clip an absolute menu.
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="tool-reopen" ref={root}>
      <button
        className={`icon-btn${open ? " active" : ""}`}
        title="Open a tool"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen((o) => (o ? null : { top: r.bottom + 4, left: r.left }));
        }}
      >
        <Plus />
      </button>
      {open && (
        <div className="ctx-menu tool-menu" style={open}>
          {tools.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setOpen(null);
                showRight(v.id as RightToolId);
              }}
            >
              <v.icon size={14} />
              <span>{v.title}</span>
              {v.shortcut && <kbd>{chordLabel(v.shortcut)}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewHost({ view, visible }: { view: LeftView | RightTool; visible: boolean }) {
  const C = view.component;
  return (
    <div className="view-host" style={{ display: visible ? undefined : "none" }}>
      <Suspense fallback={<div className="empty">Loading…</div>}>
        <C />
      </Suspense>
    </div>
  );
}

function Badge({ view }: { view: LeftView | RightTool }) {
  const n = view.useBadge?.() ?? null;
  return n ? <span className="badge">{n > 999 ? "999+" : n}</span> : null;
}

function Segment({ view, active, onClick }: { view: LeftView; active: boolean; onClick(): void }) {
  const Icon = view.icon;
  return (
    <button role="tab" aria-selected={active} className={`segment${active ? " active" : ""}`} title={view.shortcut ? `${view.title} (${chordLabel(view.shortcut)})` : view.title} onClick={onClick}>
      <Icon size={14} />
      {active && <span>{view.title}</span>}
      {view.useBadge && <Badge view={view} />}
    </button>
  );
}

function ToolTab({ view, active, onClick, onClose }: { view: RightTool; active: boolean; onClick(): void; onClose(): void }): ReactNode {
  const Icon = view.icon;
  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tool-tab${active ? " active" : ""}`}
      title={view.shortcut ? `${view.title} (${chordLabel(view.shortcut)})` : view.title}
      onClick={onClick}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <Icon size={14} />
      <span>{view.title}</span>
      {view.useBadge && <Badge view={view} />}
      <button
        className="tool-close"
        aria-label={`Close ${view.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function Toasts() {
  const list = useStore(toasts);
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
