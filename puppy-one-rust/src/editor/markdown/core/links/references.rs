//! Workspace and reference-link resolution helpers
//! (product `core/links/markdownReferenceLinks.ts`).
use crate::editor::navigation::{ReferenceContext, Resolution};

/// Resolve a wiki target or relative Markdown href against the workspace
/// link-graph context.
pub fn resolve_reference(context: &ReferenceContext, href: &str, wiki: bool) -> Option<Resolution> {
    if wiki {
        Some(context.resolve(href))
    } else {
        context.markdown(href)
    }
}
