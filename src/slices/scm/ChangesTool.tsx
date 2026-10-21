import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Columns2, FileText, RefreshCw, Rows2 } from "lucide-react";
import { PatchDiff, type FileDiffOptions } from "@pierre/diffs/react";
import { errorMessage, rust } from "@/core/ipc";
import { createStore, useStore } from "@/core/store";
import { editor } from "@/slices/editor";
import { focusStore, refresh, useScmState } from "./state";
import { patchStats, splitPath, type PatchStats } from "./paths";
import "./ChangesTool.css";

interface Item {
  readonly path: string;
  readonly patch: string;
  readonly stats: PatchStats;
}

interface DiffSet {
  readonly gen: number;
  readonly items: readonly Item[];
  readonly additions: number;
  readonly deletions: number;
}

type DiffStyle = "unified" | "split";
const diffStyle = createStore<DiffStyle>("unified");

/** Let the code fill the panel: no reserved scrollbar gutter beside it. */
const DIFF_CSS = `[data-code] { scrollbar-gutter: auto; }`;

/** The last result, so a remounted tool shows it immediately instead of a spinner. */
let cached: DiffSet | null = null;

const PAGE = 100;
/** Patches longer than this render only on request. */
const LARGE_LINES = 3000;
const LINE_PX = 20;

function toDiffSet(gen: number, patches: readonly { path: string; patch: string }[]): DiffSet {
  let additions = 0;
  let deletions = 0;
  const items = patches.map((p) => {
    const stats = patchStats(p.patch);
    additions += stats.additions;
    deletions += stats.deletions;
    return { path: p.path, patch: p.patch, stats };
  });
  return { gen, items, additions, deletions };
}

