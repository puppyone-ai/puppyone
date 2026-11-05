//! `runtimes/puppyone-agent/puppyone-agent-runtime-definition.mjs`.
use super::model_connection_binding::ModelConnectionPort;
use super::puppyone_agent_adapter::PuppyOneAgentAdapter;
use super::puppyone_agent_discovery::{PuppyOneDiscoveryOptions, create_puppyone_agent_discovery};
use super::puppyone_agent_identity::{
    PUPPYONE_AGENT_RUNTIME_DESCRIPTOR, PUPPYONE_AGENT_RUNTIME_MANIFEST,
};
use crate::agent::agent_error::AgentResult;
use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::PiAdapterOptions;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use std::rc::Rc;

/// `adapterFactory(options)`.
pub type PuppyOneAdapterFactory = Rc<
    dyn Fn(
        PiAdapterOptions,
        Option<Rc<dyn ModelConnectionPort>>,
    ) -> AgentResult<Rc<dyn AgentRuntimeAdapter>>,
>;

/// `createPuppyOneAgentRuntimeDefinition({ … })` inputs.
#[derive(Clone, Default)]
pub struct PuppyOneRuntimeDefinitionOptions {
    pub app_path: Option<String>,
    pub user_data_path: Option<String>,
    pub executable_path: Option<String>,
    pub model_connection_port: Option<Rc<dyn ModelConnectionPort>>,
    pub discovery: Option<Rc<dyn RuntimeDiscovery>>,
    pub adapter_factory: Option<PuppyOneAdapterFactory>,
}

/// `createPuppyOneAgentRuntimeDefinition(options)`.
pub fn create_puppyone_agent_runtime_definition(
    options: PuppyOneRuntimeDefinitionOptions,
) -> RuntimeDefinition {
    let discovery = options.discovery.clone().unwrap_or_else(|| {
        Rc::new(create_puppyone_agent_discovery(
            PuppyOneDiscoveryOptions {
                app_path: options.app_path.clone(),
                user_data_path: options.user_data_path.clone(),
                executable_path: options.executable_path.clone(),
                ..Default::default()
            },
            None,
        ))
    });
    let factory = options.adapter_factory.clone().unwrap_or_else(|| {
        Rc::new(|options, port| {
            Ok(Rc::new(PuppyOneAgentAdapter::new(options, port)?) as Rc<dyn AgentRuntimeAdapter>)
        })
    });
    let port = options.model_connection_port.clone();
    RuntimeDefinition {
        manifest: PUPPYONE_AGENT_RUNTIME_MANIFEST.clone(),
        discovery,
        create_adapter: Rc::new(move |options| {
            let mut pi = PiAdapterOptions::new(
                options.readiness.clone(),
                &options.workspace_root,
                PUPPYONE_AGENT_RUNTIME_DESCRIPTOR.clone(),
                String::new(),
            );
            pi.on_event = options.on_event.clone();
            pi.on_exit = options.on_exit.clone();
            pi.on_session_persisted = options.on_session_persisted.clone();
            factory(pi, port.clone())
        }),
        dispose: None,
        has_active_resources: None,
    }
}
