//! Pure contracts for file opening and official plugins: handler identities,
//! shared handler definitions, open plans, manifest v2 validation, signed
//! catalog schema, permissions, and host API v1 wire messages.
//!
//! This module has zero UI, OS, or runtime dependencies.

pub mod catalog;
pub mod handler;
pub mod host_api;
pub mod manifest;
pub mod open_plan;
pub mod permissions;

#[cfg(test)]
mod tests;

pub use catalog::{Catalog, CatalogHandlerSummary, CatalogPlugin, CatalogVersion};
pub use handler::{
    ComputeIsolation, ContentSandbox, Distribution, HandlerCapability, HandlerDefinition,
    HandlerId, HandlerIdError, HandlerKind, HandlerSource, Handles, LoadingPolicy, MemoryClass,
    ReadinessSignal, RecoveryPolicy, ResourcePolicy, RuntimeKind, SourceScope, SurfaceFamily,
    SurfaceIsolation, SurfacePreparation, SurfaceTrait,
};
pub use host_api::{
    FindDirection, HOST_API_VERSION, HostToPluginMessage, PluginToHostMessage,
    is_host_api_supported,
};
pub use manifest::{
    LicenseEntry, MANIFEST_SCHEMA_VERSION, ManifestError, ManifestFile, PackageLimits, Platform,
    PluginHandlerManifest, PluginManifest, RESERVED_CORE_VIEWER_IDS, is_canonical_plugin_id,
    is_canonical_version, is_reserved_core_viewer_id, normalize_relative_path,
};
pub use open_plan::{
    Alternative, CandidateStatus, ConversionChain, OpenPlan, OpenReason, SkippedCandidate,
    UnavailableReason,
};
pub use permissions::{DocumentPermission, Permissions, RelatedFilesPermission};
