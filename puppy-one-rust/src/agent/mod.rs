#[allow(dead_code)]
pub mod agent_error;
#[allow(dead_code)]
pub mod agent_events;
#[allow(dead_code)]
pub mod agent_shutdown;
#[allow(dead_code)]
pub mod application;
pub mod bootstrap;
#[allow(dead_code)]
pub mod cache;
pub mod connections;
// The migration lands bottom-up; consumers arrive with the layers above.
#[allow(dead_code)]
pub mod contract;
pub mod domain;
#[allow(dead_code)]
pub mod event_loop;
pub mod infrastructure;
#[cfg(test)]
mod integration_tests;
#[allow(dead_code)]
pub mod migrations;
#[allow(dead_code)]
pub mod node_path;
pub mod persistence;
pub mod protocols;
#[allow(dead_code)]
pub mod runtime;
pub mod runtimes;
#[allow(dead_code)]
pub mod security;
#[allow(dead_code)]
pub mod sender;
pub mod transports;
