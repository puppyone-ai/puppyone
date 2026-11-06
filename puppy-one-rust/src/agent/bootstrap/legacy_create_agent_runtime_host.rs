//! Native composition root. Provider adapters never leak into GPUI or application commands.
use crate::{
    agent::{
        connections::legacy_local_agent_inventory::Installation,
        protocols::{acp::legacy_acp_runtime_adapter, pi_rpc::legacy_pi_rpc_adapter},
        runtime::{legacy_runtime_port::AgentRuntimePort, legacy_runtime_registry::Runtime},
        runtimes::{claude::legacy_claude_adapter, codex::legacy_codex_app_server_adapter},
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
        domain::legacy_session_model::SessionSnapshot,
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
        Runtime::Codex => Box::new(legacy_codex_app_server_adapter::Session::new(
            executable, root, history, wake,
        )),
        Runtime::Claude => Box::new(legacy_claude_adapter::Session::new(
            executable, root, history, wake,
        )),
        Runtime::Pi => Box::new(legacy_pi_rpc_adapter::Session::new(
            executable, root, history, wake,
        )),
        runtime => {
            let args = match runtime {
                Runtime::WorkBuddy => vec!["--acp".into()],
                Runtime::OpenCode => vec!["acp".into(), format!("--cwd={}", root.display())],
                _ => vec!["acp".into()],
            };
            Box::new(legacy_acp_runtime_adapter::Session::new(
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
