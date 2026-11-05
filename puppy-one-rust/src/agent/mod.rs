#[allow(dead_code)]
pub mod agent_events;
pub mod bootstrap;
pub mod connections;
// The migration lands bottom-up; consumers arrive with the layers above.
#[allow(dead_code)]
pub mod contract;
pub mod domain;
pub mod infrastructure;
#[cfg(test)]
mod integration_tests;
#[allow(dead_code)]
pub mod migrations;
pub mod persistence;
pub mod protocols;
pub mod runtime;
pub mod runtimes;
pub mod transports;
