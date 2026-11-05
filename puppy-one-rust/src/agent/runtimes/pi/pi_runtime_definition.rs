//! `runtimes/pi/pi-runtime-definition.mjs`.
use super::pi_discovery::{PiDiscoveryOptions, create_pi_discovery};
use super::pi_identity::{PI_RUNTIME_DESCRIPTOR, PI_RUNTIME_MANIFEST};
use super::pi_rpc_adapter::pi_rpc_adapter;
use crate::agent::protocols::pi_rpc::pi_rpc_runtime_adapter::PiAdapterOptions;
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use std::rc::Rc;

/// `createPiRuntimeDefinition({ discovery, logger })`.
pub fn create_pi_runtime_definition(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
) -> RuntimeDefinition {
    RuntimeDefinition {
        manifest: PI_RUNTIME_MANIFEST.clone(),
        discovery: discovery
            .unwrap_or_else(|| Rc::new(create_pi_discovery(PiDiscoveryOptions::default(), None))),
        create_adapter: Rc::new(|options| {
            let mut pi = PiAdapterOptions::new(
                options.readiness.clone(),
                &options.workspace_root,
                PI_RUNTIME_DESCRIPTOR.clone(),
                String::new(),
            );
            pi.on_event = options.on_event.clone();
            pi.on_exit = options.on_exit.clone();
            pi.on_session_persisted = options.on_session_persisted.clone();
            Ok(Rc::new(pi_rpc_adapter(pi)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: None,
        has_active_resources: None,
    }
}
