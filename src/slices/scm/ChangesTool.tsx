import { Component, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowDown, ArrowUp, Columns2, FileText, GitBranch, RefreshCw, Rows2, Square, SquareCheck, SquareMinus, Undo2 } from "lucide-react";
import { PatchDiff, type FileDiffOptions } from "@pierre/diffs/react";
import { ask } from "@tauri-apps/plugin-dialog";
import { errorMessage, rust, type GitFile } from "@/core/ipc";
import { createStore, useStore } from "@/core/store";
import { editor } from "@/slices/editor";
import { CommitBox } from "./CommitBox";
import { discard, focusStore, groupFiles, refresh, stage, unstage, useScmState } from "./state";
import { patchStats, splitPath, type PatchStats } from "./paths";
import "./ChangesTool.css";

interface Item {
  readonly path: string;
  readonly patch: string;
  readonly stats: PatchStats;
  /** In git status but without a patch: `git_diff` skips large or numerous untracked files. */
  readonly omitted?: boolean;
}

const NO_PATCH: PatchStats = { additions: 0, deletions: 0, lines: 0, deleted: false, binary: false };

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
const DIFF_THEME = { light: "pierre-light", dark: "pierre-dark" };

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
  const { status, gen, error: statusError } = useScmState();
  const isRepo = status !== null;
  const gitFiles = useMemo(() => new Map((status?.files ?? []).map((f) => [f.path, f])), [status]);
  const groups = useMemo(() => groupFiles(status?.files ?? []), [status]);
  const [data, setData] = useState<DiffSet | null>(cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const style = useStore(diffStyle);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Every changed file gets a row, so files without a patch can still be staged or discarded.
  const items = useMemo<readonly Item[]>(() => {
    if (!data) return [];
    if (!status || data.gen !== gen) return data.items;
    const listed = new Set(data.items.map((i) => i.path));
    const rest = status.files.filter((f) => !listed.has(f.path)).map((f) => ({ path: f.path, patch: "", stats: NO_PATCH, omitted: true }));
    return rest.length ? [...data.items, ...rest] : data.items;
  }, [data, status, gen]);
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
    const index = items.findIndex((i) => i.path === focus.path);
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
  }, [focus, data, items, loading, limit]);

  const options = useMemo<FileDiffOptions<undefined, undefined>>(
    () => ({ theme: DIFF_THEME, themeType: "system", diffStyle: style, overflow: "scroll", disableFileHeader: true, unsafeCSS: DIFF_CSS }),
    [style],
  );

  const allStaged = groups.staged.length > 0 && groups.changes.length === 0;
  const toolbar = (
    <div className="chg-toolbar">
      {status && (
        <>
          <GitBranch className="chg-branch-icon" />
          <span className="chg-branch" title={status.upstream ?? undefined}>
            {status.branch ?? "detached HEAD"}
          </span>
          {status.ahead > 0 && (
            <span className="chg-track" title={`${status.ahead} ahead of ${status.upstream ?? "upstream"}`}>
              <ArrowUp />
              {status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="chg-track" title={`${status.behind} behind ${status.upstream ?? "upstream"}`}>
              <ArrowDown />
              {status.behind}
            </span>
          )}
        </>
      )}
      {data && items.length > 0 && (
        <>
          <StageBox
            state={allStaged ? "all" : groups.staged.length > 0 ? "some" : "none"}
            title={allStaged ? "Unstage all" : "Stage all"}
            onClick={() => void (allStaged ? unstage(groups.staged.map((f) => f.path)) : stage(groups.changes.map((f) => f.path)))}
          />
          <span className="chg-count">
            {items.length} {items.length === 1 ? "file" : "files"}
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
  else if (!isRepo) body = <div className="empty selectable">{statusError ? `Couldn't read git status: ${statusError}` : "This folder is not a git repository."}</div>;
  else if (!data) body = <div className="empty">{error ?? "Loading…"}</div>;
  else if (items.length === 0) body = <div className="empty">No changes</div>;
  else {
    const shown = items.slice(0, limit);
    body = (
      <>
        {shown.map((item) => (
          <FileBlock
            key={item.path}
            item={item}
            file={gitFiles.get(item.path)}
            options={options}
            focused={item.path === focus.path}
            root={scrollRef}
            register={(el) => (el ? blocks.current.set(item.path, el) : blocks.current.delete(item.path))}
          />
        ))}
        {items.length > limit && (
          <div className="chg-more">
            <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, items.length - limit)} more of {items.length - limit}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="panel chg">
      {toolbar}
      {status && status.files.length > 0 && <CommitBox stagedCount={groups.staged.length} totalCount={status.files.length} />}
      {statusError && isRepo && <div className="chg-error selectable">Couldn't refresh git status: {statusError}</div>}
      {error && data && <div className="chg-error selectable">{error}</div>}
      <div className="panel-body chg-scroll native-scroll" ref={scrollRef}>
        {body}
      </div>
    </div>
  );
}

function FileBlock({
  item,
  file,
  options,
  focused,
  root,
  register,
}: {
  item: Item;
  file: GitFile | undefined;
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
  if (item.omitted) content = <div className="chg-note">No diff shown. The file is over 1 MiB, or there are over 200 untracked files.</div>;
  else if (stats.binary) content = <div className="chg-note">Binary file changed.</div>;
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
        {file && <FileStageBox file={file} />}
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
        {file?.unstaged && file.unstaged !== "conflicted" && file.staged !== "conflicted" && (
          <button className="icon-btn" title="Discard changes" onClick={() => void confirmDiscard(file)}>
            <Undo2 />
          </button>
        )}
      </header>
      <div ref={bodyRef}>{content}</div>
    </section>
  );
}

type Staged = "none" | "some" | "all";

function StageBox({ state, title, onClick }: { state: Staged; title: string; onClick(): void }) {
  const Icon = state === "all" ? SquareCheck : state === "some" ? SquareMinus : Square;
  return (
    <button className={`icon-btn chg-stage${state === "none" ? "" : " on"}`} title={title} aria-label={title} onClick={onClick}>
      <Icon />
    </button>
  );
}

/** Checked when fully staged, a dash when partly staged. A conflict is staged to mark it resolved. */
function FileStageBox({ file }: { file: GitFile }) {
  if (file.staged === "conflicted" || file.unstaged === "conflicted")
    return <StageBox state="none" title="Mark resolved" onClick={() => void stage([file.path])} />;
  if (file.staged && !file.unstaged) return <StageBox state="all" title="Unstage" onClick={() => void unstage([file.path])} />;
  return <StageBox state={file.staged ? "some" : "none"} title="Stage" onClick={() => void stage([file.path])} />;
}

async function confirmDiscard(file: GitFile) {
  const untracked = file.unstaged === "untracked";
  const ok = await ask(
    untracked ? `Move the untracked file ${file.path} to the trash?` : `Discard changes to ${file.path}? This cannot be undone.`,
    { title: "Discard changes", kind: "warning", okLabel: "Discard" },
  );
  if (ok) await discard(untracked ? [] : [file.path], untracked ? [file.path] : []);
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
