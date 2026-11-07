//! `types.ts`: the local Agent installations the inventory found
//! (`AgentLocalConnectionsSnapshot`).
use serde::{Deserialize, Serialize};

/// `AgentLocalConnection["capabilities"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalConnectionProbes {
    #[serde(deserialize_with = "super::lenient::flag")]
    pub version_probe: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub authentication_probe: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub protocol_probe: bool,
}

/// `AgentLocalConnection["actions"][number]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LocalConnectionAction {
    /// `"refresh"` or `"learn-more"`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub label: String,
}

/// `AgentLocalConnection`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalConnection {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub display_name: String,
    /// `AgentLocalInstallationState`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub installation: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub version: Option<String>,
    /// `AgentLocalAuthenticationState`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub authentication: String,
    /// `AgentLocalIntegrationState`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub integration: String,
    pub capabilities: LocalConnectionProbes,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub selectable: bool,
    #[serde(deserialize_with = "super::lenient::text")]
    pub status_message: String,
    #[serde(deserialize_with = "super::lenient::list")]
    pub actions: Vec<LocalConnectionAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub source: Option<String>,
}

/// `AgentLocalConnectionsSnapshot`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalConnectionsSnapshot {
    #[serde(deserialize_with = "super::lenient::list")]
    pub connections: Vec<LocalConnection>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub scanned_at: String,
    #[serde(deserialize_with = "super::lenient::list")]
    pub warnings: Vec<String>,
}
