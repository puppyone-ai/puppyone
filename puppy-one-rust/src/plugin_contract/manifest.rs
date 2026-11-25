//! Plugin manifest v2 schema and strict validation, porting the v1 security
//! invariants (`deny_unknown_fields`, canonical IDs/versions, normalized
//! relative paths, local-only source rules, no undeclared network, no reserved
//! core viewer IDs) and adding v2 fields (multi-handler contributions,
//! platforms, file checksums, licenses, and per-plugin size limits).

use super::{
    handler::{
        ComputeIsolation, ContentSandbox, Distribution, HandlerCapability, HandlerDefinition,
        HandlerId, HandlerKind, HandlerSource, Handles, LoadingPolicy, ReadinessSignal,
        RecoveryPolicy, ResourcePolicy, RuntimeKind, SourceScope, SurfaceFamily, SurfaceIsolation,
        SurfacePreparation, SurfaceTrait, is_kebab_token,
    },
    host_api::is_host_api_supported,
    open_plan::UnavailableReason,
    permissions::{DocumentPermission, Permissions, RelatedFilesPermission},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fmt};

/// Schema version for plugin manifest v2.
pub const MANIFEST_SCHEMA_VERSION: u32 = 2;

/// Official publisher identifier.
pub const OFFICIAL_PUBLISHER: &str = "puppyone";

/// Hard upper bounds so a manifest cannot declare unbounded archive/extract budgets.
pub const MAX_ALLOWED_ARCHIVE_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB
pub const MAX_ALLOWED_EXTRACTED_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB

/// All canonical preset viewer IDs and product `formatViewerIds` that no plugin
/// may claim as its plugin id or handler id.
pub const RESERVED_CORE_VIEWER_IDS: &[&str] = &[
    "app-preview",
    "audio-preview",
    "binary-placeholder",
    "context-map",
    "context-map-viewer",
    "csv-table",
    "database-preview",
    "document-placeholder",
    "excalidraw",
    "excalidraw-editor",
    "html-artifact",
    "image-preview",
    "json",
    "markdown",
    "markdown-editor",
    "monaco-code",
    "office-preview",
    "pdf-preview",
    "plain-text",
    "puppyflow",
    "puppyflow-editor",
    "text",
    "video-preview",
];

/// Supported target platforms for plugin packages.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    Any,
    MacosArm64,
    MacosX64,
    WindowsX64,
    LinuxX64,
    LinuxArm64,
}

impl Platform {
    pub fn supports(platforms: &[Self], target: Self) -> bool {
        platforms.contains(&Self::Any) || platforms.contains(&target)
    }
}

/// Per-plugin archive and extracted byte limits (§4.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageLimits {
    pub max_archive_bytes: u64,
    pub max_extracted_bytes: u64,
}

/// One verified file inside a plugin archive.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

/// License notice bundled with a plugin (e.g. MIT, MPL-2.0).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LicenseEntry {
    pub spdx: String,
    pub path: String,
}

/// One handler contribution declared inside a plugin manifest v2.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginHandlerManifest {
    /// Local contribution ID (combined with plugin ID as `plugin:<plugin>/<id>`).
    pub id: String,
    pub label: String,
    pub handles: Handles,
    pub kind: HandlerKind,
    pub runtime: RuntimeKind,
    #[serde(default)]
    pub loading: LoadingPolicy,
    /// Relative entry file inside `files[]` (required for Web / Process / Wasm).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<String>,
    /// Allowed document origins; defaults to local-only (`[SourceScope::Local]`).
    #[serde(default = "default_local_sources")]
    pub sources: Vec<SourceScope>,
    #[serde(default)]
    pub permissions: Permissions,
    /// Converters only: target format ID (e.g. `"pdf"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default)]
    pub capability: HandlerCapability,
    #[serde(default)]
    pub source: HandlerSource,
    #[serde(default)]
    pub surface_isolation: SurfaceIsolation,
    #[serde(default)]
    pub compute_isolation: ComputeIsolation,
    #[serde(default)]
    pub content_sandbox: ContentSandbox,
    #[serde(default)]
    pub resource_policy: ResourcePolicy,
    #[serde(default)]
    pub recovery_policy: RecoveryPolicy,
    #[serde(default)]
    pub surface_preparation: SurfacePreparation,
    #[serde(default)]
    pub readiness_signal: ReadinessSignal,
    #[serde(default)]
    pub surface_family: SurfaceFamily,
    #[serde(default)]
    pub surface_traits: Vec<SurfaceTrait>,
}

