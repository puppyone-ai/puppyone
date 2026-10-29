#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub revision: u64,
    pub text: String,
}
#[derive(Clone, Debug)]
pub struct Commit {
    pub sequence: u64,
    pub epoch: u64,
    pub snapshot: Snapshot,
}
#[derive(Debug, PartialEq, Eq)]
pub enum StorageObservation {
    Baseline,
    OwnWrite,
    Adopted,
    /// Cloud content changed under unsaved input: the draft stays until the
    /// person chooses "Discard edits and reload" (`deferCloudBaseline`).
    Deferred,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Completion {
    Retired,
    Saved,
    Adopted,
    Failed(String),
    /// A Cloud conditional-write rejection under unsaved input: deferred.
    Deferred,
}
