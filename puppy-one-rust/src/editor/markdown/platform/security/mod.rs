//! Document and workspace capability identity helpers
//! (`platform/security/`, TS `capabilityPrincipal.ts`).
//!
//! Rust passes resource capabilities directly via [`DocumentAssets`]
//! (`workspace`, `document`, `read`) rather than DOM principal strings; this
//! module provides typed identity helpers over that capability.
use super::policy::asset::local_workspace_root;
use crate::editor::registry::DocumentAssets;
use std::{borrow::Cow, path::PathBuf};

/// Capability handle granting read access to a document's scoped workspace assets.
pub type DocumentCapability = DocumentAssets;

/// Stable workspace/document scope identity used for broker cache partitioning.
pub fn scope_identity(assets: Option<&DocumentCapability>) -> Cow<'_, str> {
    match assets {
        Some(a) => a.workspace_identity(),
        None => Cow::Borrowed("workspace:anonymous"),
    }
}

/// Returns the local workspace root directory when `assets` is backed by a
/// local folder capability, or `None` for hosted/memory providers.
pub fn local_root(assets: Option<&DocumentCapability>) -> Option<PathBuf> {
    assets.and_then(|a| local_workspace_root(&a.workspace))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::Arc;

    #[test]
    fn scope_identity_derives_anonymous_or_document_scoped_keys() {
        assert_eq!(scope_identity(None), "workspace:anonymous");
        let doc_only = DocumentCapability {
            workspace: String::new(),
            document: PathBuf::from("notes/guide.md"),
            read: Arc::new(|_| None),
        };
        assert_eq!(scope_identity(Some(&doc_only)), "doc:notes/guide.md");
        assert!(local_root(Some(&doc_only)).is_none());
    }
}
