//! Markdown link scanning, wiki links, workspace reference resolution,
//! pane-local heading targets, fragment normalization, and link interaction
//! policy (product `core/links/` + `core/state/markdownLinkInteraction.ts`).
pub mod fragments;
pub mod headings;
pub mod interaction;
pub mod model;
pub mod references;
pub mod wiki;

pub use crate::editor::markdown::shared::token_scan::is_escaped;
pub use fragments::fragment;
pub use headings::Headings;
pub use model::{ImageToken, LinkToken, find_images, find_links};
pub use wiki::{WikiLinkToken, find_wiki_links};
