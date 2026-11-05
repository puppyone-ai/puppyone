//! `runtimes/hermes/hermes-identity.mjs`.
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `HERMES_RUNTIME_MANIFEST`.
pub static HERMES_RUNTIME_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    define_agent_runtime_manifest(&json!({
        "id": "hermes",
        "displayName": "Hermes Agent",
        "description": "The user's Hermes Agent providers, models and native sessions through its first-party ACP server.",
        "iconKey": "hermes",
        "priority": 20,
        "execution": {
            "kind": "local-process",
            "distribution": "user-installed",
            "controller": "bundled-adapter",
        },
        "protocol": { "kind": "acp", "transport": "stdio-json-rpc" },
        "integration": { "kind": "native-protocol", "adapter": "generic-acp" },
        "trust": { "level": "first-party", "publisher": "Nous Research" },
        "ownership": {
            "harness": "runtime",
            "credentials": ["runtime"],
            "models": "runtime",
            "billing": ["runtime"],
            "session": "runtime",
        },
        "source": "github.com/NousResearch/hermes-agent",
        "compatibility": "hermes-acp",
    }))
    .expect("the Hermes runtime manifest is valid")
});

/// `HERMES_RUNTIME_DESCRIPTOR`.
pub static HERMES_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&HERMES_RUNTIME_MANIFEST)
        .expect("the Hermes runtime descriptor is valid")
});
