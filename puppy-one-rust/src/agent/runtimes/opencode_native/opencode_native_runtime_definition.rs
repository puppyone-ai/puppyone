//! `runtimes/opencode-native/opencode-native-runtime-definition.mjs`.
use super::opencode_native_discovery::{OpenCodeDiscoveryOptions, create_user_open_code_discovery};
use crate::agent::protocols::acp::acp_runtime_adapter::Logger;
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use crate::agent::runtime::agent_runtime_port::AgentRuntimeAdapter;
use crate::agent::runtime::agent_runtime_registry::{RuntimeDefinition, RuntimeDiscovery};
use crate::agent::runtimes::cursor::cursor_runtime_definition::acp_adapter_options;
use crate::agent::runtimes::opencode_protocol::opencode_acp_adapter::open_code_acp_adapter;
use serde_json::{Value, json};
use std::rc::Rc;
use std::sync::LazyLock;

/// `OPENCODE_NATIVE_RUNTIME_MANIFEST`.
pub static OPENCODE_NATIVE_RUNTIME_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    define_agent_runtime_manifest(&json!({
        "id": "opencode-native",
        "displayName": "OpenCode",
        "description": "The user's OpenCode installation, profile, providers and native sessions.",
        "iconKey": "opencode",
        "priority": 30,
        "execution": {
            "kind": "local-process",
            "distribution": "user-installed",
            "controller": "bundled-adapter",
        },
        "protocol": { "kind": "acp", "transport": "stdio-json-rpc" },
        "integration": { "kind": "native-protocol", "adapter": "generic-acp" },
        "trust": { "level": "first-party", "publisher": "Anomaly" },
        "ownership": {
            "harness": "runtime",
            "credentials": ["user-provider"],
            "models": "runtime",
            "billing": ["user-provider"],
            "session": "runtime",
        },
    }))
    .expect("the OpenCode runtime manifest is valid")
});

/// `OPENCODE_NATIVE_RUNTIME_DESCRIPTOR`.
pub static OPENCODE_NATIVE_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&OPENCODE_NATIVE_RUNTIME_MANIFEST)
        .expect("the OpenCode runtime descriptor is valid")
});

/// `createOpenCodeNativeRuntimeDefinition({ discovery, logger, appVersion })`.
pub fn create_open_code_native_runtime_definition(
    discovery: Option<Rc<dyn RuntimeDiscovery>>,
    logger: Option<Logger>,
    app_version: Option<&str>,
) -> RuntimeDefinition {
    let app_version = app_version.unwrap_or("0.0.0").to_string();
    RuntimeDefinition {
        manifest: OPENCODE_NATIVE_RUNTIME_MANIFEST.clone(),
        discovery: discovery.unwrap_or_else(|| {
            Rc::new(create_user_open_code_discovery(
                OpenCodeDiscoveryOptions::default(),
                None,
            ))
        }),
        create_adapter: Rc::new(move |options| {
            let acp = acp_adapter_options(
                &options,
                &OPENCODE_NATIVE_RUNTIME_DESCRIPTOR,
                &app_version,
                logger.clone(),
            );
            Ok(Rc::new(open_code_acp_adapter(acp)?) as Rc<dyn AgentRuntimeAdapter>)
        }),
        dispose: None,
        has_active_resources: None,
    }
}
