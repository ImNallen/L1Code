import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, FileText, GitBranch, Minus, Plus, RefreshCw, Undo2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { ChangeKind, GitFile } from "@/core/ipc";
import { editor } from "@/slices/editor";
import {
  commit,
  discard,
  groupFiles,
  refresh,
  setCommitMessage,
  showChanges,
  stage,
  unstage,
  useCommitMessage,
  useFocusedPath,
  useScmState,
} from "./state";
import { splitPath, statusLetter } from "./paths";
import "./ScmView.css";

export default function ScmView() {
  const { status, gen, refreshing, error } = useScmState();
  const groups = useMemo(() => groupFiles(status?.files ?? []), [status]);

  return (
    <div className="panel scm">
      <div className="scm-head">
        <GitBranch className="scm-branch-icon" />
        <span className="scm-branch" title={status?.upstream ?? undefined}>
          {status ? (status.branch ?? "detached HEAD") : "Source Control"}
        </span>
        {status && status.ahead > 0 && (
          <span className="scm-track" title={`${status.ahead} ahead of ${status.upstream ?? "upstream"}`}>
            <ArrowUp />
            {status.ahead}
          </span>
        )}
        {status && status.behind > 0 && (
          <span className="scm-track" title={`${status.behind} behind ${status.upstream ?? "upstream"}`}>
            <ArrowDown />
            {status.behind}
          </span>
        )}
        <span className="spacer" />
        <button className="icon-btn" title="Refresh" onClick={refresh}>
          <RefreshCw className={refreshing ? "scm-spin" : undefined} />
        </button>
      </div>
      {error && <div className="scm-error selectable">{error}</div>}
      {status ? (
        <div className="panel-body">
          <CommitBox stagedCount={groups.staged.length} totalCount={status.files.length} />
          {groups.staged.length > 0 && (
            <Group
              title="Staged Changes"
              files={groups.staged}
              staged
              actions={
                <button className="icon-btn" title="Unstage all" onClick={stop(() => void unstage(groups.staged.map((f) => f.path)))}>
                  <Minus />
                </button>
              }
            />
          )}
          <Group
            title="Changes"
            files={groups.changes}
            staged={false}
            actions={
              groups.changes.length > 0 && (
                <button className="icon-btn" title="Stage all" onClick={stop(() => void stage(groups.changes.map((f) => f.path)))}>
                  <Plus />
                </button>
              )
            }
          />
          {status.files.length === 0 && <div className="empty">No changes.</div>}
        </div>
      ) : (
        <div className="empty">{gen === 0 ? "Loading…" : error ? "Could not read git status." : "This folder is not a git repository."}</div>
      )}
    </div>
  );
}

function CommitBox({ stagedCount, totalCount }: { stagedCount: number; totalCount: number }) {
  const message = useCommitMessage();
  const [busy, setBusy] = useState(false);
  const canCommit = !busy && message.trim().length > 0 && totalCount > 0;

  const run = async () => {
    if (!canCommit) return;
    setBusy(true);
    const ok = await commit(message.trim(), stagedCount === 0);
    setBusy(false);
    if (ok) setCommitMessage("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
    }
  };

  return (
    <div className="scm-commit">
      <textarea
        className="input"
        rows={3}
        placeholder={`Message (${navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+"}Enter to commit)`}
        value={message}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="btn primary" disabled={!canCommit} onClick={() => void run()} title={stagedCount === 0 ? "Stage all changes and commit" : "Commit staged changes"}>
        <Check size={14} />
        {stagedCount === 0 && totalCount > 0 ? "Commit All" : "Commit"}
      </button>
    </div>
  );
}

function Group({ title, files, staged, actions }: { title: string; files: readonly GitFile[]; staged: boolean; actions: ReactNode }) {
  const [open, setOpen] = useState(true);
  const focused = useFocusedPath();
  return (
    <div className="scm-group">
      <div className="row scm-group-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="scm-chevron" /> : <ChevronRight className="scm-chevron" />}
        <span className="name">{title}</span>
        <span className="actions">{actions}</span>
        <span className="badge">{files.length}</span>
      </div>
      {open && files.map((f) => <FileRow key={f.path} file={f} staged={staged} selected={f.path === focused} />)}
    </div>
  );
}

function FileRow({ file, staged, selected }: { file: GitFile; staged: boolean; selected: boolean }) {
  const kind: ChangeKind | null =
    file.staged === "conflicted" || file.unstaged === "conflicted" ? "conflicted" : staged ? file.staged : file.unstaged;
  const { name, dir } = splitPath(file.path);
  const deleted = kind === "deleted";

  const onDiscard = async () => {
    const untracked = file.unstaged === "untracked";
    const ok = await ask(
      untracked ? `Move the untracked file ${file.path} to the trash?` : `Discard changes to ${file.path}? This cannot be undone.`,
      { title: "Discard changes", kind: "warning", okLabel: "Discard" },
    );
    if (ok) await discard(untracked ? [] : [file.path], untracked ? [file.path] : []);
  };

  return (
    <div
      className={`row scm-file${selected ? " selected" : ""}`}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
      onClick={() => showChanges(file.path)}
      onDoubleClick={() => !deleted && void editor.open(file.path)}
    >
      <span className={`name${deleted ? " scm-deleted" : ""}`}>{name}</span>
      {dir && <span className="dim">{dir}</span>}
      <span className="actions">
        {!deleted && (
          <button className="icon-btn" title="Open file" onClick={stop(() => void editor.open(file.path))}>
            <FileText />
          </button>
        )}
        {!staged && kind !== "conflicted" && (
          <button className="icon-btn" title="Discard changes" onClick={stop(() => void onDiscard())}>
            <Undo2 />
          </button>
        )}
        {staged ? (
          <button className="icon-btn" title="Unstage" onClick={stop(() => void unstage([file.path]))}>
            <Minus />
          </button>
        ) : (
          <button className="icon-btn" title={kind === "conflicted" ? "Mark resolved" : "Stage"} onClick={stop(() => void stage([file.path]))}>
            <Plus />
          </button>
        )}
      </span>
      {kind && (
        <span className={`status-letter status-${kind}`} title={kind}>
          {statusLetter(kind)}
        </span>
      )}
    </div>
  );
}

function stop(fn: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };
}
