//! External Viewer Packs: user-installed viewers for formats the product
//! does not render (`viewerPackTypes.ts`, `viewerCapability.ts`,
//! `viewerHostAdapters.ts`, `electron/main/viewer-packs`).
//!
//! The contract, as the product's:
//! - only placeholder-grade documents are eligible (a preset viewer always
//!   wins), only local files route, and equal candidates ask the user;
//! - a pack renders only through a host-provided surface
//!   (`ExtensionHost::surface`); without one the preset viewer opens;
//! - manifests are validated strictly (`manifest::validate`): local-only
//!   sources, no network, no related files, activation by extension only.
//!
//! The runtime that executes pack code (an isolated surface, the range-read
//! resource broker, the signed package store) is not part of the native
//! build: like the product's default package, external packs are off
//! (`enabled`), so no host is installed and routing never changes what opens.
//! Until that runtime lands, this layer is exercised by its tests only.
#![cfg_attr(not(test), allow(dead_code))]
pub mod manifest;
pub mod route;

use super::surface::{SurfaceRequest, ViewerSurface};
use gpui::{App, Window};
pub use route::{PackContribution, Route, Snapshot};

/// `PUPPYONE_ENABLE_EXTERNAL_VIEWER_PACKS`: development builds only; the
/// product's packaged capability (`externalViewerPacks`) is off.
pub const DEV_ENV: &str = "PUPPYONE_ENABLE_EXTERNAL_VIEWER_PACKS";

/// `resolveViewerPackFeatureProfile`.
pub fn enabled() -> bool {
    cfg!(debug_assertions) && std::env::var_os(DEV_ENV).is_some_and(|v| v == "1")
}

/// Opens an activated pack's surface for one document.
pub type ExternalSurfaceFactory =
    fn(&SurfaceRequest, &PackContribution, &mut Window, &mut App) -> Box<dyn ViewerSurface>;

/// `ViewerExtensionHostAdapter`: the one port through which external
/// viewers reach the document host.
pub struct ExtensionHost {
    pub snapshot: Snapshot,
    /// The host's renderer for an activated pack; `None` keeps every
    /// document on its preset viewer.
    pub surface: Option<ExternalSurfaceFactory>,
}
