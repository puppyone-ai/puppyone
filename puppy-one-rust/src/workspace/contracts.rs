//! Provider-neutral identities and outcomes. No UI, filesystem or transport.
use std::{
    fmt,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

pub type Result<T> = std::result::Result<T, Error>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    InvalidInput,
    NotFound,
    PermissionDenied,
    AlreadyExists,
    Unsupported,
    StaleLease,
    ForeignResource,
    OutcomeUnknown,
    Io,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub kind: ErrorKind,
    /// Adapter detail, never used to classify errors or confer authority.
    pub detail: String,
}
impl Error {
    pub fn new(kind: ErrorKind, detail: impl Into<String>) -> Self {
        Self {
            kind,
            detail: detail.into(),
        }
    }
    pub fn unsupported() -> Self {
        Self::new(
            ErrorKind::Unsupported,
            "This workspace does not support this operation",
        )
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.detail.fmt(f)
    }
}
impl std::error::Error for Error {}
impl From<&str> for Error {
    fn from(value: &str) -> Self {
        Self::new(ErrorKind::InvalidInput, value)
    }
}
impl From<String> for Error {
    fn from(value: String) -> Self {
        Self::new(ErrorKind::InvalidInput, value)
    }
}

/// Stable storage authority. It is a namespace, not an authorization grant.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct StorageId(Arc<str>);
impl StorageId {
    pub fn new(root: &str) -> Result<Self> {
        let url = url::Url::parse(root).map_err(|_| Error::from("Invalid workspace URI"))?;
        if url.cannot_be_a_base()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.path().ends_with('/')
        {
            return Err(Error::from(
                "Workspace URI must be a credential-free directory URI",
            ));
        }
        Ok(Self(Arc::from(url.as_str())))
    }
}

/// Native relative paths remain lossless (including non-UTF8 Unix names).
/// Only a provider translates these to an OS path or a wire path.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RelativePath(PathBuf);
impl RelativePath {
    pub fn new(path: &Path) -> Result<Self> {
        if path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
            || path.as_os_str().as_encoded_bytes().contains(&0)
        {
            return Err(Error::from("A workspace-relative path is required"));
        }
        Ok(Self(path.components().collect()))
    }
    pub fn as_path(&self) -> &Path {
        &self.0
    }
    pub fn is_root(&self) -> bool {
        self.0.as_os_str().is_empty()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ResourceId {
    pub storage: StorageId,
    pub path: RelativePath,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Revision(pub String);
#[derive(Clone, Debug)]
pub struct TextSnapshot {
    pub text: String,
    pub revision: Revision,
}
#[derive(Clone, Debug)]
pub enum WriteResult {
    Saved(TextSnapshot),
    /// A verified newer baseline. The editing session decides reconciliation.
    Conflict(TextSnapshot),
}
#[derive(Clone, Debug)]
pub struct Entry {
    pub path: RelativePath,
    pub name: String,
    pub folder: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub read: bool,
    pub write: bool,
    pub create: bool,
    pub rename: bool,
    pub remove: bool,
    pub move_entry: bool,
    pub copy: bool,
    pub import: bool,
    pub watch: bool,
    pub preview: bool,
    pub local_actions: bool,
}
#[derive(Clone, Debug)]
pub struct Descriptor {
    pub storage: StorageId,
    pub name: String,
    pub capabilities: Capabilities,
    /// Optional native execution context, never a synthetic path for remote data.
    pub local_root: Option<PathBuf>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PreviewData {
    LocalFile(PathBuf),
    /// Immutable provider-owned bytes; no ambient path needed by the renderer.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "Provider-neutral immutable input, exercised by the non-filesystem provider tests; Cloud is not enabled yet"
        )
    )]
    Bytes {
        mime: String,
        bytes: Arc<[u8]>,
    },
}
