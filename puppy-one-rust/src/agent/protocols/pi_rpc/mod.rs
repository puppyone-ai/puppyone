//! `electron/main/agent/protocols/pi-rpc`: Pi's official RPC protocol.
pub mod pi_event_normalizer;
pub mod pi_prompt_input;
pub mod pi_rpc_client;
pub mod pi_rpc_runtime_adapter;
#[cfg(test)]
mod tests;
