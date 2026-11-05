//! `electron/main/agent/transports`.
#[allow(dead_code)]
pub mod jsonl_rpc_connection;
#[allow(dead_code)]
pub mod jsonl_stream;
pub mod legacy_jsonl_rpc_connection;
#[allow(dead_code)]
pub mod managed_agent_process;
#[allow(dead_code)]
pub mod native_request_ledger;
#[cfg(test)]
pub mod test_support;
#[cfg(test)]
mod tests;
