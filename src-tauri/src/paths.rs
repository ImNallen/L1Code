//! Path validation at the IPC boundary. The webview never sends absolute paths: every file
//! argument is a `RelPath`, checked on deserialize, and resolved only against the root Rust holds.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};
use specta::Type;

use crate::error::{Error, Result};

/// Workspace-relative POSIX path with no `..`, no root, no empty segments.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Type)]
#[serde(transparent)]
pub(crate) struct RelPath(String);

impl RelPath {
    pub(crate) fn parse(raw: &str) -> Result<Self> {
        let trimmed = raw.trim_end_matches('/');
        if trimmed.is_empty() || trimmed.starts_with('/') || trimmed.contains('\\') {
            return Err(Error::InvalidPath(raw.to_string()));
        }
        for seg in trimmed.split('/') {
            if seg.is_empty() || seg == "." || seg == ".." {
                return Err(Error::InvalidPath(raw.to_string()));
            }
        }
        Ok(RelPath(trimmed.to_string()))
    }

    /// Relative path of `abs` under `root`, if it is inside it.
    pub(crate) fn from_abs(root: &Path, abs: &Path) -> Option<Self> {
        let rel = abs.strip_prefix(root).ok()?;
        let mut parts = Vec::new();
        for c in rel.components() {
            match c {
                Component::Normal(s) => parts.push(s.to_str()?.to_string()),
                _ => return None,
            }
        }
        if parts.is_empty() {
            return None;
        }
        Some(RelPath(parts.join("/")))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }

    /// The absolute path of `self` under `root`, refusing any path that a symlink carries outside
    /// it. `root` must be canonical. The deepest existing part of the path is canonicalized, so a
    /// path to a file that doesn't exist yet is checked through its nearest existing ancestor.
    pub(crate) fn resolve(&self, root: &Path) -> Result<PathBuf> {
        let abs = root.join(&self.0);
        let mut probe = abs.as_path();
        loop {
            match probe.canonicalize() {
                Ok(real) if real.starts_with(root) => return Ok(abs),
                Ok(_) => return Err(Error::InvalidPath(format!("{} resolves outside the workspace", self.0))),
                Err(_) => match probe.parent() {
                    Some(parent) if parent.starts_with(root) => probe = parent,
                    _ => return Err(Error::InvalidPath(self.0.clone())),
                },
            }
        }
    }
}

impl<'de> Deserialize<'de> for RelPath {
    fn deserialize<D: Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        RelPath::parse(&raw).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escapes() {
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a//b", "./a", "a\\b"] {
            assert!(RelPath::parse(bad).is_err(), "{bad}");
        }
        assert_eq!(RelPath::parse("src/main.rs").unwrap().as_str(), "src/main.rs");
        assert_eq!(RelPath::parse("src/").unwrap().as_str(), "src");
    }

    #[test]
    fn resolve_refuses_symlink_escapes() {
        let outside = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let root = ws.path().canonicalize().unwrap();
        std::fs::write(outside.path().join("secret"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("link")).unwrap();
        std::fs::create_dir(root.join("src")).unwrap();
        let ok = |p: &str| RelPath::parse(p).unwrap().resolve(&root).is_ok();
        assert!(!ok("link"));
        assert!(!ok("link/secret"));
        assert!(!ok("link/new-file"));
        assert!(ok("src"));
        assert!(ok("src/new/deep/file.rs"));
    }

    #[test]
    fn from_abs_strips_root() {
        let root = Path::new("/r");
        assert_eq!(RelPath::from_abs(root, Path::new("/r/a/b")).unwrap().as_str(), "a/b");
        assert!(RelPath::from_abs(root, Path::new("/r")).is_none());
        assert!(RelPath::from_abs(root, Path::new("/other/a")).is_none());
    }
}
