use serde::Serialize;
use specta::Type;

/// The one error type every command returns. Tagged so the frontend can branch on `kind`.
#[derive(Debug, thiserror::Error, Serialize, Type)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub(crate) enum Error {
    #[error("no workspace is open")]
    NoWorkspace,
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Git(String),
    #[error("{0}")]
    Unavailable(String),
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::NotFound {
            Error::NotFound(e.to_string())
        } else {
            Error::Io(e.to_string())
        }
    }
}

pub(crate) type Result<T> = std::result::Result<T, Error>;
