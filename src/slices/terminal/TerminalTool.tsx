import { useEffect, useRef } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { useStore } from "@/core/store";
import { attach, closeSession, ensureSession, openSession, setActive, terminalState } from "./sessions";
import "./terminal.css";

export default function TerminalTool() {
  const { sessions, active, ready } = useStore(terminalState);
  const root = useRef<HTMLDivElement>(null);

  // Open a first shell once the tool is actually visible (keepAlive tools can mount hidden).
  useEffect(() => {
    const el = root.current;
    if (!el || !ready) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) ensureSession();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  return (
    <div ref={root} className="panel terminal-tool">
      <div className="terminal-tabs">
        {sessions.map((s, i) => (
          <div
            key={s.id}
            className={`terminal-tab${s.id === active ? " active" : ""}${s.exited ? " exited" : ""}`}
            title={s.exited ? `${s.title} (exited)` : s.title}
            onClick={() => setActive(s.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeSession(s.id);
            }}
          >
            <SquareTerminal className="terminal-tab-icon" />
            <span className="terminal-tab-title">{s.title}</span>
            {sessions.length > 1 && <span className="terminal-tab-index">{i + 1}</span>}
            <button
              type="button"
              className="terminal-tab-close"
              title="Kill terminal"
              onClick={(e) => {
                e.stopPropagation();
                closeSession(s.id);
              }}
            >
              <X />
            </button>
          </div>
        ))}
        <button type="button" className="icon-btn" title="New terminal" onClick={() => void openSession()}>
          <Plus />
        </button>
      </div>
      {active !== null ? (
        <Surface key={active} id={active} />
      ) : (
        <div className="empty terminal-empty">
          {ready ? (
            <button type="button" className="btn" onClick={() => void openSession()}>
              <Plus size={14} /> New terminal
            </button>
          ) : (
            "Starting…"
          )}
        </div>
      )}
    </div>
  );
}

function Surface({ id }: { id: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => (el.current ? attach(id, el.current) : undefined), [id]);
  return <div ref={el} className="terminal-surface" />;
}
