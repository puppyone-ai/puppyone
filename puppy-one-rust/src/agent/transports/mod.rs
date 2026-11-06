//! `electron/main/agent/transports`.
#[allow(dead_code, unused_imports)]
pub mod bounded_process_probe;
#[allow(dead_code)]
pub mod executable_discovery;
#[allow(dead_code)]
pub mod jsonl_rpc_connection;
#[allow(dead_code)]
pub mod jsonl_stream;
#[allow(dead_code)]
pub mod managed_agent_process;
#[allow(dead_code)]
pub mod native_request_ledger;
#[allow(dead_code)]
pub mod rpc_connection;
#[cfg(test)]
pub mod test_support;
#[cfg(test)]
mod tests;
