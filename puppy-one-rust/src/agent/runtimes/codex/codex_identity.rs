//! `runtimes/codex/codex-identity.mjs`: the canonical Codex runtime
//! identity; the renderer owns its visual mark mapping.
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `CODEX_RUNTIME_MANIFEST`.
pub static CODEX_RUNTIME_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    define_agent_runtime_manifest(&json!({
        "id": "codex",
        "displayName": "Codex",
        "description": "Codex's native app-server, login, models, tools, approvals and sessions.",
        "iconKey": "codex",
        "priority": 50,
        "execution": {
            "kind": "local-process",
            "distribution": "user-installed",
            "controller": "bundled-adapter",
        },
        "protocol": { "kind": "app-server", "transport": "stdio-json-rpc" },
        "integration": { "kind": "specialized-native", "adapter": "specialized" },
        "trust": { "level": "first-party", "publisher": "OpenAI" },
        "ownership": {
            "harness": "runtime",
            "credentials": ["runtime"],
            "models": "runtime",
            "billing": ["runtime"],
            "session": "runtime",
        },
    }))
    .expect("the Codex runtime manifest is valid")
});

/// `CODEX_RUNTIME_DESCRIPTOR`.
pub static CODEX_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&CODEX_RUNTIME_MANIFEST)
        .expect("the Codex runtime descriptor is valid")
});
