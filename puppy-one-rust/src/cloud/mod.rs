//! The Cloud client below the UI: the account's sign-in broker and request
//! authority ([`auth`]) and the first publication's journal, Git transfer
//! and credentials ([`publication`]). Workspaces, the Agent and features
//! build on these; nothing here paints.
pub mod auth;
pub mod publication;
