//! Pull request for the current branch through the `gh` CLI, parsed into a domain type.

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::error::{Error, Result};
use crate::git::blocking;
use crate::workspace::AppState;

const FIELDS: &str = "number,title,url,state,isDraft,author,headRefName,baseRefName,reviewDecision,body,additions,deletions,changedFiles,statusCheckRollup";

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum PrLookup {
    /// `gh` found no PR for this branch.
    None,
    Found { pr: PullRequest },
    /// `gh` is missing, not authenticated, or the repo has no GitHub remote.
    #[serde(rename_all = "camelCase")]
    Unavailable { reason: String },
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequest {
    pub(crate) number: u32,
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) state: String,
    pub(crate) is_draft: bool,
    pub(crate) author: String,
    pub(crate) head: String,
    pub(crate) base: String,
    pub(crate) review_decision: Option<String>,
    pub(crate) body: String,
    pub(crate) additions: u32,
    pub(crate) deletions: u32,
    pub(crate) changed_files: u32,
    pub(crate) checks: Vec<Check>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Check {
    pub(crate) name: String,
    /// `success`, `failure`, `pending`, `skipped`, or `neutral`.
    pub(crate) status: String,
    pub(crate) url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Raw {
    number: u32,
    title: String,
    url: String,
    state: String,
    is_draft: bool,
    author: Option<RawAuthor>,
    head_ref_name: String,
    base_ref_name: String,
    review_decision: Option<String>,
    body: Option<String>,
    additions: u32,
    deletions: u32,
    changed_files: u32,
    #[serde(default)]
    status_check_rollup: Vec<RawCheck>,
}

#[derive(Deserialize)]
struct RawAuthor {
    login: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCheck {
    name: Option<String>,
    context: Option<String>,
    status: Option<String>,
    conclusion: Option<String>,
    state: Option<String>,
    details_url: Option<String>,
    target_url: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn gh_pr_view(state: State<'_, AppState>) -> Result<PrLookup> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        let out = std::process::Command::new("gh")
            .current_dir(&root)
            .args(["pr", "view", "--json", FIELDS])
            .env("GH_PROMPT_DISABLED", "1")
            .output();
        let out = match out {
            Ok(o) => o,
            Err(_) => return Ok(PrLookup::Unavailable { reason: "GitHub CLI (gh) is not installed.".into() }),
        };
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            if err.contains("no pull requests found") {
                return Ok(PrLookup::None);
            }
            return Ok(PrLookup::Unavailable { reason: err });
        }
        let raw: Raw = serde_json::from_slice(&out.stdout).map_err(|e| Error::Io(e.to_string()))?;
        Ok(PrLookup::Found { pr: parse(raw) })
    })
    .await
}

/// Opens GitHub's "create pull request" page for the current branch in the browser.
#[tauri::command]
#[specta::specta]
pub(crate) async fn gh_pr_create_web(state: State<'_, AppState>) -> Result<()> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        let out = std::process::Command::new("gh")
            .current_dir(&root)
            .args(["pr", "create", "--web"])
            .env("GH_PROMPT_DISABLED", "1")
            .output()
            .map_err(|_| Error::Unavailable("GitHub CLI (gh) is not installed.".into()))?;
        if !out.status.success() {
            return Err(Error::Unavailable(String::from_utf8_lossy(&out.stderr).trim().to_string()));
        }
        Ok(())
    })
    .await
}

fn parse(raw: Raw) -> PullRequest {
    PullRequest {
        number: raw.number,
        title: raw.title,
        url: raw.url,
        state: raw.state,
        is_draft: raw.is_draft,
        author: raw.author.map(|a| a.login).unwrap_or_default(),
        head: raw.head_ref_name,
        base: raw.base_ref_name,
        review_decision: raw.review_decision.filter(|s| !s.is_empty()),
        body: raw.body.unwrap_or_default(),
        additions: raw.additions,
        deletions: raw.deletions,
        changed_files: raw.changed_files,
        checks: raw.status_check_rollup.into_iter().map(check).collect(),
    }
}

fn check(c: RawCheck) -> Check {
    // CheckRun has status + conclusion; StatusContext has state.
    let status = match (c.status.as_deref(), c.conclusion.as_deref(), c.state.as_deref()) {
        (_, Some("SUCCESS"), _) | (_, _, Some("SUCCESS")) => "success",
        (_, Some("FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE"), _)
        | (_, _, Some("FAILURE" | "ERROR")) => "failure",
        (_, Some("SKIPPED"), _) => "skipped",
        (_, Some("NEUTRAL" | "STALE"), _) => "neutral",
        _ => "pending",
    };
    Check {
        name: c.name.or(c.context).unwrap_or_else(|| "check".into()),
        status: status.into(),
        url: c.details_url.or(c.target_url),
    }
}
