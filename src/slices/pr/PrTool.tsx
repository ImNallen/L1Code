import type { ReactNode } from "react";
import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { errorMessage, rust, type Check, type PullRequest } from "@/core/ipc";
import { useStore } from "@/core/store";
import { toast } from "@/core/toast";
import { scm } from "@/slices/scm";
import { load, prState as lookupState } from "./pr";
import "./PrTool.css";


function open(url: string) {
  openUrl(url).catch((e: unknown) => toast(`Could not open link: ${errorMessage(e)}`, "error"));
}

export default function PrTool() {
  const branch = useStore(scm.state, (s) => s.status?.branch ?? null);
  const { lookup, loading, error, branch: loadedFor } = useStore(lookupState);
  const reload = () => void load();

  const current = loadedFor === branch ? lookup : null;
  let body: ReactNode;
  if (error && !current) body = <div className="empty selectable">{error}</div>;
  else if (!current) body = <div className="empty">Loading…</div>;
  else if (current.kind === "unavailable")
    body = (
      <div className="empty">
        <div className="selectable">{current.reason}</div>
        <div className="pr-hint">
          Run <code className="mono">gh auth login</code> in a terminal, then refresh.
        </div>
      </div>
    );
  else if (current.kind === "none")
    body = (
      <div className="empty">
        <div>No pull request for {branch ? <code className="mono">{branch}</code> : "this branch"}.</div>
        <button
          className="btn primary pr-create"
          onClick={() => rust.ghPrCreateWeb().catch((e: unknown) => toast(`Could not create PR: ${errorMessage(e)}`, "error"))}
        >
          <GitPullRequest size={14} />
          Create PR
        </button>
      </div>
    );
  else body = <PrDetails pr={current.pr} />;

  return (
    <div className="panel pr">
      <div className="pr-toolbar">
        <span className="pr-toolbar-title">{branch ?? "Pull Request"}</span>
        <span className="spacer" />
        <button className="icon-btn" title="Refresh" onClick={reload}>
          <RefreshCw className={loading ? "pr-spin" : undefined} />
        </button>
      </div>
      <div className="panel-body">{body}</div>
    </div>
  );
}

function prState(pr: PullRequest): "open" | "draft" | "merged" | "closed" {
  const s = pr.state.toLowerCase();
  if (s === "merged") return "merged";
  if (s === "closed") return "closed";
  return pr.isDraft ? "draft" : "open";
}

const STATE_ICON = { open: GitPullRequest, draft: GitPullRequestDraft, merged: GitMerge, closed: GitPullRequestClosed };

const REVIEW_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

function PrDetails({ pr }: { pr: PullRequest }) {
  const state = prState(pr);
  const Icon = STATE_ICON[state];
  return (
    <div className="pr-details">
      <div className="pr-title-row">
        <a className="pr-title selectable" href={pr.url} onClick={(e) => {
            e.preventDefault();
            open(pr.url);
          }} title={pr.url}>
          {pr.title} <span className="pr-number">#{pr.number}</span>
        </a>
      </div>
      <div className="pr-meta">
        <span className={`pr-pill pr-${state}`}>
          <Icon size={12} />
          {state}
        </span>
        <span className="pr-author">{pr.author}</span>
        <button className="icon-btn" title="Open on GitHub" onClick={() => open(pr.url)}>
          <ExternalLink />
        </button>
      </div>
      <div className="pr-branches mono">
        <span className="pr-ref">{pr.head}</span>
        <span className="pr-arrow">→</span>
        <span className="pr-ref">{pr.base}</span>
      </div>
      <div className="pr-stats">
        <span className="pr-add mono">+{pr.additions}</span>
        <span className="pr-del mono">−{pr.deletions}</span>
        <span className="pr-dim">
          {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
        </span>
        {pr.reviewDecision && (
          <span className={`pr-review pr-review-${pr.reviewDecision.toLowerCase()}`}>
            {REVIEW_LABEL[pr.reviewDecision] ?? pr.reviewDecision.toLowerCase().replace(/_/g, " ")}
          </span>
        )}
      </div>
      {pr.checks.length > 0 && <Checks checks={pr.checks} />}
      <div className="pr-section-title">Description</div>
      {pr.body.trim() ? <pre className="pr-body selectable">{pr.body}</pre> : <div className="pr-dim pr-pad">No description.</div>}
    </div>
  );
}

const CHECK_ORDER: Record<string, number> = { failure: 0, pending: 1, success: 2, neutral: 3, skipped: 4 };

function Checks({ checks }: { checks: readonly Check[] }) {
  const sorted = [...checks].sort((a, b) => (CHECK_ORDER[a.status] ?? 5) - (CHECK_ORDER[b.status] ?? 5));
  const counts: Record<string, number> = {};
  for (const c of checks) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const summary = ["failure", "pending", "success"]
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s === "failure" ? "failing" : s === "pending" ? "pending" : "passing"}`)
    .join(", ");
  return (
    <>
      <div className="pr-section-title">
        Checks <span className="pr-dim">{summary}</span>
      </div>
      <div className="pr-checks">
        {sorted.map((c, i) => {
          const url = c.url;
          return (
            <div
              key={`${c.name}-${i}`}
              className={`row pr-check${url ? "" : " pr-check-static"}`}
              title={`${c.name}: ${c.status}`}
              onClick={url ? () => open(url) : undefined}
            >
              <span className={`pr-dot pr-dot-${c.status}`} />
              <span className="name">{c.name}</span>
              {url && (
                <span className="actions">
                  <ExternalLink size={13} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
