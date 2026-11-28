//! `runtimes/claude/claude-identity.mjs`.
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `CLAUDE_RUNTIME_MANIFEST`.
pub static CLAUDE_RUNTIME_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    define_agent_runtime_manifest(&json!({
        "id": "claude",
        "displayName": "Claude Agent",
        "description": "Anthropic's official Agent SDK runtime using Claude Code's native authentication and billing.",
        "iconKey": "claude",
        "priority": 40,
        "execution": {
            "kind": "sdk-mediated-process",
            "distribution": "user-installed",
            "controller": "bundled-sdk",
        },
        "protocol": { "kind": "agent-sdk", "transport": "in-process-sdk" },
        "integration": { "kind": "specialized-native", "adapter": "specialized" },
        "trust": { "level": "first-party", "publisher": "Anthropic" },
        "ownership": {
            "harness": "runtime",
            "credentials": ["user-provider"],
            "models": "runtime",
            "billing": ["user-provider"],
            "session": "runtime",
        },
    }))
    .expect("the Claude runtime manifest is valid")
});

/// `CLAUDE_RUNTIME_DESCRIPTOR`.
pub static CLAUDE_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&CLAUDE_RUNTIME_MANIFEST)
        .expect("the Claude runtime descriptor is valid")
});
