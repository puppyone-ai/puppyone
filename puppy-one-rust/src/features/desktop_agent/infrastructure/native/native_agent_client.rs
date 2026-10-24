//! Platform seam consumed by the application composition; no Electron preload is required.
use crate::{
    agent::{
        connections::local_agent_inventory::Installation,
        runtime::agent_runtime_port::AgentRuntimePort,
    },
    wake::Wake,
};
use std::path::PathBuf;
pub fn create(
    installation: Installation,
    root: PathBuf,
    history: bool,
    wake: Wake,
) -> Box<dyn AgentRuntimePort> {
    crate::agent::bootstrap::create_agent_runtime_host::create(installation, root, history, wake)
}