fn default_local_sources() -> Vec<SourceScope> {
    vec![SourceScope::Local]
}

/// Plugin manifest v2 (§4.5).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub version: String,
    pub publisher: String,
    pub host_api: u32,
    pub min_app_version: String,
    pub platforms: Vec<Platform>,
    pub handlers: Vec<PluginHandlerManifest>,
    pub files: Vec<ManifestFile>,
    #[serde(default)]
    pub permissions: Permissions,
    pub licenses: Vec<LicenseEntry>,
    pub limits: PackageLimits,
}

/// Validation failure returned by [`PluginManifest::parse`] or [`PluginManifest::validate`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManifestError {
    pub code: String,
    pub detail: String,
}

impl ManifestError {
    pub fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for ManifestError {}

/// Canonical reverse-DNS plugin ID (`^[a-z][a-z0-9-]{0,62}(\.[a-z0-9][a-z0-9-]{0,62}){1,7}$`).
pub fn is_canonical_plugin_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    let valid_part = |part: &str, first_alpha: bool| {
        let mut chars = part.chars();
        match chars.next() {
            Some(c)
                if (if first_alpha {
                    c.is_ascii_lowercase()
                } else {
                    c.is_ascii_lowercase() || c.is_ascii_digit()
                }) => {}
            _ => return false,
        }
        part.len() <= 63 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    id.len() <= 255
        && (2..=8).contains(&parts.len())
        && valid_part(parts[0], true)
        && parts[1..].iter().all(|p| valid_part(p, false))
}

/// Canonical SemVer string (`semver.valid(v) === v`).
pub fn is_canonical_version(version: &str) -> bool {
    semver::Version::parse(version).is_ok_and(|parsed| parsed.to_string() == version)
}

/// Whether `id` collides with any built-in preset viewer or product viewer id.
pub fn is_reserved_core_viewer_id(id: &str) -> bool {
    RESERVED_CORE_VIEWER_IDS.contains(&id)
}

pub(crate) fn is_publisher(publisher: &str) -> bool {
    let mut chars = publisher.chars();
    publisher.len() >= 2
        && publisher.len() <= 128
        && chars
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c))
}

pub(crate) fn is_format_id(id: &str) -> bool {
    let mut chars = id.chars();
    id.len() <= 64
        && chars
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c))
}

pub(crate) fn is_extension(ext: &str) -> bool {
    ext.strip_prefix('.').is_some_and(|rest| {
        let mut chars = rest.chars();
        rest.len() <= 64
            && chars
                .next()
                .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._+-".contains(c))
    })
}

pub(crate) fn is_mime_type(mime: &str) -> bool {
    let token = |segment: &str| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "!#$&^_.+-".contains(c))
    };
    mime.split_once('/')
        .is_some_and(|(a, b)| token(a) && token(b))
}

pub(crate) fn is_display_label(text: &str, max_chars: usize) -> bool {
    !text.trim().is_empty()
        && text.chars().count() <= max_chars
        && !text.chars().any(char::is_control)
}

pub(crate) fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Normalizes a plugin-relative file path, rejecting empty paths, absolute
/// paths, Windows drive prefixes, traversal (`..` / `.`), empty segments, and
/// control characters.
pub fn normalize_relative_path(value: &str) -> Result<String, &'static str> {
    if value.trim().is_empty() || value.len() > 512 {
        return Err("empty-or-too-long");
    }
    let trimmed = value.trim().replace('\\', "/");
    let drive = trimmed.len() >= 2
        && trimmed.as_bytes()[0].is_ascii_alphabetic()
        && trimmed.as_bytes()[1] == b':';
    if trimmed.starts_with('/') || drive || trimmed.contains('\0') || trimmed.contains("//") {
        return Err("absolute-or-empty-segment");
    }
    let invalid_segment = |segment: &str| {
        segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.len() > 255
            || segment.chars().any(char::is_control)
    };
    if trimmed.split('/').any(invalid_segment) {
        return Err("traversal-or-control");
    }
    Ok(trimmed)
}

