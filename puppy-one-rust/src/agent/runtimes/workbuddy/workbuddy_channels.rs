//! `runtimes/workbuddy/workbuddy-channels.mjs`.
use crate::agent::agent_error::AgentError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkBuddyChannel {
    pub id: &'static str,
    pub installation_id: &'static str,
    pub display_name: &'static str,
    pub channel: &'static str,
    pub route: &'static str,
    pub authentication_method_id: &'static str,
    pub config_directory_name: &'static str,
    pub config_directory_environment_variable: &'static str,
}

pub const WORKBUDDY_CHINA_CHANNEL: WorkBuddyChannel = WorkBuddyChannel {
    id: "workbuddy-china",
    installation_id: "workbuddy-china",
    display_name: "WorkBuddy (China)",
    channel: "china-app",
    route: "internal",
    authentication_method_id: "internal",
    config_directory_name: ".workbuddy",
    config_directory_environment_variable: "WORKBUDDY_CHINA_CONFIG_DIR",
};

pub const WORKBUDDY_INTERNATIONAL_CHANNEL: WorkBuddyChannel = WorkBuddyChannel {
    id: "workbuddy-international",
    installation_id: "workbuddy-international",
    display_name: "WorkBuddy (International)",
    channel: "international-app",
    route: "public",
    authentication_method_id: "external",
    config_directory_name: ".workbuddy-ai",
    config_directory_environment_variable: "WORKBUDDY_INTERNATIONAL_CONFIG_DIR",
};

pub const WORKBUDDY_CHANNELS: [WorkBuddyChannel; 2] =
    [WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL];

/// `requireWorkBuddyChannel(value)`.
pub fn require_work_buddy_channel(runtime_id: &str) -> Result<WorkBuddyChannel, AgentError> {
    WORKBUDDY_CHANNELS
        .iter()
        .find(|channel| channel.id == runtime_id)
        .copied()
        .ok_or_else(|| {
            AgentError::new(format!(
                "Unknown WorkBuddy product channel: {}",
                if runtime_id.is_empty() {
                    "missing"
                } else {
                    runtime_id
                }
            ))
            .with_name("TypeError")
        })
}
