//! Product runtimes retain separate identities even when they share a protocol core.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Runtime {
    PuppyOne,
    Codex,
    Claude,
    Cursor,
    Hermes,
    OpenCode,
    Pi,
    WorkBuddy,
}
impl Runtime {}
