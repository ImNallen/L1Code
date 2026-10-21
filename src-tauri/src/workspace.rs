//! The open workspace: its canonical root, its watcher, and its terminals. Rust holds the root so
//! the webview can only name files through `RelPath`. Documents are not here; the editor owns them.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{Error, Result};
use crate::pty::Terminals;
use crate::watch::{FsBatch, Watcher};

pub(crate) struct Workspace {
    pub(crate) root: PathBuf,
    /// Serializes compare-and-swap writes so the hash check and the rename are one step.
    pub(crate) write_lock: Mutex<()>,
    /// Bumped by every new search; a running search stops when it no longer matches.
    pub(crate) search_ticket: AtomicU64,
    pub(crate) terminals: Terminals,
    watcher: Mutex<Option<Watcher>>,
}

impl Workspace {
    /// The absolute path for `rel`, refused if a symlink would take it outside the workspace.
    pub(crate) fn path(&self, rel: &crate::paths::RelPath) -> Result<PathBuf> {
        rel.resolve(&self.root)
    }
}

#[derive(Default)]
pub(crate) struct AppState {
    current: Mutex<Option<Arc<Workspace>>>,
    /// Path given on the command line at launch, consumed once by the first page load.
    initial_path: Mutex<Option<String>>,
}

impl AppState {
    pub(crate) fn with_initial_path(path: Option<String>) -> Self {
        AppState { current: Mutex::new(None), initial_path: Mutex::new(path) }
    }

    pub(crate) fn workspace(&self) -> Result<Arc<Workspace>> {
        self.current.lock().unwrap().clone().ok_or(Error::NoWorkspace)
    }
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceInfo {
    pub(crate) root: String,
    pub(crate) name: String,
    pub(crate) is_git: bool,
}

/// Opens `path` as the workspace and starts streaming file changes to `on_fs`.
///
/// Idempotent for the same root: a page reload re-opens the same folder and keeps its terminals,
/// replacing only the watcher channel. A different root drops the old workspace (and its PTYs).
#[tauri::command]
#[specta::specta]
pub(crate) fn workspace_open(state: State<'_, AppState>, path: String, on_fs: Channel<FsBatch>) -> Result<WorkspaceInfo> {
    let root = std::fs::canonicalize(&path).map_err(|_| Error::NotFound(path.clone()))?;
    if !root.is_dir() {
        return Err(Error::InvalidPath(format!("{path} is not a folder")));
    }
    let mut current = state.current.lock().unwrap();
    let ws = match current.as_ref() {
        Some(ws) if ws.root == root => ws.clone(),
        _ => {
            let ws = Arc::new(Workspace {
                root: root.clone(),
                write_lock: Mutex::new(()),
                search_ticket: AtomicU64::new(0),
                terminals: Terminals::default(),
                watcher: Mutex::new(None),
            });
            *current = Some(ws.clone());
            ws
        }
    };
    drop(current);
    let watcher = Watcher::start(&ws.root, on_fs).map_err(|e| Error::Io(e.to_string()))?;
    *ws.watcher.lock().unwrap() = Some(watcher);
    Ok(info(&root))
}

/// Closes the workspace: stops the watcher and kills its terminals.
#[tauri::command]
#[specta::specta]
pub(crate) fn workspace_close(state: State<'_, AppState>) {
    state.current.lock().unwrap().take();
}

/// The folder or file passed on the command line, if any. Returns it once.
#[tauri::command]
#[specta::specta]
pub(crate) fn app_initial_path(state: State<'_, AppState>) -> Option<String> {
    state.initial_path.lock().unwrap().take()
}

#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PathKind {
    File,
    Dir,
    Missing,
}

/// Whether a path from the command line or a picker is a file or a folder. Stat only, no contents.
#[tauri::command]
#[specta::specta]
pub(crate) fn app_path_kind(path: String) -> PathKind {
    match std::fs::metadata(path) {
        Ok(m) if m.is_dir() => PathKind::Dir,
        Ok(_) => PathKind::File,
        Err(_) => PathKind::Missing,
    }
}

fn info(root: &Path) -> WorkspaceInfo {
    WorkspaceInfo {
        root: root.to_string_lossy().into_owned(),
        name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "/".into()),
        is_git: root.join(".git").exists() || crate::git::is_inside_work_tree(root),
    }
}
