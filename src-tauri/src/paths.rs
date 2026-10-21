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

    pub(crate) fn resolve(&self, root: &Path) -> PathBuf {
        root.join(&self.0)
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
    fn from_abs_strips_root() {
        let root = Path::new("/r");
        assert_eq!(RelPath::from_abs(root, Path::new("/r/a/b")).unwrap().as_str(), "a/b");
        assert!(RelPath::from_abs(root, Path::new("/r")).is_none());
        assert!(RelPath::from_abs(root, Path::new("/other/a")).is_none());
    }
}
