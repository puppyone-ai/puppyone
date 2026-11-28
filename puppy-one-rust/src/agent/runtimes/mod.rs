pub mod claude;
pub mod codex;
pub mod cursor;
pub mod hermes;
#[cfg(test)]
mod live_tests;
pub mod opencode_native;
pub mod opencode_protocol;
pub mod pi;
pub mod puppyone_agent;
pub mod workbuddy;

#[cfg(all(test, unix))]
mod discovery_tests;

#[cfg(test)]
mod file_change_tests;

#[cfg(test)]
mod display_acceptance_tests;
