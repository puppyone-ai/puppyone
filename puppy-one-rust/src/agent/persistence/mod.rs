//! `electron/main/agent/persistence`: the durable conversation catalog and
//! the session repository over it.
#[allow(dead_code)]
pub mod agent_conversation_catalog;
#[allow(dead_code)]
pub mod agent_session_repository;
pub mod legacy_session_catalog;
#[cfg(test)]
mod tests;
