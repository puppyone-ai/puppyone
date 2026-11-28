//! `runtimes/puppyone-agent/puppyone-agent-kernel.mjs`: the pinned Pi SDK
//! kernel the Built-in Agent's worker runs.
use super::puppyone_agent_public_identity::BUILT_IN_AGENT_DISPLAY_NAME;
use serde_json::{Value, json};
use std::sync::LazyLock;

/// `PUPPYONE_PI_KERNEL`.
pub static PUPPYONE_PI_KERNEL: LazyLock<Value> = LazyLock::new(|| {
    json!({
        "packageName": "@earendil-works/pi-coding-agent",
        "version": "0.85.1",
        "sourceCommit": "d981de1229ef899957bbe968bc8dcda02a21f477",
        "repository": "https://github.com/earendil-works/pi",
        "license": "MIT",
        "protocol": "puppyone-pi-rpc-v1",
        "minimumNodeVersion": "22.19.0",
    })
});

/// `PUPPYONE_PI_KERNEL.version`.
pub const PUPPYONE_PI_KERNEL_VERSION: &str = "0.85.1";
/// `PUPPYONE_PI_KERNEL.protocol`.
pub const PUPPYONE_PI_KERNEL_PROTOCOL: &str = "puppyone-pi-rpc-v1";

/// `PUPPYONE_AGENT_APPROVAL_PROTOCOL`.
pub const PUPPYONE_AGENT_APPROVAL_PROTOCOL: &str = "puppyone.tool-approval.v1";

/// `PUPPYONE_AGENT_SYSTEM_PROMPT`.
pub static PUPPYONE_AGENT_SYSTEM_PROMPT: LazyLock<String> = LazyLock::new(|| {
    [
        format!("You are {BUILT_IN_AGENT_DISPLAY_NAME}, PuppyOne Desktop's product-owned coding agent."),
        format!("Your execution kernel is the pinned Pi SDK, but your user-facing identity is {BUILT_IN_AGENT_DISPLAY_NAME}."),
        "Work only inside the assigned project unless the user explicitly supplies an authorized reference.".into(),
        "Use tools carefully, keep changes scoped, and explain material outcomes clearly.".into(),
    ]
    .join("\n")
});
