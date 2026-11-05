//! `electron/main/platform/common`: platform-owned inputs for executable
//! discovery. Product definitions never read process globals directly.
//! Failures and cancellation use the Agent host's `Error`/`AbortSignal`
//! analogs (`agent::agent_error`, `agent::event_loop`).
pub mod bounded_process_probe;
pub mod command_environment;
pub mod discovery_io_budget;
pub mod executable_discovery_port;
