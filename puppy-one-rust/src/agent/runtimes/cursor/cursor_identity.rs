//! `runtimes/cursor/cursor-identity.mjs`.
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `CURSOR_RUNTIME_MANIFEST`.
pub static CURSOR_RUNTIME_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    define_agent_runtime_manifest(&json!({
        "id": "cursor",
        "displayName": "Cursor Agent",
        "description": "The user's Cursor Agent harness, account, permissions and sessions through Cursor's ACP endpoint.",
        "iconKey": "cursor",
        "priority": 20,
        "execution": {
            "kind": "local-process",
            "distribution": "user-installed",
            "controller": "bundled-adapter",
        },
        "protocol": { "kind": "acp", "transport": "stdio-json-rpc" },
        "integration": { "kind": "native-protocol", "adapter": "generic-acp" },
        "trust": { "level": "first-party", "publisher": "Cursor" },
        "ownership": {
            "harness": "runtime",
            "credentials": ["runtime"],
            "models": "runtime",
            "billing": ["runtime"],
            "session": "runtime",
        },
    }))
    .expect("the Cursor runtime manifest is valid")
});

/// `CURSOR_RUNTIME_DESCRIPTOR`.
pub static CURSOR_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&CURSOR_RUNTIME_MANIFEST)
        .expect("the Cursor runtime descriptor is valid")
});
