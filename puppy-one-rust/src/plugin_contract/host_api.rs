//! Host API v1 wire messages exchanged between the plugin runtime host and
//! sandboxed plugin surfaces (§4.4).

use serde::{Deserialize, Serialize};

/// Current host API version supported by this desktop build.
pub const HOST_API_VERSION: u32 = 1;

/// Versioning rule (§4.4): the host accepts the current integer API version
/// and the immediately preceding version (when `current > 1`).
pub const fn is_host_api_supported(requested: u32, current: u32) -> bool {
    requested >= 1 && (requested == current || (current > 1 && requested == current - 1))
}

/// Direction for an in-surface find query.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FindDirection {
    Next,
    Previous,
}

/// Messages sent from the Rust host to a plugin surface (host API v1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum HostToPluginMessage {
    #[serde(rename_all = "camelCase")]
    Open {
        api_version: u32,
        document_id: String,
        name: String,
        format_id: String,
        theme: String,
        locale: String,
        read_only: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        revision: u64,
    },
    #[serde(rename_all = "camelCase")]
    ExternalChange {
        document_id: String,
        content: String,
        revision: u64,
    },
    #[serde(rename_all = "camelCase")]
    ThemeChanged {
        theme: String,
    },
    #[serde(rename_all = "camelCase")]
    LocaleChanged {
        locale: String,
    },
    #[serde(rename_all = "camelCase")]
    ReadOnlyChanged {
        read_only: bool,
    },
    #[serde(rename_all = "camelCase")]
    Find {
        query: String,
        case_sensitive: bool,
        direction: FindDirection,
    },
    ClearFind,
    Undo,
    Redo,
}

/// Messages sent from a plugin surface back to the Rust host (host API v1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum PluginToHostMessage {
    #[serde(rename_all = "camelCase")]
    Ready { api_version: u32 },
    #[serde(rename_all = "camelCase")]
    Dirty { document_id: String, dirty: bool },
    #[serde(rename_all = "camelCase")]
    Commit {
        document_id: String,
        base_revision: u64,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    OpenLink { target: String },
    #[serde(rename_all = "camelCase")]
    FindResult { current: usize, total: usize },
    #[serde(rename_all = "camelCase")]
    Error {
        code: String,
        message: String,
        recoverable: bool,
    },
}
