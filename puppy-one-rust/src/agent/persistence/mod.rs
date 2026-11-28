//! `electron/main/agent/persistence`: the durable conversation catalog and
//! the session repository over it.
pub mod agent_conversation_catalog;
pub mod agent_session_repository;
#[cfg(test)]
mod tests;
