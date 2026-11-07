//! `electron/main/agent/transports`.
pub mod bounded_process_probe;
pub mod executable_discovery;
pub mod jsonl_rpc_connection;
pub mod jsonl_stream;
pub mod managed_agent_process;
pub mod native_request_ledger;
pub mod rpc_connection;
#[cfg(test)]
pub mod test_support;
#[cfg(test)]
mod tests;