fn validate_handles(prefix: &str, handles: &Handles, errors: &mut Vec<ManifestError>) {
    if handles.is_empty() {
        errors.push(ManifestError::new(
            format!("{prefix}.handles-empty"),
            "handler must declare at least one formatId, extension, or mimeType",
        ));
        return;
    }
    let mut seen_formats = BTreeSet::new();
    for format_id in &handles.format_ids {
        if !is_format_id(format_id) || !seen_formats.insert(format_id.as_str()) {
            errors.push(ManifestError::new(
                format!("{prefix}.handles.formatIds-invalid"),
                format!("invalid or duplicate format id `{format_id}`"),
            ));
            break;
        }
    }
    let mut seen_exts = BTreeSet::new();
    for ext in &handles.extensions {
        if !is_extension(ext) || !seen_exts.insert(ext.as_str()) {
            errors.push(ManifestError::new(
                format!("{prefix}.handles.extensions-invalid"),
                format!("invalid or duplicate extension `{ext}`"),
            ));
            break;
        }
    }
    let mut seen_mimes = BTreeSet::new();
    for mime in &handles.mime_types {
        if !is_mime_type(mime) || !seen_mimes.insert(mime.as_str()) {
            errors.push(ManifestError::new(
                format!("{prefix}.handles.mimeTypes-invalid"),
                format!("invalid or duplicate MIME type `{mime}`"),
            ));
            break;
        }
    }
}

fn validate_permissions(prefix: &str, permissions: &Permissions, errors: &mut Vec<ManifestError>) {
    let mut seen_doc = BTreeSet::new();
    for perm in &permissions.current_document {
        if !seen_doc.insert(*perm) {
            errors.push(ManifestError::new(
                format!("{prefix}.currentDocument-duplicate"),
                "duplicate currentDocument permission",
            ));
            break;
        }
    }
    let mut seen_origins = BTreeSet::new();
    for origin in &permissions.network {
        if !Permissions::is_valid_network_origin(origin) || !seen_origins.insert(origin.as_str()) {
            errors.push(ManifestError::new(
                format!("{prefix}.network-invalid"),
                format!("invalid or duplicate network origin `{origin}`"),
            ));
            break;
        }
    }
}