export default function ChangesTool() {
  const { status, gen } = useScmState();
  const isRepo = status !== null;
  const [data, setData] = useState<DiffSet | null>(cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const style = useStore(diffStyle);
  const scrollRef = useRef<HTMLDivElement>(null);
  const blocks = useRef(new Map<string, HTMLElement>());
  const latest = useRef(0);

  // Re-diff whenever git status completes a refresh. Keep the previous result while loading and
  // drop any response that a newer request has superseded.
  useEffect(() => {
    if (gen === 0 || !isRepo || cached?.gen === gen) return;
    const id = ++latest.current;
    setLoading(true);
    rust.gitDiff().then(
      (patches) => {
        if (id !== latest.current) return;
        cached = toDiffSet(gen, patches);
        setData(cached);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (id !== latest.current) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
  }, [gen, isRepo]);

  // Scroll the focused file into view once per focus request, after its diff is listed.
  const focus = useStore(focusStore);
  const doneSeq = useRef(0);
  useEffect(() => {
    if (!focus.path || focus.seq === doneSeq.current || !data) return;
    const index = data.items.findIndex((i) => i.path === focus.path);
    if (index < 0) {
      if (!loading) doneSeq.current = focus.seq;
      return;
    }
    if (index >= limit) {
      setLimit(index + PAGE);
      return;
    }
    doneSeq.current = focus.seq;
    blocks.current.get(focus.path)?.scrollIntoView({ block: "start" });
  }, [focus, data, loading, limit]);

  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({ theme: "pierre-dark", themeType: "dark", diffStyle: style, overflow: "scroll", disableFileHeader: true, unsafeCSS: DIFF_CSS }),
    [style],
  );

  const toolbar = (
    <div className="chg-toolbar">
      {data && (
        <>
          <span className="chg-count">
            {data.items.length} {data.items.length === 1 ? "file" : "files"}
          </span>
          <span className="chg-add mono">+{data.additions}</span>
          <span className="chg-del mono">−{data.deletions}</span>
        </>
      )}
      <span className="spacer" />
      <button
        className="icon-btn"
        title={style === "unified" ? "Split view" : "Unified view"}
        onClick={() => diffStyle.set(style === "unified" ? "split" : "unified")}
      >
        {style === "unified" ? <Columns2 /> : <Rows2 />}
      </button>
      <button className="icon-btn" title="Refresh" onClick={refresh}>
        <RefreshCw className={loading ? "chg-spin" : undefined} />
      </button>
    </div>
  );

  let body: ReactNode;
  if (gen === 0 && !data) body = <div className="empty">Loading…</div>;
  else if (!isRepo) body = <div className="empty">This folder is not a git repository.</div>;
  else if (!data) body = <div className="empty">{error ?? "Loading…"}</div>;
  else if (data.items.length === 0) body = <div className="empty">No changes</div>;
  else {
    const shown = data.items.slice(0, limit);
    body = (
      <>
        {shown.map((item) => (
          <FileBlock
            key={item.path}
            item={item}
            options={options}
            focused={item.path === focus.path}
            root={scrollRef}
            register={(el) => (el ? blocks.current.set(item.path, el) : blocks.current.delete(item.path))}
          />
        ))}
        {data.items.length > limit && (
          <div className="chg-more">
            <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, data.items.length - limit)} more of {data.items.length - limit}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="panel chg">
      {toolbar}
      {error && data && <div className="chg-error selectable">{error}</div>}
      <div className="panel-body chg-scroll native-scroll" ref={scrollRef}>
        {body}
      </div>
    </div>
  );
}

function FileBlock({
  item,
  options,
  focused,
  root,
  register,
}: {
  item: Item;
  options: FileDiffOptions<undefined, undefined>;
  focused: boolean;
  root: RefObject<HTMLDivElement | null>;
  register: (el: HTMLElement | null) => void;
}) {
  const { name, dir } = splitPath(item.path);
  const { stats } = item;
  const [visible, setVisible] = useState(false);
  const [forced, setForced] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Mount the diff only once it nears the viewport; keep it mounted after that.
  useEffect(() => {
    const el = bodyRef.current;
    if (visible || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: root.current, rootMargin: "200px 0px 800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, root]);

  let content: ReactNode;
  if (stats.binary) content = <div className="chg-note">Binary file changed.</div>;
  else if (stats.lines === 0) content = <div className="chg-note">No textual changes.</div>;
  else if (stats.lines > LARGE_LINES && !forced)
    content = (
      <div className="chg-note">
        Large diff ({stats.lines.toLocaleString()} lines).{" "}
        <button className="btn" onClick={() => setForced(true)}>
          Render
        </button>
      </div>
    );
  else if (!visible) content = <div className="chg-placeholder" style={{ height: Math.min(stats.lines, LARGE_LINES) * LINE_PX }} />;
  else
    content = (
      <DiffBoundary resetKey={item.patch} patch={item.patch}>
        <PatchDiff patch={item.patch} options={options} />
      </DiffBoundary>
    );

  return (
    <section className={`chg-file${focused ? " focused" : ""}`} ref={register}>
      <header className="chg-file-head" title={item.path}>
        <span className={`chg-name${stats.deleted ? " chg-deleted" : ""}`}>{name}</span>
        {dir && <span className="chg-dir">{dir}</span>}
        <span className="spacer" />
        {stats.additions > 0 && <span className="chg-add mono">+{stats.additions}</span>}
        {stats.deletions > 0 && <span className="chg-del mono">−{stats.deletions}</span>}
        {!stats.deleted && (
          <button className="icon-btn" title="Open file" onClick={() => void editor.open(item.path)}>
            <FileText />
          </button>
        )}
      </header>
      <div ref={bodyRef}>{content}</div>
    </section>
  );
}

/** `PatchDiff` throws on patches it can't parse (mode-only changes, odd headers). Show the raw text. */
class DiffBoundary extends Component<{ resetKey: string; patch: string; children: ReactNode }, { failed: string | null }> {
  state: { failed: string | null } = { failed: null };

  static getDerivedStateFromError(e: unknown) {
    return { failed: errorMessage(e) };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: null });
  }

  render() {
    if (this.state.failed) return <pre className="chg-raw mono selectable">{this.props.patch}</pre>;
    return this.props.children;
  }
}
