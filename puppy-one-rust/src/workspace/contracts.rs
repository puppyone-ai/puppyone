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
    InvalidData,
    NotFound,
    PermissionDenied,
    AlreadyExists,
    Unsupported,
    LineEndingNormalizationRequired,
    EncodingRoundTrip,
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
    pub fn as_str(&self) -> &str {
        &self.0
    }
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
        let mut normalized = std::ffi::OsString::new();
        for (index, component) in path.components().enumerate() {
            if index > 0 {
                normalized.push("/");
            }
            normalized.push(component.as_os_str());
        }
        Ok(Self(PathBuf::from(normalized)))
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
/// How the stored bytes became the text (`DP-32`): lossless encodings
/// (`Utf8`, `Utf16Le`, `Utf16Be`, `Gb18030`) round-trip back to their original
/// byte representation on save, while [`TextEncoding::Lossy`] opens read-only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TextEncoding {
    #[default]
    Utf8,
    /// UTF-16 little-endian with `FF FE` BOM.
    Utf16Le,
    /// UTF-16 big-endian with `FE FF` BOM.
    Utf16Be,
    /// Lossless GB18030 (`decodeTextFile`).
    Gb18030,
    /// Invalid byte sequences decoded with `U+FFFD` replacement; read-only.
    Lossy,
}
impl TextEncoding {
    /// Compatibility alias for callers comparing against `Unknown`.
    #[allow(non_upper_case_globals)]
    pub const Unknown: Self = Self::Lossy;

    pub const fn is_lossless(self) -> bool {
        !matches!(self, Self::Lossy)
    }

    pub const fn is_lossy(self) -> bool {
        matches!(self, Self::Lossy)
    }
}
pub type Encoding = TextEncoding;

/// Observed line-ending discipline of a decoded text resource (`DP-31`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum LineEnding {
    #[default]
    Lf,
    Crlf,
    Cr,
    Mixed {
        dominant_crlf: bool,
    },
}
impl LineEnding {
    /// `true` when saving silently would rewrite mixed or lone-`CR` line endings
    /// without explicit user normalization (`DP-31`).
    pub const fn requires_normalization(self) -> bool {
        matches!(self, Self::Cr | Self::Mixed { .. })
    }

    /// Target uniform line ending used after "Normalize line endings and edit".
    pub const fn normalized(self) -> Self {
        match self {
            Self::Crlf
            | Self::Mixed {
                dominant_crlf: true,
            } => Self::Crlf,
            Self::Lf
            | Self::Cr
            | Self::Mixed {
                dominant_crlf: false,
            } => Self::Lf,
        }
    }

    /// Normalizes all `\r\n` and lone `\r` into `\n` while recording the
    /// original line-ending discipline.
    pub fn detect_and_normalize(raw: &str) -> (String, Self) {
        if !raw.contains('\r') {
            return (raw.to_owned(), Self::Lf);
        }
        let bytes = raw.as_bytes();
        let mut out = String::with_capacity(raw.len());
        let mut crlf_count = 0usize;
        let mut cr_count = 0usize;
        let mut lf_count = 0usize;
        let mut i = 0usize;
        let mut seg_start = 0usize;
        while i < bytes.len() {
            match bytes[i] {
                b'\r' => {
                    out.push_str(&raw[seg_start..i]);
                    out.push('\n');
                    if bytes.get(i + 1) == Some(&b'\n') {
                        crlf_count += 1;
                        i += 2;
                    } else {
                        cr_count += 1;
                        i += 1;
                    }
                    seg_start = i;
                }
                b'\n' => {
                    lf_count += 1;
                    i += 1;
                }
                _ => {
                    i += 1;
                }
            }
        }
        out.push_str(&raw[seg_start..]);
        let line_ending = if cr_count == 0 && lf_count == 0 {
            Self::Crlf
        } else if crlf_count == 0 && lf_count == 0 {
            Self::Cr
        } else {
            Self::Mixed {
                dominant_crlf: crlf_count > lf_count + cr_count,
            }
        };
        (out, line_ending)
    }
}

/// Lightweight entry metadata returned by `stat_entry` (`RG-02`) without
/// buffering file contents.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EntryStat {
    pub size: u64,
    pub is_file: bool,
    pub readonly: bool,
}

#[derive(Clone, Debug)]
pub struct TextSnapshot {
    pub text: String,
    pub revision: Revision,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
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
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub text_bytes: usize,
    pub directory_entries: usize,
}
impl Limits {
    /// No provider may admit more text than the largest viewer budget.
    pub const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;
    /// The largest text viewer budget (Markdown and plain text, 16 MiB);
    /// each viewer's own `maxSourceBytes` still applies at admission.
    pub const LOCAL: Self = Self {
        text_bytes: 16 * 1024 * 1024,
        directory_entries: 2_000,
    };
    /// Physical bytes admitted or saved by a standalone file window.
    pub const FILE_WINDOW_BYTES: usize = 1024 * 1024;
    /// Legacy decoding can expand each source byte into a three-byte UTF-8
    /// replacement character. The local adapter separately enforces the
    /// physical limit before reading and before publishing encoded bytes.
    pub const FILE_WINDOW: Self = Self {
        text_bytes: 3 * Self::FILE_WINDOW_BYTES,
        directory_entries: 1,
    };
    pub const CLOUD: Self = Self {
        text_bytes: 8 * 1024 * 1024,
        directory_entries: 10_000,
    };
}
#[derive(Clone, Debug)]
pub struct Descriptor {
    pub limits: Limits,
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
    Bytes {
        mime: String,
        bytes: Arc<[u8]>,
    },
}
