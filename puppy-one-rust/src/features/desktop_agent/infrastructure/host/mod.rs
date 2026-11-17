//! `infrastructure/electron`: the window's Agent client over the host
//! thread (the preload bridge and `electronAgentClient.ts`).
pub mod agent_host_client;
pub mod agent_host_global;
pub mod project_agent_client;
#[cfg(test)]
mod tests;
pub mod window_runtime;
