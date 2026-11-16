//! Pure state-machine types for [`super::document_editing_session::DocumentEditingSession`]
//! (`DP-43`, `DP-44`). No GPUI, filesystem or transport dependencies.

use crate::editor::text::buffer::Buffer;
pub use crate::workspace::ErrorKind;

/// Conversion helper for constructing `$O(1)$` [`Buffer`] snapshots from owned
/// strings, borrowed slices or existing rope snapshots.
pub trait IntoBuffer {
    fn into_buffer(self) -> Buffer;
}

impl IntoBuffer for Buffer {
    fn into_buffer(self) -> Buffer {
        self
    }
}

impl IntoBuffer for String {
    fn into_buffer(self) -> Buffer {
        Buffer::new(self)
    }
}

impl IntoBuffer for &str {
    fn into_buffer(self) -> Buffer {
        Buffer::new(self)
    }
}

/// Immutable `$O(1)$`-cloneable rope snapshot of editor document content (`DP-44`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub revision: u64,
    pub text: Buffer,
}

impl Snapshot {
    pub fn new(revision: u64, text: impl IntoBuffer) -> Self {
        Self {
            revision,
            text: text.into_buffer(),
        }
    }
}

/// Dispatched single in-flight write candidate.
#[derive(Clone, Debug)]
pub struct Commit {
    pub sequence: u64,
    pub epoch: u64,
    pub snapshot: Snapshot,
}

/// Typed storage/persistence error (`DP-43`); conflicts live in [`ConflictState`],
/// never in error strings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionError {
    pub kind: ErrorKind,
    pub message: String,
}

impl SessionError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// Typed result of a conditional storage write (`DP-43`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    /// Conditional write succeeded and produced a new storage revision.
    Written {
        text: Buffer,
        revision: Option<String>,
    },
    /// Conditional write was rejected because storage held a newer version.
    Conflict {
        remote_text: Buffer,
        remote_revision: Option<String>,
    },
}

/// Deferred hosted conflict state (`DP-05`, `DP-43`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConflictState {
    pub base: Buffer,
    pub ours: Buffer,
    pub theirs: Buffer,
    pub remote_revision: Option<String>,
}

/// Outcome of observing storage content (`DP-01`, `DP-04`, `DP-05`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StorageObservation {
    Baseline,
    OwnWrite,
    Adopted {
        text: Buffer,
        had_local_unmerged: bool,
        overwrote_local_overlap: bool,
    },
    /// Hosted content changed in overlapping sections under unsaved input (`DP-05`).
    Deferred(ConflictState),
}

/// Outcome of completing an in-flight write (`DP-43`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Completion {
    Retired,
    Saved,
    Adopted {
        text: Buffer,
        had_local_unmerged: bool,
        overwrote_local_overlap: bool,
    },
    Failed(SessionError),
    /// Hosted conditional-write rejection in overlapping sections (`DP-05`).
    Deferred(ConflictState),
}
