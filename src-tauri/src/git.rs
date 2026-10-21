//! Git through the CLI, parsed into domain types here. `GIT_OPTIONAL_LOCKS=0` keeps `status` from
//! rewriting `.git/index`, which would otherwise wake the watcher and retrigger a refresh forever.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use specta::Type;
use tauri::State;

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::workspace::AppState;

const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_UNTRACKED_DIFFS: usize = 200;
const MAX_UNTRACKED_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitFile {
    pub(crate) path: String,
    pub(crate) orig_path: Option<String>,
    /// Change recorded in the index, if any.
    pub(crate) staged: Option<ChangeKind>,
    /// Change in the worktree relative to the index, if any.
    pub(crate) unstaged: Option<ChangeKind>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatus {
    pub(crate) branch: Option<String>,
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: u32,
    pub(crate) behind: u32,
    pub(crate) files: Vec<GitFile>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePatch {
    pub(crate) path: String,
    pub(crate) patch: String,
}

pub(crate) fn git(root: &Path) -> Command {
    let mut c = Command::new("git");
    c.arg("-C").arg(root).env("GIT_OPTIONAL_LOCKS", "0").env("GIT_TERMINAL_PROMPT", "0");
    c
}

fn run(mut cmd: Command) -> Result<String> {
    let out = cmd.output().map_err(|e| Error::Unavailable(format!("git: {e}")))?;
    if !out.status.success() {
        return Err(Error::Git(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub(crate) fn is_inside_work_tree(root: &Path) -> bool {
    let mut c = git(root);
    c.args(["rev-parse", "--is-inside-work-tree"]);
    run(c).is_ok_and(|s| s.trim() == "true")
}

fn has_head(root: &Path) -> bool {
    let mut c = git(root);
    c.args(["rev-parse", "--verify", "--quiet", "HEAD"]);
    c.output().is_ok_and(|o| o.status.success())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn git_status(state: State<'_, AppState>) -> Result<Option<GitStatus>> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        if !is_inside_work_tree(&root) {
            return Ok(None);
        }
        let mut c = git(&root);
        c.args(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
        Ok(Some(parse_status(&run(c)?)))
    })
    .await
}

pub(crate) fn parse_status(out: &str) -> GitStatus {
    let mut st = GitStatus { branch: None, upstream: None, ahead: 0, behind: 0, files: vec![] };
    let mut records = out.split('\0').filter(|r| !r.is_empty());
    while let Some(rec) = records.next() {
        if let Some(h) = rec.strip_prefix("# ") {
            if let Some(b) = h.strip_prefix("branch.head ") {
                st.branch = (b != "(detached)").then(|| b.to_string());
            } else if let Some(u) = h.strip_prefix("branch.upstream ") {
                st.upstream = Some(u.to_string());
            } else if let Some(ab) = h.strip_prefix("branch.ab ") {
                for part in ab.split(' ') {
                    if let Some(n) = part.strip_prefix('+') {
                        st.ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix('-') {
                        st.behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        let fields: Vec<&str> = rec.splitn(11, ' ').collect();
        match fields.first().copied() {
            Some("1") if fields.len() >= 9 => {
                let path = fields[8..].join(" ");
                st.files.push(file(path, None, fields[1]));
            }
            Some("2") if fields.len() >= 10 => {
                let path = fields[9..].join(" ");
                let orig = records.next().map(String::from);
                st.files.push(file(path, orig, fields[1]));
            }
            Some("u") if fields.len() >= 11 => {
                st.files.push(GitFile {
                    path: fields[10].to_string(),
                    orig_path: None,
                    staged: None,
                    unstaged: Some(ChangeKind::Conflicted),
                });
            }
            Some("?") => {
                let path = rec[2..].to_string();
                st.files.push(GitFile { path, orig_path: None, staged: None, unstaged: Some(ChangeKind::Untracked) });
            }
            _ => {}
        }
    }
    st
}

fn file(path: String, orig_path: Option<String>, xy: &str) -> GitFile {
    let mut chars = xy.chars();
    let kind = |c: Option<char>| match c {
        Some('A') => Some(ChangeKind::Added),
        Some('M') | Some('T') => Some(ChangeKind::Modified),
        Some('D') => Some(ChangeKind::Deleted),
        Some('R') | Some('C') => Some(ChangeKind::Renamed),
        _ => None,
    };
    GitFile { path, orig_path, staged: kind(chars.next()), unstaged: kind(chars.next()) }
}

/// Every change against HEAD (staged and unstaged together), plus untracked files as additions.
/// One patch per file, ready for `PatchDiff`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn git_diff(state: State<'_, AppState>) -> Result<Vec<FilePatch>> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        let base = if has_head(&root) { "HEAD" } else { EMPTY_TREE };
        let mut c = git(&root);
        c.args(["diff", "--no-color", "--no-ext-diff", "-M", base, "--"]);
        let mut patches = split_patches(&run(c)?);

        let mut c = git(&root);
        c.args(["ls-files", "--others", "--exclude-standard", "-z"]);
        let untracked = run(c)?;
        for path in untracked.split('\0').filter(|p| !p.is_empty()).take(MAX_UNTRACKED_DIFFS) {
            let size = std::fs::metadata(root.join(path)).map(|m| m.len()).unwrap_or(0);
            if size > MAX_UNTRACKED_BYTES {
                continue;
            }
            let mut c = git(&root);
            c.args(["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", path]);
            // --no-index exits 1 when files differ, which is always here.
            let out = c.output().map_err(|e| Error::Unavailable(e.to_string()))?;
            let text = String::from_utf8_lossy(&out.stdout);
            patches.extend(split_patches(&text));
        }
        Ok(patches)
    })
    .await
}

pub(crate) fn split_patches(out: &str) -> Vec<FilePatch> {
    let mut patches = Vec::new();
    for chunk in out.split("\ndiff --git ").enumerate().map(|(i, c)| {
        if i == 0 { c.strip_prefix("diff --git ").map(str::to_string) } else { Some(c.to_string()) }
    }) {
        let Some(chunk) = chunk else { continue };
        if chunk.trim().is_empty() {
            continue;
        }
        let patch = format!("diff --git {}\n", chunk.trim_end_matches('\n'));
        let path = patch
            .lines()
            .find_map(|l| l.strip_prefix("+++ b/").or_else(|| l.strip_prefix("rename to ")))
            .or_else(|| patch.lines().find_map(|l| l.strip_prefix("--- a/")))
            .map(str::to_string)
            .unwrap_or_else(|| header_path(&patch));
        patches.push(FilePatch { path, patch });
    }
    patches
}

fn header_path(patch: &str) -> String {
    let first = patch.lines().next().unwrap_or_default();
    first.rsplit_once(" b/").map(|(_, p)| p.to_string()).unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn git_stage(state: State<'_, AppState>, paths: Vec<RelPath>) -> Result<()> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        let mut c = git(&root);
        c.args(["add", "-A", "--"]).args(paths.iter().map(RelPath::as_str));
        run(c).map(drop)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn git_unstage(state: State<'_, AppState>, paths: Vec<RelPath>) -> Result<()> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        let mut c = git(&root);
        if has_head(&root) {
            c.args(["restore", "--staged", "--"]);
        } else {
            c.args(["rm", "--cached", "-r", "-q", "--"]);
        }
        c.args(paths.iter().map(RelPath::as_str));
        run(c).map(drop)
    })
    .await
}

/// Discards worktree changes. Tracked files are restored from the index; untracked files go to trash.
#[tauri::command]
#[specta::specta]
pub(crate) async fn git_discard(state: State<'_, AppState>, paths: Vec<RelPath>, untracked: Vec<RelPath>) -> Result<()> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        if !paths.is_empty() {
            let mut c = git(&root);
            c.args(["restore", "--worktree", "--"]).args(paths.iter().map(RelPath::as_str));
            run(c)?;
        }
        for p in untracked {
            trash::delete(p.resolve(&root)?).map_err(|e| Error::Io(e.to_string()))?;
        }
        Ok(())
    })
    .await
}

/// Commits the index. With `stage_all`, stages every change first (like `git commit -a` plus new files).
#[tauri::command]
#[specta::specta]
pub(crate) async fn git_commit(state: State<'_, AppState>, message: String, stage_all: bool) -> Result<()> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    blocking(move || {
        if message.trim().is_empty() {
            return Err(Error::Git("commit message is empty".into()));
        }
        if stage_all {
            let mut c = git(&root);
            c.args(["add", "-A"]);
            run(c)?;
        }
        let mut c = git(&root);
        c.args(["commit", "-q", "-m", &message]);
        run(c).map(drop)
    })
    .await
}

pub(crate) async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| Error::Io(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let out = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 a a src/a b.rs\0\
2 R. N... 100644 100644 100644 a a R100 new.rs\0old.rs\0\
? notes.txt\0";
        let st = parse_status(out);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!((st.ahead, st.behind), (2, 1));
        assert_eq!(st.files.len(), 3);
        assert_eq!(st.files[0].path, "src/a b.rs");
        assert_eq!(st.files[0].unstaged, Some(ChangeKind::Modified));
        assert_eq!(st.files[1].orig_path.as_deref(), Some("old.rs"));
        assert_eq!(st.files[1].staged, Some(ChangeKind::Renamed));
        assert_eq!(st.files[2].unstaged, Some(ChangeKind::Untracked));
    }

    #[test]
    fn splits_patches() {
        let out = "diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/y b/y\ndeleted file mode 100644\n--- a/y\n+++ /dev/null\n@@ -1 +0,0 @@\n-y\n";
        let p = split_patches(out);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].path, "x");
        assert_eq!(p[1].path, "y");
        assert!(p[1].patch.starts_with("diff --git a/y b/y\n"));
    }
}
