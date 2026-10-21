import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord } from "lucide-react";
import { onReveal } from "@/core/reveal";
import { useStore } from "@/core/store";
import { editor } from "@/slices/editor";
import { runSearch, searchState, setQuery, type FileHits, type Hit, type SearchQuery, type SearchSummary } from "./search";
import "./search.css";

/** Hit rows rendered before a "show more" row. Keeps huge result sets cheap to render. */
const PAGE = 2000;

type Toggle = keyof Pick<SearchQuery, "caseSensitive" | "wholeWord" | "regex">;

const TOGGLES: readonly { key: Toggle; label: string; icon: typeof Regex }[] = [
  { key: "caseSensitive", label: "Match case", icon: CaseSensitive },
  { key: "wholeWord", label: "Match whole word", icon: WholeWord },
  { key: "regex", label: "Use regular expression", icon: Regex },
];

export default function SearchView() {
  const { query, results, summary, running, error, runId } = useStore(searchState);
  const input = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return onReveal((id) => {
      if (id !== "search") return;
      input.current?.focus();
      input.current?.select();
    });
  }, []);

  // A new run starts from a clean slate.
  useEffect(() => {
    setCollapsed(new Set());
    setLimit(PAGE);
    setSelected(null);
  }, [runId]);

  const rows = useMemo(() => {
    const out: ({ kind: "file"; file: FileHits } | { kind: "hit"; path: string; hit: Hit; key: string })[] = [];
    let budget = limit;
    let more = false;
    for (const file of results) {
      if (budget <= 0) {
        more = true;
        break;
      }
      out.push({ kind: "file", file });
      if (collapsed.has(file.path)) continue;
      const shown = file.hits.slice(0, budget);
      for (const hit of shown) out.push({ kind: "hit", path: file.path, hit, key: `${file.path}:${hit.line}` });
      budget -= shown.length;
      if (shown.length < file.hits.length) {
        more = true;
        break;
      }
    }
    return { out, more };
  }, [results, collapsed, limit]);

  const toggleFile = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const openHit = (path: string, hit: Hit, key: string) => {
    setSelected(key);
    void editor.open(path, { line: hit.line, column: (hit.ranges[0]?.[0] ?? 0) + 1 });
  };

  return (
    <div className="panel search-view">
      <div className="search-box">
        <div className="search-field">
          <input
            ref={input}
            className="input search-input"
            value={query.pattern}
            placeholder="Search"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setQuery({ pattern: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
              if (e.key === "Escape" && query.pattern) setQuery({ pattern: "" }, true);
            }}
          />
          <div className="search-toggles">
            {TOGGLES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`icon-btn${query[t.key] ? " active" : ""}`}
                title={t.label}
                aria-pressed={query[t.key]}
                onClick={() => setQuery({ [t.key]: !query[t.key] }, true)}
              >
                <t.icon />
              </button>
            ))}
          </div>
        </div>
        <SummaryLine running={running} error={error} summary={summary} pattern={query.pattern} />
      </div>
      <div className="panel-body search-results">
        {rows.out.map((row) =>
          row.kind === "file" ? (
            <FileRow key={`f:${row.file.path}`} file={row.file} open={!collapsed.has(row.file.path)} onToggle={() => toggleFile(row.file.path)} />
          ) : (
            <div
              key={`h:${row.key}`}
              className={`row search-hit${selected === row.key ? " selected" : ""}`}
              title={`${row.path}:${row.hit.line}`}
              onClick={() => openHit(row.path, row.hit, row.key)}
            >
              <span className="search-line mono">{highlight(row.hit)}</span>
              <span className="search-lineno mono">{row.hit.line}</span>
            </div>
          ),
        )}
        {rows.more && (
          <button type="button" className="search-more" onClick={() => setLimit((l) => l + PAGE)}>
            Show more…
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryLine({ running, error, summary, pattern }: { running: boolean; error: string | null; summary: SearchSummary | null; pattern: string }) {
  if (error) return <div className="search-summary error selectable">{error}</div>;
  if (running) return <div className="search-summary">Searching…</div>;
  if (!summary || !pattern) return null;
  if (summary.matches === 0) return <div className="search-summary">No results</div>;
  return (
    <div className="search-summary">
      {plural(summary.matches, "result")} in {plural(summary.files, "file")}
      {summary.truncated && <span className="search-truncated"> (truncated)</span>}
    </div>
  );
}

function FileRow({ file, open, onToggle }: { file: FileHits; open: boolean; onToggle: () => void }) {
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash >= 0 ? file.path.slice(0, slash) : "";
  return (
    <div className="row search-file" title={file.path} onClick={onToggle}>
      {open ? <ChevronDown className="search-chevron" /> : <ChevronRight className="search-chevron" />}
      <span className="name">{name}</span>
      {dir && <span className="dim">{dir}</span>}
      <span className="badge search-count">{file.hits.length}</span>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** The line with its match ranges in `<mark>`. Ranges are code point offsets, not UTF-16. */
function highlight(hit: Hit): ReactNode[] {
  const { text, ranges } = hit;
  const chars = /[\uD800-\uDFFF]/.test(text) ? Array.from(text) : null;
  const len = chars ? chars.length : text.length;
  const slice = (a: number, b: number) => (chars ? chars.slice(a, b).join("") : text.slice(a, b));

  // Drop leading indentation, and skip far into long lines so the first match is visible.
  const first = ranges[0]?.[0] ?? 0;
  const indent = /^\s*/.exec(text)?.[0].length ?? 0;
  let from = Math.min(indent, first);
  let prefix = "";
  if (first - from > 40) {
    from = first - 20;
    prefix = "…";
  }

  const out: ReactNode[] = [];
  if (prefix) out.push(prefix);
  let at = from;
  ranges.forEach(([start, end], i) => {
    const s = Math.max(start, at);
    const e = Math.min(end, len);
    if (e <= s) return;
    if (s > at) out.push(slice(at, s));
    out.push(<mark key={i}>{slice(s, e)}</mark>);
    at = e;
  });
  if (at < len) out.push(slice(at, len));
  return out;
}
