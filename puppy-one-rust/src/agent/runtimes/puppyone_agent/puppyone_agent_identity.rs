//! `runtimes/puppyone-agent/puppyone-agent-identity.mjs`.
use super::puppyone_agent_kernel::{PUPPYONE_PI_KERNEL, PUPPYONE_PI_KERNEL_PROTOCOL};
use super::puppyone_agent_public_identity::{BUILT_IN_AGENT_DISPLAY_NAME, BUILT_IN_AGENT_ICON_KEY};
use crate::agent::contract::js::Obj;
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `PUPPYONE_AGENT_RUNTIME_ID`.
pub const PUPPYONE_AGENT_RUNTIME_ID: &str = "puppyone-agent";

/// `PUPPYONE_AGENT_RUNTIME_MANIFEST`.
pub static PUPPYONE_AGENT_RUNTIME_MANIFEST: LazyLock<Value> = LazyLock::new(|| {
    define_agent_runtime_manifest(&json!({
        "id": PUPPYONE_AGENT_RUNTIME_ID,
        "displayName": BUILT_IN_AGENT_DISPLAY_NAME,
        "description": format!("{BUILT_IN_AGENT_DISPLAY_NAME} is PuppyOne's managed coding Agent, powered by a pinned Pi SDK kernel."),
        "iconKey": BUILT_IN_AGENT_ICON_KEY,
        "priority": 100,
        "execution": {
            "kind": "sdk-mediated-process",
            "distribution": "bundled",
            "controller": "bundled-sdk",
        },
        "protocol": { "kind": "rpc", "transport": "stdio-jsonl" },
        "integration": { "kind": "managed-harness", "adapter": "custom" },
        "trust": { "level": "bundled-verified", "publisher": "PuppyOne" },
        "ownership": {
            "harness": "puppyone",
            "credentials": ["puppyone", "user-provider"],
            "models": "puppyone",
            "billing": ["puppyone", "user-provider"],
            "session": "puppyone",
        },
        "source": "pinned-pi-sdk",
        "compatibility": PUPPYONE_PI_KERNEL_PROTOCOL,
    }))
    .expect("the Built-in Agent runtime manifest is valid")
});

/// `PUPPYONE_AGENT_RUNTIME_DESCRIPTOR`.
pub static PUPPYONE_AGENT_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    let descriptor = runtime_descriptor_from_manifest(&PUPPYONE_AGENT_RUNTIME_MANIFEST)
        .expect("the Built-in Agent runtime descriptor is valid");
    Obj::from(&descriptor)
        .set("upstream", PUPPYONE_PI_KERNEL.clone())
        .build()
});
