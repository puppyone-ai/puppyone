//! `runtimes/pi/pi-identity.mjs`.
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `PI_RUNTIME_MANIFEST`.
pub static PI_RUNTIME_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    define_agent_runtime_manifest(&json!({
        "id": "pi",
        "displayName": "Pi",
        "description": "The user's Pi coding-agent installation, providers, models, tools and native sessions.",
        "iconKey": "pi",
        "priority": 20,
        "execution": {
            "kind": "local-process",
            "distribution": "user-installed",
            "controller": "bundled-adapter",
        },
        "protocol": { "kind": "rpc", "transport": "stdio-jsonl" },
        "integration": { "kind": "specialized-native", "adapter": "specialized" },
        "trust": { "level": "first-party", "publisher": "Pi" },
        "ownership": {
            "harness": "runtime",
            "credentials": ["user-provider"],
            "models": "runtime",
            "billing": ["user-provider"],
            "session": "runtime",
        },
        "source": "official-pi-rpc",
        "compatibility": "pi-rpc-v1",
    }))
    .expect("the Pi runtime manifest is valid")
});

/// `PI_RUNTIME_DESCRIPTOR`.
pub static PI_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&PI_RUNTIME_MANIFEST)
        .expect("the Pi runtime descriptor is valid")
});
