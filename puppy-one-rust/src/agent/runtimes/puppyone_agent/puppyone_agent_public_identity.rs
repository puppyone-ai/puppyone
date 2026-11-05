//! `runtimes/puppyone-agent/puppyone-agent-public-identity.mjs`: the
//! user-facing identity of PuppyOne's bundled Agent runtime. Machine
//! identifiers intentionally remain `puppyone-agent` so persisted sessions,
//! profiles, IPC payloads and approval protocols stay compatible.

pub const BUILT_IN_AGENT_DISPLAY_NAME: &str = "Built-in Agent";
pub const BUILT_IN_AGENT_ICON_KEY: &str = "built-in-agent";