impl PluginManifest {
    /// Parses a manifest v2 JSON document with `deny_unknown_fields` and runs
    /// full semantic validation.
    pub fn parse(json: &str) -> Result<Self, Vec<ManifestError>> {
        let manifest: Self = serde_json::from_str(json)
            .map_err(|err| vec![ManifestError::new("manifest-parse-error", err.to_string())])?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn is_official(&self) -> bool {
        self.publisher == OFFICIAL_PUBLISHER
    }

    pub fn total_file_bytes(&self) -> u64 {
        self.files
            .iter()
            .fold(0u64, |acc, file| acc.saturating_add(file.size))
    }

    /// Strict semantic validation of all manifest v2 invariants.
    pub fn validate(&self) -> Result<(), Vec<ManifestError>> {
        let mut errors = Vec::new();

        if self.schema_version != MANIFEST_SCHEMA_VERSION {
            errors.push(ManifestError::new(
                "schemaVersion-unsupported",
                format!(
                    "expected schemaVersion {MANIFEST_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        if !is_canonical_plugin_id(&self.id) {
            errors.push(ManifestError::new(
                "id-invalid",
                format!("plugin id `{}` must be canonical reverse-DNS", self.id),
            ));
        }
        if is_reserved_core_viewer_id(&self.id) {
            errors.push(ManifestError::new(
                "id-reserved-core",
                format!("plugin id `{}` is a reserved core viewer id", self.id),
            ));
        }
        if !is_canonical_version(&self.version) {
            errors.push(ManifestError::new(
                "version-invalid",
                format!("version `{}` must be canonical SemVer", self.version),
            ));
        }
        if !is_publisher(&self.publisher) {
            errors.push(ManifestError::new(
                "publisher-invalid",
                format!("publisher `{}` is not canonical", self.publisher),
            ));
        }
        if self.host_api == 0 {
            errors.push(ManifestError::new(
                "hostApi-invalid",
                "hostApi must be a positive integer",
            ));
        }
        if !is_canonical_version(&self.min_app_version) {
            errors.push(ManifestError::new(
                "minAppVersion-invalid",
                format!(
                    "minAppVersion `{}` must be canonical SemVer",
                    self.min_app_version
                ),
            ));
        }

        // Platforms: non-empty and unique.
        if self.platforms.is_empty() {
            errors.push(ManifestError::new(
                "platforms-empty",
                "manifest must declare at least one platform",
            ));
        } else {
            let unique: BTreeSet<_> = self.platforms.iter().copied().collect();
            if unique.len() != self.platforms.len() {
                errors.push(ManifestError::new(
                    "platforms-duplicate",
                    "platforms list contains duplicate entries",
                ));
            }
        }

        // Size limits.
        if self.limits.max_archive_bytes == 0
            || self.limits.max_archive_bytes > MAX_ALLOWED_ARCHIVE_BYTES
        {
            errors.push(ManifestError::new(
                "limits.maxArchiveBytes-invalid",
                "maxArchiveBytes must be > 0 and within ceiling",
            ));
        }
        if self.limits.max_extracted_bytes == 0
            || self.limits.max_extracted_bytes > MAX_ALLOWED_EXTRACTED_BYTES
            || self.limits.max_extracted_bytes < self.limits.max_archive_bytes
        {
            errors.push(ManifestError::new(
                "limits.maxExtractedBytes-invalid",
                "maxExtractedBytes must be >= maxArchiveBytes and within ceiling",
            ));
        }

        // Top-level permissions.
        validate_permissions("permissions", &self.permissions, &mut errors);

        // Files: normalized, unique, valid SHA-256, within extracted budget.
        let mut file_paths = BTreeSet::new();
        if self.files.is_empty() {
            errors.push(ManifestError::new(
                "files-empty",
                "manifest must list at least one verified package file",
            ));
        }
        let mut total_bytes: u64 = 0;
        for (index, file) in self.files.iter().enumerate() {
            let prefix = format!("files[{index}]");
            match normalize_relative_path(&file.path) {
                Ok(norm) if norm == file.path => {
                    if !file_paths.insert(norm) {
                        errors.push(ManifestError::new(
                            format!("{prefix}.path-duplicate"),
                            format!("duplicate file path `{}`", file.path),
                        ));
                    }
                }
                Ok(_) => errors.push(ManifestError::new(
                    format!("{prefix}.path-not-normalized"),
                    format!(
                        "file path `{}` must use normalized forward slashes",
                        file.path
                    ),
                )),
                Err(reason) => errors.push(ManifestError::new(
                    format!("{prefix}.path-{reason}"),
                    format!("invalid file path `{}`", file.path),
                )),
            }
            if !is_sha256_hex(&file.sha256) {
                errors.push(ManifestError::new(
                    format!("{prefix}.sha256-invalid"),
                    "sha256 must be 64 lowercase hex characters",
                ));
            }
            total_bytes = total_bytes.saturating_add(file.size);
        }
        if self.limits.max_extracted_bytes > 0 && total_bytes > self.limits.max_extracted_bytes {
            errors.push(ManifestError::new(
                "files-exceed-extracted-limit",
                format!(
                    "declared files total {total_bytes} bytes, exceeding limit {}",
                    self.limits.max_extracted_bytes
                ),
            ));
        }

        // Licenses: non-empty, valid SPDX label, valid file path included in `files[]`.
        if self.licenses.is_empty() {
            errors.push(ManifestError::new(
                "licenses-empty",
                "manifest must include at least one license entry",
            ));
        }
        for (index, license) in self.licenses.iter().enumerate() {
            let prefix = format!("licenses[{index}]");
            if !is_display_label(&license.spdx, 128) {
                errors.push(ManifestError::new(
                    format!("{prefix}.spdx-invalid"),
                    "license spdx identifier must be non-empty",
                ));
            }
            match normalize_relative_path(&license.path) {
                Ok(norm) if norm == license.path => {
                    if !file_paths.contains(&norm) {
                        errors.push(ManifestError::new(
                            format!("{prefix}.path-missing-from-files"),
                            format!("license path `{}` must appear in files[]", license.path),
                        ));
                    }
                }
                Ok(_) => errors.push(ManifestError::new(
                    format!("{prefix}.path-not-normalized"),
                    format!("license path `{}` must be normalized", license.path),
                )),
                Err(reason) => errors.push(ManifestError::new(
                    format!("{prefix}.path-{reason}"),
                    format!("invalid license path `{}`", license.path),
                )),
            }
        }

        // Handlers: non-empty, <= 64, unique, non-core IDs, valid semantics.
        if self.handlers.is_empty() || self.handlers.len() > 64 {
            errors.push(ManifestError::new(
                "handlers-invalid-count",
                "manifest must declare between 1 and 64 handlers",
            ));
        }
        let mut seen_handlers = BTreeSet::new();
        for (index, handler) in self.handlers.iter().enumerate() {
            let prefix = format!("handlers[{index}]");
            if !is_kebab_token(&handler.id, 64) {
                errors.push(ManifestError::new(
                    format!("{prefix}.id-invalid"),
                    format!("handler id `{}` must be lowercase kebab-case", handler.id),
                ));
            }
            if is_reserved_core_viewer_id(&handler.id) {
                errors.push(ManifestError::new(
                    format!("{prefix}.id-reserved-core"),
                    format!("handler id `{}` is a reserved core viewer id", handler.id),
                ));
            }
            if !seen_handlers.insert(handler.id.as_str()) {
                errors.push(ManifestError::new(
                    format!("{prefix}.id-duplicate"),
                    format!("duplicate handler id `{}`", handler.id),
                ));
            }
            if !is_display_label(&handler.label, 128) {
                errors.push(ManifestError::new(
                    format!("{prefix}.label-invalid"),
                    "handler label must be non-empty and control-free",
                ));
            }
            validate_handles(&prefix, &handler.handles, &mut errors);

            // Kind <-> output / capability / permissions consistency.
            match handler.kind {
                HandlerKind::Converter => match &handler.output {
                    Some(target) if is_format_id(target) => {}
                    _ => errors.push(ManifestError::new(
                        format!("{prefix}.output-required"),
                        "converter handlers must declare a valid output format id",
                    )),
                },
                _ => {
                    if handler.output.is_some() {
                        errors.push(ManifestError::new(
                            format!("{prefix}.output-forbidden"),
                            "only converter handlers may declare an output format",
                        ));
                    }
                }
            }
            if handler.kind == HandlerKind::Editor && handler.capability != HandlerCapability::Edit
            {
                errors.push(ManifestError::new(
                    format!("{prefix}.capability-mismatch"),
                    "editor handlers must declare capability `edit`",
                ));
            }
            if handler.kind == HandlerKind::Editor && !handler.permissions.allows_commit() {
                errors.push(ManifestError::new(
                    format!("{prefix}.permissions-commit-required"),
                    "editor handlers must declare currentDocument `commit` permission",
                ));
            }
            if handler.kind != HandlerKind::Editor && handler.permissions.allows_commit() {
                errors.push(ManifestError::new(
                    format!("{prefix}.permissions-commit-forbidden"),
                    "non-editor handlers may not declare `commit` permission",
                ));
            }

            // Sources: non-empty, unique, local-only when required.
            if handler.sources.is_empty() {
                errors.push(ManifestError::new(
                    format!("{prefix}.sources-empty"),
                    "handler sources must not be empty",
                ));
            } else {
                let unique_sources: BTreeSet<_> = handler.sources.iter().copied().collect();
                if unique_sources.len() != handler.sources.len() {
                    errors.push(ManifestError::new(
                        format!("{prefix}.sources-duplicate"),
                        "handler sources contains duplicates",
                    ));
                }
                let must_be_local = handler.source.requires_local_only()
                    || handler.runtime == RuntimeKind::Process
                    || handler.kind == HandlerKind::External;
                if must_be_local && handler.sources.as_slice() != [SourceScope::Local] {
                    errors.push(ManifestError::new(
                        format!("{prefix}.sources-must-be-local-only"),
                        "process, external, and local-resource handlers must restrict sources to [\"local\"]",
                    ));
                }
            }

            // Entry path validation.
            let needs_entry = matches!(
                handler.runtime,
                RuntimeKind::Web | RuntimeKind::Process | RuntimeKind::Wasm
            );
            match &handler.entry {
                Some(entry) => match normalize_relative_path(entry) {
                    Ok(norm) if norm == *entry => {
                        if !file_paths.contains(&norm) {
                            errors.push(ManifestError::new(
                                format!("{prefix}.entry-missing-from-files"),
                                format!("entry `{entry}` must appear in files[]"),
                            ));
                        }
                    }
                    Ok(_) => errors.push(ManifestError::new(
                        format!("{prefix}.entry-not-normalized"),
                        format!("entry `{entry}` must be normalized"),
                    )),
                    Err(reason) => errors.push(ManifestError::new(
                        format!("{prefix}.entry-{reason}"),
                        format!("invalid entry path `{entry}`"),
                    )),
                },
                None if needs_entry => errors.push(ManifestError::new(
                    format!("{prefix}.entry-required"),
                    "web, process, and wasm handlers require an entry path",
                )),
                None => {}
            }

            // Handler permissions must be valid and never exceed the plugin's declared envelope.
            validate_permissions(
                &format!("{prefix}.permissions"),
                &handler.permissions,
                &mut errors,
            );
            let undeclared = handler.permissions.undeclared_network(&self.permissions);
            if !undeclared.is_empty() {
                errors.push(ManifestError::new(
                    format!("{prefix}.permissions.network-undeclared"),
                    format!(
                        "handler requests network origins not declared at plugin level: {}",
                        undeclared.join(", ")
                    ),
                ));
            }
            if handler.permissions.related_files != RelatedFilesPermission::None
                && self.permissions.related_files == RelatedFilesPermission::None
            {
                errors.push(ManifestError::new(
                    format!("{prefix}.permissions.relatedFiles-undeclared"),
                    "handler requests relatedFiles access not declared at plugin level",
                ));
            }
            if handler.source != HandlerSource::None
                && handler.kind != HandlerKind::External
                && !handler
                    .permissions
                    .current_document
                    .iter()
                    .any(|p| matches!(p, DocumentPermission::Read | DocumentPermission::ReadRange))
            {
                errors.push(ManifestError::new(
                    format!("{prefix}.permissions.read-required"),
                    "handlers that read document data must declare `read` or `readRange` permission",
                ));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Checks whether this plugin can run on the given app version, host API,
    /// and target platform.
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

    /// Projects this plugin's handler contributions into unified
    /// [`HandlerDefinition`]s consumed by Layer ② (`editor::opening`).
    pub fn handler_definitions(&self) -> Vec<HandlerDefinition> {
        let size_bytes = self.total_file_bytes();
        self.handlers
            .iter()
            .map(|handler| HandlerDefinition {
                id: HandlerId::plugin(&self.id, &handler.id),
                label: handler.label.clone(),
                handles: handler.handles.clone(),
                kind: handler.kind,
                runtime: handler.runtime,
                loading: handler.loading,
                distribution: Distribution::OnDemand,
                host_api: self.host_api,
                size_bytes,
                permissions: handler.permissions.clone(),
                output: handler.output.clone(),
                sources: handler.sources.clone(),
                capability: handler.capability,
                source: handler.source,
                surface_isolation: handler.surface_isolation,
                compute_isolation: handler.compute_isolation,
                content_sandbox: handler.content_sandbox,
                resource_policy: handler.resource_policy,
                recovery_policy: handler.recovery_policy,
                surface_preparation: handler.surface_preparation,
                readiness_signal: handler.readiness_signal,
                surface_family: handler.surface_family,
                surface_traits: handler.surface_traits.clone(),
            })
            .collect()
    }
}
