//! `runtimes/workbuddy/workbuddy-identity.mjs`.
use super::workbuddy_channels::{
    WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL, WorkBuddyChannel,
};
use crate::agent::runtime::agent_runtime_manifest::{
    define_agent_runtime_manifest, runtime_descriptor_from_manifest,
};
use serde_json::{Value, json};
use std::sync::LazyLock;

fn create_work_buddy_runtime_manifest(channel: &WorkBuddyChannel) -> Value {
    define_agent_runtime_manifest(&json!({
        "id": channel.id,
        "displayName": channel.display_name,
        "description": format!(
            "The user's {} account, models and native sessions through CodeBuddy Code ACP.",
            channel.display_name
        ),
        "iconKey": "workbuddy",
        "priority": 20,
        "execution": {
            "kind": "local-process",
            "distribution": "user-installed",
            "controller": "bundled-adapter",
        },
        "protocol": { "kind": "acp", "transport": "stdio-json-rpc" },
        "integration": { "kind": "native-protocol", "adapter": "generic-acp" },
        "trust": { "level": "first-party", "publisher": "Tencent" },
        "ownership": {
            "harness": "runtime",
            "credentials": ["runtime"],
            "models": "runtime",
            "billing": ["runtime"],
            "session": "runtime",
        },
    }))
    .expect("the WorkBuddy runtime manifest is valid")
}

pub static WORKBUDDY_CHINA_RUNTIME_MANIFEST: LazyLock<Value> =
    LazyLock::new(|| create_work_buddy_runtime_manifest(&WORKBUDDY_CHINA_CHANNEL));
pub static WORKBUDDY_INTERNATIONAL_RUNTIME_MANIFEST: LazyLock<Value> =
    LazyLock::new(|| create_work_buddy_runtime_manifest(&WORKBUDDY_INTERNATIONAL_CHANNEL));
pub static WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&WORKBUDDY_CHINA_RUNTIME_MANIFEST)
        .expect("the WorkBuddy descriptor is valid")
});
pub static WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR: LazyLock<Value> = LazyLock::new(|| {
    runtime_descriptor_from_manifest(&WORKBUDDY_INTERNATIONAL_RUNTIME_MANIFEST)
        .expect("the WorkBuddy descriptor is valid")
});

/// `workBuddyRuntimeIdentity(channel)`: `(manifest, descriptor)`.
pub fn work_buddy_runtime_identity(channel: &WorkBuddyChannel) -> (Value, Value) {
    if channel.id == WORKBUDDY_CHINA_CHANNEL.id {
        (
            WORKBUDDY_CHINA_RUNTIME_MANIFEST.clone(),
            WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR.clone(),
        )
    } else {
        (
            WORKBUDDY_INTERNATIONAL_RUNTIME_MANIFEST.clone(),
            WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR.clone(),
        )
    }
}
