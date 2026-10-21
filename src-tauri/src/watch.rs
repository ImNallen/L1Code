//! One debounced, gitignore-aware watcher per workspace, streaming `FsBatch` over a Channel.
//! It reports what changed, not what to do: the explorer, editor, and scm slices decide.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;

use crate::paths::RelPath;

const DEBOUNCE: Duration = Duration::from_millis(75);
/// Above this many changes the frontend re-lists instead of applying deltas.
const OVERFLOW: usize = 2000;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FsChange {
    pub(crate) path: RelPath,
    /// Whether the path exists after the batch. The explorer diffs this against its own set.
    pub(crate) exists: bool,
    pub(crate) is_dir: bool,
}

#[derive(Debug, Clone, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FsBatch {
    pub(crate) changes: Vec<FsChange>,
    /// HEAD, index, or refs moved: a commit, checkout, stage, or fetch happened.
    pub(crate) git_meta: bool,
    /// Too many changes, a rescan, or an ignore-file edit: re-list everything.
    pub(crate) overflow: bool,
}

pub(crate) struct Watcher {
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

impl Watcher {
    pub(crate) fn start(root: &Path, out: Channel<FsBatch>) -> notify::Result<Self> {
        let root_owned = root.to_path_buf();
        let mut ignores = IgnoreCache::new(root_owned.clone());
        let mut debouncer = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
            let batch = match res {
                Ok(events) => classify(&root_owned, &mut ignores, events.iter().flat_map(|e| {
                    let rescan = e.need_rescan();
                    e.paths.iter().map(move |p| (p.clone(), rescan))
                })),
                Err(_) => FsBatch { overflow: true, ..Default::default() },
            };
            if batch.changes.is_empty() && !batch.git_meta && !batch.overflow {
                return;
            }
            // A failed send means the page that subscribed is gone; the next page re-subscribes.
            let _ = out.send(batch);
        })?;
        debouncer.watch(root, RecursiveMode::Recursive)?;
        Ok(Watcher { _debouncer: debouncer })
    }
}

fn classify(root: &Path, ignores: &mut IgnoreCache, paths: impl Iterator<Item = (PathBuf, bool)>) -> FsBatch {
    let mut batch = FsBatch::default();
    let mut seen = std::collections::HashSet::new();
    for (abs, rescan) in paths {
        if rescan {
            batch.overflow = true;
            continue;
        }
        let Some(rel) = RelPath::from_abs(root, &abs) else { continue };
        let s = rel.as_str();
        if s == ".git" || s.starts_with(".git/") {
            let inner = s.strip_prefix(".git/").unwrap_or("");
            if is_git_meta(inner) {
                batch.git_meta = true;
            }
            continue;
        }
        if s.ends_with(".gitignore") {
            ignores.clear();
            batch.overflow = true;
        }
        if !seen.insert(rel.clone()) {
            continue;
        }
        let meta = std::fs::symlink_metadata(&abs).ok();
        let is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
        if ignores.is_ignored(&abs, is_dir) {
            continue;
        }
        batch.changes.push(FsChange { path: rel, exists: meta.is_some(), is_dir });
    }
    if batch.changes.len() > OVERFLOW {
        batch.changes.clear();
        batch.overflow = true;
    }
    batch
}

fn is_git_meta(inner: &str) -> bool {
    matches!(inner, "HEAD" | "index" | "packed-refs" | "MERGE_HEAD" | "ORIG_HEAD")
        || inner.starts_with("refs/")
}

/// Per-directory `.gitignore` matchers, built lazily and cleared when any ignore file changes.
struct IgnoreCache {
    root: PathBuf,
    by_dir: HashMap<PathBuf, Option<Gitignore>>,
    global: Gitignore,
}

impl IgnoreCache {
    fn new(root: PathBuf) -> Self {
        IgnoreCache { root, by_dir: HashMap::new(), global: Gitignore::global().0 }
    }

    fn clear(&mut self) {
        self.by_dir.clear();
    }

    fn is_ignored(&mut self, abs: &Path, is_dir: bool) -> bool {
        // The global matcher is rooted elsewhere, so match the relative path and its parents.
        if let Ok(rel) = abs.strip_prefix(&self.root) {
            let mut p = Some(rel);
            let mut dir = is_dir;
            while let Some(cur) = p.filter(|c| !c.as_os_str().is_empty()) {
                if self.global.matched(cur, dir).is_ignore() {
                    return true;
                }
                p = cur.parent();
                dir = true;
            }
        }
        let mut dir = abs.parent();
        while let Some(d) = dir {
            if !d.starts_with(&self.root) {
                break;
            }
            let matcher = self.by_dir.entry(d.to_path_buf()).or_insert_with(|| load(d)).as_ref();
            if let Some(m) = matcher {
                let m = m.matched_path_or_any_parents(abs, is_dir);
                if m.is_ignore() {
                    return true;
                }
                if m.is_whitelist() {
                    return false;
                }
            }
            dir = d.parent();
        }
        false
    }
}

fn load(dir: &Path) -> Option<Gitignore> {
    let mut b = GitignoreBuilder::new(dir);
    let mut any = false;
    for name in [".gitignore", ".git/info/exclude"] {
        let p = dir.join(name);
        if p.is_file() {
            any |= b.add(p).is_none();
        }
    }
    if !any {
        return None;
    }
    b.build().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_git_meta_and_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::write(root.join(".gitignore"), "target/\n").unwrap();
        std::fs::create_dir_all(root.join("target")).unwrap();
        std::fs::write(root.join("target/x"), "").unwrap();
        std::fs::write(root.join("a.txt"), "").unwrap();
        let mut ig = IgnoreCache::new(root.clone());
        let b = classify(
            &root,
            &mut ig,
            vec![
                (root.join(".git/HEAD"), false),
                (root.join("target/x"), false),
                (root.join("a.txt"), false),
                (root.join("gone.txt"), false),
            ]
            .into_iter(),
        );
        assert!(b.git_meta);
        assert!(!b.overflow);
        let paths: Vec<_> = b.changes.iter().map(|c| (c.path.as_str(), c.exists)).collect();
        assert_eq!(paths, vec![("a.txt", true), ("gone.txt", false)]);
    }
}
