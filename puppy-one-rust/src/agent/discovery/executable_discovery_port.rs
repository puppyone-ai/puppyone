//! `platform/common/executable-discovery-port.mjs`: the platform-owned
//! inputs executable discovery uses. Product definitions do not read process
//! globals directly, which keeps them deterministic in tests and leaves room
//! for platform-specific adapters without provider rewrites.
use super::bounded_process_probe::node_platform;
use super::command_environment::{
    EnvMap, EnvironmentSnapshot, ReadEnvironmentOptions, read_user_command_environment,
};
use crate::agent::agent_error::AgentResult;
use crate::agent::discovery::windows::registered_applications::{
    RegisteredApplication, find_registered_applications,
};
use crate::agent::tasks::CancelSignal;
use futures_util::future::LocalBoxFuture;
use std::path::PathBuf;
use std::rc::Rc;

/// `readEnvironment({ env, homedir, platform, signal })`.
pub type ReadEnvironment = Rc<
    dyn Fn(
        EnvMap,
        PathBuf,
        String,
        Option<CancelSignal>,
    ) -> LocalBoxFuture<'static, AgentResult<EnvironmentSnapshot>>,
>;

/// `findRegisteredApplications(applicationNames, { signal })`.
pub type FindRegisteredApplications = Rc<
    dyn Fn(
        Vec<String>,
        Option<CancelSignal>,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<RegisteredApplication>>>,
>;

/// `createExecutableDiscoveryPort(options)`.
#[derive(Clone)]
pub struct ExecutableDiscoveryPort {
    pub node_platform: String,
    pub env: EnvMap,
    pub homedir: PathBuf,
    read_environment: ReadEnvironment,
    find_registered_applications: FindRegisteredApplications,
}

/// The overridable inputs of [`ExecutableDiscoveryPort::new`].
#[derive(Clone, Default)]
pub struct DiscoveryPortOptions {
    pub node_platform: Option<String>,
    pub env: Option<EnvMap>,
    pub homedir: Option<PathBuf>,
    pub read_environment: Option<ReadEnvironment>,
    pub find_registered_applications: Option<FindRegisteredApplications>,
}

/// The default `readEnvironment`: the user's login-shell environment.
pub fn default_read_environment() -> ReadEnvironment {
    Rc::new(|env, homedir, platform, signal| {
        Box::pin(read_user_command_environment(ReadEnvironmentOptions {
            env,
            platform,
            homedir,
            signal,
            run_probe: None,
            timeout_ms: None,
        }))
    })
}

impl ExecutableDiscoveryPort {
    pub fn new(options: DiscoveryPortOptions) -> Self {
        let node_platform = options
            .node_platform
            .unwrap_or_else(|| node_platform().into());
        let env = options.env.unwrap_or_else(|| std::env::vars().collect());
        let find_registered_applications =
            options.find_registered_applications.unwrap_or_else(|| {
                let (platform, environment) = (node_platform.clone(), env.clone());
                Rc::new(move |names: Vec<String>, signal: Option<CancelSignal>| {
                    let (platform, environment) = (platform.clone(), environment.clone());
                    Box::pin(async move {
                        find_registered_applications(
                            &platform,
                            &environment,
                            &names,
                            signal.as_ref(),
                        )
                        .await
                    })
                })
            });
        Self {
            node_platform,
            env,
            homedir: options
                .homedir
                .unwrap_or_else(crate::platform::paths::home_dir),
            read_environment: options
                .read_environment
                .unwrap_or_else(default_read_environment),
            find_registered_applications,
        }
    }

    /// `port.captureEnvironment({ signal })`.
    pub fn capture_environment(
        &self,
        signal: Option<CancelSignal>,
    ) -> LocalBoxFuture<'static, AgentResult<EnvironmentSnapshot>> {
        (self.read_environment)(
            self.env.clone(),
            self.homedir.clone(),
            self.node_platform.clone(),
            signal,
        )
    }

    /// `port.findRegisteredApplications(applicationNames, { signal })`.
    pub fn find_registered_applications(
        &self,
        application_names: Vec<String>,
        signal: Option<CancelSignal>,
    ) -> LocalBoxFuture<'static, AgentResult<Vec<RegisteredApplication>>> {
        (self.find_registered_applications)(application_names, signal)
    }
}
