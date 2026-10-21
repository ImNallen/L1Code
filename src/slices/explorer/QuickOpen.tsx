// Cmd+P: fuzzy-find a file by path and open it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/core/store";
import { editor } from "@/slices/editor";
import { fuzzyMatch } from "./fuzzy";
import { quickOpenVisible as open } from "./quickOpenState";
import { explorerState, filePaths } from "./tree";

export default function QuickOpen() {
  const visible = useStore(open);
  if (!visible) return null;
  return <QuickOpenDialog onClose={() => open.set(false)} />;
}

function QuickOpenDialog({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const gen = useStore(explorerState, (s) => s.gen);
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    void gen;
    const paths = filePaths();
    return query ? fuzzyMatch(paths, query) : paths.slice(0, 60).map((path) => ({ path, score: 0, positions: [] as number[] }));
  }, [query, gen]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (i: number) => {
    const r = results[i];
    if (!r) return;
    onClose();
    void editor.open(r.path);
  };

  return (
    <div className="modal-backdrop quick-open-backdrop" onMouseDown={onClose}>
      <div className="quick-open" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="input quick-open-input"
          placeholder="Go to file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(index);
            }
          }}
        />
        <div className="quick-open-list" ref={list}>
          {results.map((r, i) => (
            <div key={r.path} className={`row${i === index ? " selected" : ""}`} onMouseEnter={() => setIndex(i)} onMouseDown={() => choose(i)}>
              <Highlighted path={r.path} positions={r.positions} />
            </div>
          ))}
          {!results.length && <div className="empty">No matching files</div>}
        </div>
      </div>
    </div>
  );
}

function Highlighted({ path, positions }: { path: string; positions: readonly number[] }) {
  const cut = path.lastIndexOf("/") + 1;
  const set = new Set(positions);
  const mark = (from: number, to: number) =>
    [...path.slice(from, to)].map((ch, i) => (set.has(from + i) ? <b key={from + i}>{ch}</b> : <span key={from + i}>{ch}</span>));
  return (
    <>
      <span className="name">{mark(cut, path.length)}</span>
      {cut > 0 && <span className="dim">{mark(0, cut - 1)}</span>}
    </>
  );
}
