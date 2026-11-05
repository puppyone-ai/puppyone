//! `electron/main/agent/protocols/pi-rpc`: Pi's official RPC protocol.
pub mod legacy_pi_rpc_adapter;
#[allow(dead_code)]
pub mod pi_event_normalizer;
#[allow(dead_code)]
pub mod pi_prompt_input;
#[allow(dead_code)]
pub mod pi_rpc_client;
#[allow(dead_code)]
pub mod pi_rpc_runtime_adapter;
#[cfg(test)]
mod tests;
