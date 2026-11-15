//! Launch-time authority for a trusted installation ID. Discovery snapshots
//! only decide what to show; each process start resolves and verifies anew.
use crate::agent::{
    agent_error::{AgentError, AgentResult},
    discovery::{
        command_environment::EnvMap,
        executable_discovery_port::{DiscoveryPortOptions, ExecutableDiscoveryPort},
    },
    installation::{
        executable_resolver::{
            LocalAgentExecutableResolver, Observation, ResolvedCandidate,
            assert_executable_identity, safe_absolute_path,
        },
        installation_registry::{DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY, InstallationRegistry},
        installation_service::{CreateContext, Resolve},
    },
    tasks::CancelSignal,
};
use futures_util::future::LocalBoxFuture;
use std::rc::Rc;

pub type Verify = Rc<dyn Fn(ResolvedCandidate) -> LocalBoxFuture<'static, AgentResult<String>>>;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalAgentLaunch {
    pub executable_path: String,
    pub args: Vec<String>,
    pub display_name: String,
    pub environment: EnvMap,
}
impl TerminalAgentLaunch {
    pub fn into_shell_agent(self) -> crate::platform::terminal::shell::AgentCommand {
        crate::platform::terminal::shell::AgentCommand {
            executable_path: self.executable_path,
            args: self.args,
            display_name: Some(self.display_name),
            path_entries: vec![],
            environment: Some(self.environment),
        }
    }
    pub fn into_command(self) -> crate::platform::terminal::LaunchCommand {
        crate::platform::terminal::LaunchCommand {
            executable: self.executable_path.into(),
            arguments: self.args,
            environment: self.environment.into_iter().collect(),
        }
    }
}
pub struct TerminalLaunchResolver {
    registry: InstallationRegistry,
    context: CreateContext,
    resolve: Resolve,
    verify: Verify,
}
impl TerminalLaunchResolver {
    pub fn new(
        registry: InstallationRegistry,
        context: CreateContext,
        resolve: Resolve,
        verify: Verify,
    ) -> Self {
        Self {
            registry,
            context,
            resolve,
            verify,
        }
    }
    pub fn system() -> Self {
        let resolver = Rc::new(LocalAgentExecutableResolver::new(
            None,
            ExecutableDiscoveryPort::new(DiscoveryPortOptions::default()),
        ));
        let context = resolver.clone();
        Self::new(
            DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
            Rc::new(move |signal| {
                let resolver = context.clone();
                Box::pin(async move { resolver.create_context(Some(signal)).await })
            }),
            Rc::new(move |definition, context| {
                let resolver = resolver.clone();
                Box::pin(async move {
                    resolver
                        .resolve(&definition.id, Some((*context).clone()), vec![])
                        .await
                })
            }),
            Rc::new(|candidate| {
                Box::pin(async move { assert_executable_identity(&candidate).await })
            }),
        )
    }
    pub async fn resolve(
        &self,
        id: &str,
        signal: CancelSignal,
    ) -> AgentResult<TerminalAgentLaunch> {
        signal.check()?;
        let definition = self
            .registry
            .iter()
            .find(|d| d.id == id)
            .ok_or_else(unavailable)?;
        let context = Rc::new(
            (self.context)(signal.clone())
                .await
                .map_err(|_| unavailable())?,
        );
        signal.check()?;
        let observation = (self.resolve)(definition.clone(), context.clone())
            .await
            .map_err(|_| unavailable())?;
        let Observation::Found { candidate, .. } = observation else {
            return Err(unavailable());
        };
        if !safe_candidate(&candidate) {
            return Err(unavailable());
        }
        signal.check()?;
        let path = (self.verify)((*candidate).clone())
            .await
            .map_err(|_| unavailable())?;
        if !safe_absolute_path(&path) {
            return Err(unavailable());
        }
        signal.check()?;
        Ok(TerminalAgentLaunch {
            executable_path: path,
            args: candidate.args_prefix,
            display_name: definition.display_name.clone(),
            environment: candidate
                .environment
                .unwrap_or_else(|| context.environment.clone()),
        })
    }
}
fn safe_candidate(candidate: &ResolvedCandidate) -> bool {
    safe_absolute_path(&candidate.executable_path)
        && (candidate.launch_path_entry.is_empty()
            || safe_absolute_path(&candidate.launch_path_entry))
        && candidate.args_prefix.len() <= 4
        && candidate
            .args_prefix
            .iter()
            .all(|arg| crate::text::len16(arg) <= 160 && !arg.contains(['\r', '\n', '\0']))
}
fn unavailable() -> AgentError {
    AgentError::new("TERMINAL_AGENT_UNAVAILABLE")
}
/// Runs on a PTY preparation worker; no UI entity or cached candidate is trusted.
pub fn resolve_terminal_launch_now(id: &str) -> AgentResult<TerminalAgentLaunch> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| unavailable())?;
    tokio::task::LocalSet::new().block_on(
        &runtime,
        TerminalLaunchResolver::system().resolve(id, CancelSignal::default()),
    )
}

#[cfg(test)]
mod tests;
