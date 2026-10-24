//! Native composition root. Provider adapters never leak into GPUI or application commands.
use crate::{
    agent::{
        connections::local_agent_inventory::Installation,
        protocols::{acp::acp_runtime_adapter, pi_rpc::pi_rpc_adapter},
        runtime::{agent_runtime_port::AgentRuntimePort, agent_runtime_registry::Runtime},
        runtimes::{claude::claude_adapter, codex::codex_app_server_adapter},
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
    use crate::agent::{
        domain::agent_session_model::SessionSnapshot,
        runtime::session_lease::{Lease, Leased, Unavailable},
    };
    let lease = match Lease::acquire(root.clone()) {
        Ok(lease) => lease,
        Err(error) => {
            let mut snapshot = SessionSnapshot::new(&installation.label, history);
            snapshot.fail(error);
            return Box::new(Unavailable { snapshot });
        }
    };
    Box::new(Leased {
        lease,
        inner: create_inner(installation, root, history, wake),
    })
}
fn create_inner(
    installation: Installation,
    root: PathBuf,
    history: bool,
    wake: Wake,
) -> Box<dyn AgentRuntimePort> {
    let executable = installation.executable;
    match installation.runtime {
        Runtime::PuppyOne => Box::new(
            crate::agent::runtimes::puppyone_agent::adapter::Session::new(root, history, wake),
        ),
        Runtime::Codex => Box::new(codex_app_server_adapter::Session::new(
            executable, root, history, wake,
        )),
        Runtime::Claude => Box::new(claude_adapter::Session::new(
            executable, root, history, wake,
        )),
        Runtime::Pi => Box::new(pi_rpc_adapter::Session::new(
            executable, root, history, wake,
        )),
        runtime => {
            let args = match runtime {
                Runtime::WorkBuddy => vec!["--acp".into()],
                Runtime::OpenCode => vec!["acp".into(), format!("--cwd={}", root.display())],
                _ => vec!["acp".into()],
            };
            Box::new(acp_runtime_adapter::Session::new(
                executable,
                args,
                root,
                &installation.label,
                history,
                wake,
            ))
        }
    }
}
