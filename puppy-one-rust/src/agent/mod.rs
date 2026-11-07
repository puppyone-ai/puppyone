pub mod agent_error;
pub mod agent_events;
pub mod agent_reference_authorization;
pub mod application;
pub mod bootstrap;
pub mod cache;
pub mod connections;
// Executable discovery and the local installations it resolves
// (`electron/main/platform/common`, `electron/main/local-agent-installation`).
pub use po_contracts::agent::contract;
pub mod discovery;
pub mod domain;
pub mod host;
pub mod infrastructure;
pub mod installation;
pub mod migrations;
/// The Built-in Agent's model connections: their configuration and
/// credentials (`electron/main/model-connections`).
pub mod model_connections;
pub mod persistence;
pub mod protocols;
pub mod runtime;
pub mod runtimes;
pub mod security;
pub mod sender;
pub mod tasks;
pub mod transports;
