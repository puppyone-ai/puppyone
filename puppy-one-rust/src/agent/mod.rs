#[allow(dead_code)]
pub mod agent_error;
#[allow(dead_code)]
pub mod agent_events;
#[allow(dead_code)]
pub mod agent_reference_authorization;
#[allow(dead_code)]
pub mod agent_shutdown;
#[allow(dead_code)]
pub mod application;
pub mod bootstrap;
#[allow(dead_code)]
pub mod cache;
pub mod connections;
// Executable discovery and the local installations it resolves
// (`electron/main/platform/common`, `electron/main/local-agent-installation`).
pub mod discovery;
// The migration lands bottom-up; consumers arrive with the layers above.
#[allow(dead_code)]
pub mod contract;
pub mod domain;
#[allow(dead_code)]
pub mod host;
pub mod infrastructure;
pub mod installation;
#[allow(dead_code)]
pub mod migrations;
/// The Built-in Agent's model connections: their configuration and
/// credentials (`electron/main/model-connections`).
pub mod model_connections;
#[allow(dead_code)]
pub mod persistence;
pub mod protocols;
#[allow(dead_code)]
pub mod runtime;
pub mod runtimes;
#[allow(dead_code)]
pub mod security;
#[allow(dead_code)]
pub mod sender;
#[allow(dead_code)]
pub mod tasks;
pub mod transports;
