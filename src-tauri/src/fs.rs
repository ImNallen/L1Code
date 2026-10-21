//! File capabilities. Stateless apart from the workspace root and its write lock.
//! Every read returns a content hash; every write is a compare-and-swap against one.

use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::workspace::AppState;

const MAX_EDITABLE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_LIST: usize = 500_000;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ReadResult {
    #[serde(rename_all = "camelCase")]
    Text { text: String, hash: String, bom: bool, crlf: bool },
    Binary,
    TooLarge,
    Missing,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum WriteExpect {
    /// The file must currently hash to this value.
    Hash { hash: String },
    /// The file must not exist (create or recreate).
    Absent,
    /// Overwrite unconditionally.
    Any,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum WriteResult {
    Written { hash: String },
    /// Disk did not match `expect`. Nothing was written.
    Conflict,
}

pub(crate) fn hash(bytes: &[u8]) -> String {
    format!("{:032x}", xxhash_rust::xxh3::xxh3_128(bytes))
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_read(state: State<'_, AppState>, path: RelPath) -> Result<ReadResult> {
    let ws = state.workspace()?;
    read(&ws.path(&path)?)
}

pub(crate) fn read(abs: &Path) -> Result<ReadResult> {
    let meta = match std::fs::metadata(abs) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ReadResult::Missing),
        Err(e) => return Err(e.into()),
    };
    if meta.is_dir() {
        return Ok(ReadResult::Missing);
    }
    if meta.len() > MAX_EDITABLE_BYTES {
        return Ok(ReadResult::TooLarge);
    }
    let bytes = std::fs::read(abs)?;
    let h = hash(&bytes);
    let (bom, body) = match bytes.strip_prefix(b"\xEF\xBB\xBF") {
        Some(rest) => (true, rest),
        None => (false, &bytes[..]),
    };
    if body[..body.len().min(8192)].contains(&0) {
        return Ok(ReadResult::Binary);
    }
    let Ok(text) = std::str::from_utf8(body) else { return Ok(ReadResult::Binary) };
    let crlf = text.contains("\r\n");
    Ok(ReadResult::Text { text: text.to_string(), hash: h, bom, crlf })
}

/// Writes `text` atomically (temp file, fsync, rename) if disk matches `expect`.
/// `text` uses `\n`; `crlf` and `bom` restore the file's original encoding.
#[tauri::command]
#[specta::specta]
pub(crate) fn fs_write(
    state: State<'_, AppState>,
    path: RelPath,
    text: String,
    bom: bool,
    crlf: bool,
    expect: WriteExpect,
) -> Result<WriteResult> {
    let ws = state.workspace()?;
    write(&ws.path(&path)?, &ws.write_lock, &text, bom, crlf, &expect)
}

pub(crate) fn write(abs: &Path, lock: &Mutex<()>, text: &str, bom: bool, crlf: bool, expect: &WriteExpect) -> Result<WriteResult> {
    let mut bytes = Vec::with_capacity(text.len() + 3);
    if bom {
        bytes.extend_from_slice(b"\xEF\xBB\xBF");
    }
    if crlf {
        bytes.extend_from_slice(text.replace('\n', "\r\n").as_bytes());
    } else {
        bytes.extend_from_slice(text.as_bytes());
    }

    let _guard = lock.lock().unwrap();
    let current = match std::fs::read(abs) {
        Ok(b) => Some(hash(&b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let ok = match expect {
        WriteExpect::Hash { hash } => current.as_deref() == Some(hash.as_str()),
        WriteExpect::Absent => current.is_none(),
        WriteExpect::Any => true,
    };
    if !ok {
        return Ok(WriteResult::Conflict);
    }
    let dir = abs.parent().ok_or_else(|| Error::InvalidPath(abs.display().to_string()))?;
    std::fs::create_dir_all(dir)?;
    let name = abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.l1code-{}.tmp", std::process::id()));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    if let Ok(meta) = std::fs::metadata(abs) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    if let Err(e) = std::fs::rename(&tmp, abs) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(WriteResult::Written { hash: hash(&bytes) })
}

/// Every non-ignored path in the workspace, newline-joined, directories ending in `/`.
/// `.git` is excluded; hidden files are included.
#[tauri::command]
#[specta::specta]
pub(crate) async fn fs_list(state: State<'_, AppState>) -> Result<String> {
    let ws = state.workspace()?;
    let root = ws.root.clone();
    tauri::async_runtime::spawn_blocking(move || list(&root))
        .await
        .map_err(|e| Error::Io(e.to_string()))
}

pub(crate) fn list(root: &Path) -> String {
    let out = Mutex::new(Vec::<String>::new());
    ignore::WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build_parallel()
        .run(|| {
            let out = &out;
            Box::new(move |entry| {
                let Ok(entry) = entry else { return ignore::WalkState::Continue };
                let Some(rel) = RelPath::from_abs(root, entry.path()) else { return ignore::WalkState::Continue };
                let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
                let mut out = out.lock().unwrap();
                if out.len() >= MAX_LIST {
                    return ignore::WalkState::Quit;
                }
                out.push(if is_dir { format!("{}/", rel.as_str()) } else { rel.as_str().to_string() });
                ignore::WalkState::Continue
            })
        });
    out.into_inner().unwrap().join("\n")
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_create(state: State<'_, AppState>, path: RelPath, dir: bool) -> Result<()> {
    let ws = state.workspace()?;
    let abs = ws.path(&path)?;
    if abs.exists() {
        return Err(Error::InvalidPath(format!("{} already exists", path.as_str())));
    }
    if dir {
        std::fs::create_dir_all(abs)?;
    } else {
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::File::create(abs)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn fs_rename(state: State<'_, AppState>, from: RelPath, to: RelPath) -> Result<()> {
    let ws = state.workspace()?;
    let dest = ws.path(&to)?;
    if dest.exists() {
        return Err(Error::InvalidPath(format!("{} already exists", to.as_str())));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(ws.path(&from)?, dest)?;
    Ok(())
}

/// Moves a file or folder to the system trash.
#[tauri::command]
#[specta::specta]
pub(crate) fn fs_delete(state: State<'_, AppState>, path: RelPath) -> Result<()> {
    let ws = state.workspace()?;
    trash::delete(ws.path(&path)?).map_err(|e| Error::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cas_write_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        let lock = Mutex::new(());
        let w = write(&p, &lock, "one\ntwo\n", false, true, &WriteExpect::Absent).unwrap();
        let WriteResult::Written { hash: h1 } = w else { panic!("expected write") };
        assert_eq!(std::fs::read(&p).unwrap(), b"one\r\ntwo\r\n");
        let ReadResult::Text { hash, crlf, .. } = read(&p).unwrap() else { panic!("text") };
        assert_eq!(hash, h1);
        assert!(crlf);
        // Stale expectation must not clobber.
        let stale = WriteExpect::Hash { hash: "0".repeat(32) };
        assert!(matches!(write(&p, &lock, "x", false, false, &stale).unwrap(), WriteResult::Conflict));
        assert!(matches!(write(&p, &lock, "x", false, false, &WriteExpect::Absent).unwrap(), WriteResult::Conflict));
        let ok = WriteExpect::Hash { hash: h1 };
        assert!(matches!(write(&p, &lock, "x", false, false, &ok).unwrap(), WriteResult::Written { .. }));
    }

    #[test]
    fn read_classifies() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("bin"), [0u8, 1, 2]).unwrap();
        assert!(matches!(read(&dir.path().join("bin")).unwrap(), ReadResult::Binary));
        assert!(matches!(read(&dir.path().join("nope")).unwrap(), ReadResult::Missing));
    }

    #[test]
    fn list_respects_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".gitignore"), "out/\n").unwrap();
        std::fs::create_dir_all(root.join("out")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "").unwrap();
        let mut got: Vec<_> = list(&root).lines().map(String::from).collect();
        got.sort();
        assert_eq!(got, vec![".gitignore", "src/", "src/a.rs"]);
    }
}
