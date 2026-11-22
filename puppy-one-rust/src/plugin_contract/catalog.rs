//! Signed official plugin catalog schema (`catalog.json`, §4.5).
//!
//! Signature verification lives in `platform::plugins::catalog` (Step 6);
//! this module defines and validates the pure data contract and version
//! selection rules.

use super::{
    handler::{HandlerKind, Handles, RuntimeKind, SourceScope, is_kebab_token},
    host_api::is_host_api_supported,
    manifest::{
        ManifestError, Platform, is_canonical_plugin_id, is_canonical_version, is_display_label,
        is_format_id, is_publisher, is_reserved_core_viewer_id, is_sha256_hex,
    },
    open_plan::UnavailableReason,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use url::Url;

/// Schema version for `catalog.json`.
pub const CATALOG_SCHEMA_VERSION: u32 = 1;

/// Lightweight handler descriptor published in the catalog so resolution can
/// advertise installable handlers without downloading archives first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogHandlerSummary {
    pub id: String,
    pub label: String,
    pub kind: HandlerKind,
    pub runtime: RuntimeKind,
    pub handles: Handles,
    #[serde(default = "default_local_sources")]
    pub sources: Vec<SourceScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

fn default_local_sources() -> Vec<SourceScope> {
    vec![SourceScope::Local]
}

/// One published version of an official plugin in the catalog.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogVersion {
    pub version: String,
    pub host_api: u32,
    pub min_app_version: String,
    pub platforms: Vec<Platform>,
    pub archive_url: String,
    pub archive_sha256: String,
    pub archive_size_bytes: u64,
    pub extracted_size_bytes: u64,
    pub handlers: Vec<CatalogHandlerSummary>,
}

impl CatalogVersion {
    pub fn check_compatibility(
        &self,
        app_version: &str,
        current_host_api: u32,
        platform: Platform,
    ) -> Result<(), UnavailableReason> {
        if !Platform::supports(&self.platforms, platform) {
            return Err(UnavailableReason::PlatformUnsupported);
        }
        if !is_host_api_supported(self.host_api, current_host_api) {
            return Err(UnavailableReason::HostApiIncompatible);
        }
        let Ok(current) = semver::Version::parse(app_version) else {
            return Err(UnavailableReason::AppVersionIncompatible);
        };
        let Ok(required) = semver::Version::parse(&self.min_app_version) else {
            return Err(UnavailableReason::AppVersionIncompatible);
        };
        if current < required {
            return Err(UnavailableReason::AppVersionIncompatible);
        }
        Ok(())
    }
}

/// All published versions of one plugin in the catalog.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogPlugin {
    pub id: String,
    pub publisher: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub versions: Vec<CatalogVersion>,
}

impl CatalogPlugin {
    /// Selects the highest SemVer version compatible with `app_version`,
    /// `current_host_api`, and `platform`.
    pub fn newest_compatible(
        &self,
        app_version: &str,
        current_host_api: u32,
        platform: Platform,
    ) -> Option<&CatalogVersion> {
        self.versions
            .iter()
            .filter(|entry| {
                entry
                    .check_compatibility(app_version, current_host_api, platform)
                    .is_ok()
            })
            .filter_map(|entry| {
                semver::Version::parse(&entry.version)
                    .ok()
                    .map(|ver| (ver, entry))
            })
            .max_by(|(a, _), (b, _)| a.cmp(b))
            .map(|(_, entry)| entry)
    }
}

/// Root document of the signed official plugin catalog (`catalog.json`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub generated_at: String,
    #[serde(default)]
    pub plugins: Vec<CatalogPlugin>,
}

fn is_valid_archive_url(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    (url.scheme() == "https" || (url.scheme() == "http" && loopback))
        && url.username().is_empty()
        && url.password().is_none()
}

impl Catalog {
    pub fn empty() -> Self {
        Self {
            schema_version: CATALOG_SCHEMA_VERSION,
            generated_at: String::new(),
            plugins: Vec::new(),
        }
    }

    /// Parses and validates a catalog JSON payload.
    pub fn parse(json: &str) -> Result<Self, Vec<ManifestError>> {
        let catalog: Self = serde_json::from_str(json)
            .map_err(|err| vec![ManifestError::new("catalog-parse-error", err.to_string())])?;
        catalog.validate()?;
        Ok(catalog)
    }

