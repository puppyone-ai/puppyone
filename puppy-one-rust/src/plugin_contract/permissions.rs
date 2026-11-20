//! Permission declarations for official plugins.
//!
//! Defaults to empty (no document write, no related files, no network).
//! Plugins never write to disk directly; edit-capable plugins commit changes
//! exclusively through `DocumentPort`.

use serde::{Deserialize, Serialize};
use url::Url;

/// Per-document operations a plugin may request through `DocumentPort`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentPermission {
    Metadata,
    Read,
    ReadRange,
    Commit,
}

/// Access to files neighbouring the open document.
#[derive(
    Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum RelatedFilesPermission {
    #[default]
    None,
    SameDirectory,
}

/// Permission envelope for a plugin manifest or individual handler.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Permissions {
    #[serde(default)]
    pub current_document: Vec<DocumentPermission>,
    #[serde(default)]
    pub related_files: RelatedFilesPermission,
    /// Explicit `https://<host>[:port]` origins. Empty means zero network.
    #[serde(default)]
    pub network: Vec<String>,
}

impl Permissions {
    pub fn has_network(&self) -> bool {
        !self.network.is_empty()
    }

    pub fn allows_commit(&self) -> bool {
        self.current_document.contains(&DocumentPermission::Commit)
    }

    /// Validates that `origin` is a strict, credential-free `https://` origin
    /// without wildcards, path, query, or fragment.
    pub fn is_valid_network_origin(origin: &str) -> bool {
        if origin.is_empty() || origin.len() > 256 || origin.contains('*') {
            return false;
        }
        let Ok(parsed) = Url::parse(origin) else {
            return false;
        };
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return false;
        }
        // Only bare origins (`https://example.com` or `https://example.com:8443`).
        let canonical = parsed.origin().ascii_serialization();
        origin == canonical
    }

    /// Returns any network origins requested in `self` that are NOT declared
    /// in the plugin's top-level `declared` permissions.
    pub fn undeclared_network<'a>(&'a self, declared: &Permissions) -> Vec<&'a str> {
        self.network
            .iter()
            .map(String::as_str)
            .filter(|origin| !declared.network.iter().any(|allowed| allowed == origin))
            .collect()
    }
}