    pub fn validate(&self) -> Result<(), Vec<ManifestError>> {
        let mut errors = Vec::new();
        if self.schema_version != CATALOG_SCHEMA_VERSION {
            errors.push(ManifestError::new(
                "schemaVersion-unsupported",
                format!(
                    "expected catalog schemaVersion {CATALOG_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        if self.generated_at.trim().is_empty() {
            errors.push(ManifestError::new(
                "generatedAt-empty",
                "catalog generatedAt timestamp is required",
            ));
        }

        let mut seen_plugins = BTreeSet::new();
        for (p_idx, plugin) in self.plugins.iter().enumerate() {
            let p_prefix = format!("plugins[{p_idx}]");
            if !is_canonical_plugin_id(&plugin.id) || is_reserved_core_viewer_id(&plugin.id) {
                errors.push(ManifestError::new(
                    format!("{p_prefix}.id-invalid"),
                    format!("invalid plugin id `{}`", plugin.id),
                ));
            }
            if !seen_plugins.insert(plugin.id.as_str()) {
                errors.push(ManifestError::new(
                    format!("{p_prefix}.id-duplicate"),
                    format!("duplicate plugin id `{}`", plugin.id),
                ));
            }
            if !is_publisher(&plugin.publisher) {
                errors.push(ManifestError::new(
                    format!("{p_prefix}.publisher-invalid"),
                    format!("invalid publisher `{}`", plugin.publisher),
                ));
            }
            if !is_display_label(&plugin.name, 128) {
                errors.push(ManifestError::new(
                    format!("{p_prefix}.name-invalid"),
                    "plugin display name must be non-empty",
                ));
            }
            if plugin.versions.is_empty() {
                errors.push(ManifestError::new(
                    format!("{p_prefix}.versions-empty"),
                    "catalog plugin must list at least one version",
                ));
            }

            let mut seen_versions = BTreeSet::new();
            for (v_idx, ver) in plugin.versions.iter().enumerate() {
                let v_prefix = format!("{p_prefix}.versions[{v_idx}]");
                if !is_canonical_version(&ver.version) {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.version-invalid"),
                        format!("invalid SemVer `{}`", ver.version),
                    ));
                }
                if !seen_versions.insert(ver.version.as_str()) {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.version-duplicate"),
                        format!("duplicate version `{}`", ver.version),
                    ));
                }
                if ver.host_api == 0 {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.hostApi-invalid"),
                        "hostApi must be >= 1",
                    ));
                }
                if !is_canonical_version(&ver.min_app_version) {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.minAppVersion-invalid"),
                        format!("invalid minAppVersion `{}`", ver.min_app_version),
                    ));
                }
                if ver.platforms.is_empty() {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.platforms-empty"),
                        "version platforms must not be empty",
                    ));
                }
                if !is_valid_archive_url(&ver.archive_url) {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.archiveUrl-invalid"),
                        format!("archiveUrl `{}` must be HTTPS", ver.archive_url),
                    ));
                }
                if !is_sha256_hex(&ver.archive_sha256) {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.archiveSha256-invalid"),
                        "archiveSha256 must be 64 lowercase hex characters",
                    ));
                }
                if ver.archive_size_bytes == 0 || ver.extracted_size_bytes < ver.archive_size_bytes
                {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.sizes-invalid"),
                        "archiveSizeBytes must be > 0 and <= extractedSizeBytes",
                    ));
                }
                if ver.handlers.is_empty() {
                    errors.push(ManifestError::new(
                        format!("{v_prefix}.handlers-empty"),
                        "version must list at least one handler",
                    ));
                }
                let mut seen_handlers = BTreeSet::new();
                for (h_idx, handler) in ver.handlers.iter().enumerate() {
                    let h_prefix = format!("{v_prefix}.handlers[{h_idx}]");
                    if !is_kebab_token(&handler.id, 64) || is_reserved_core_viewer_id(&handler.id) {
                        errors.push(ManifestError::new(
                            format!("{h_prefix}.id-invalid"),
                            format!("invalid or reserved handler id `{}`", handler.id),
                        ));
                    }
                    if !seen_handlers.insert(handler.id.as_str()) {
                        errors.push(ManifestError::new(
                            format!("{h_prefix}.id-duplicate"),
                            format!("duplicate handler id `{}`", handler.id),
                        ));
                    }
                    if !is_display_label(&handler.label, 128) {
                        errors.push(ManifestError::new(
                            format!("{h_prefix}.label-invalid"),
                            "handler label must be non-empty",
                        ));
                    }
                    if handler.handles.is_empty() {
                        errors.push(ManifestError::new(
                            format!("{h_prefix}.handles-empty"),
                            "handler handles must not be empty",
                        ));
                    }
                    if handler.kind == HandlerKind::Converter
                        && !handler.output.as_deref().is_some_and(is_format_id)
                    {
                        errors.push(ManifestError::new(
                            format!("{h_prefix}.output-required"),
                            "converter handler must declare a valid output format id",
                        ));
                    }
                }
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}
