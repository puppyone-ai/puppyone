//! Handler identities and unified handler definitions shared by built-in
//! viewers, official plugins, conversion chains, and external apps.

use super::permissions::Permissions;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use std::{fmt, str::FromStr};

/// Reserved external app id for the operating system's default application
/// (`app:default`).
pub const SYSTEM_DEFAULT_APP_ID: &str = "default";

/// Stable identifier for any file handler.
///
/// Serializes as a canonical string because preferences and workbench restore
/// records persist it:
/// - built-in viewer: `builtin:office-preview`
/// - plugin contribution: `plugin:puppyone.libreoffice/pptx-preview`
/// - external app: `app:com.microsoft.Powerpoint` or `app:default`
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum HandlerId {
    Builtin(String),
    Plugin {
        plugin_id: String,
        handler_id: String,
    },
    App(String),
}

/// Errors returned when parsing a [`HandlerId`] string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HandlerIdError {
    UnknownPrefix,
    InvalidBuiltinId,
    InvalidPluginFormat,
    InvalidPluginId,
    InvalidContributionId,
    InvalidAppId,
}

impl fmt::Display for HandlerIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::UnknownPrefix => "handler id must start with builtin:, plugin:, or app:",
            Self::InvalidBuiltinId => "invalid built-in handler id",
            Self::InvalidPluginFormat => "plugin handler id must be plugin:<plugin-id>/<handler>",
            Self::InvalidPluginId => "invalid plugin id in handler id",
            Self::InvalidContributionId => "invalid plugin contribution id in handler id",
            Self::InvalidAppId => "invalid external app id in handler id",
        };
        f.write_str(message)
    }
}

impl std::error::Error for HandlerIdError {}

impl HandlerId {
    pub fn builtin(id: impl Into<String>) -> Self {
        Self::Builtin(id.into())
    }

    pub fn plugin(plugin_id: impl Into<String>, handler_id: impl Into<String>) -> Self {
        Self::Plugin {
            plugin_id: plugin_id.into(),
            handler_id: handler_id.into(),
        }
    }

    pub fn app(app_id: impl Into<String>) -> Self {
        Self::App(app_id.into())
    }

    /// Canonical handler id for opening a local file in the OS default app.
    pub fn system_default_app() -> Self {
        Self::App(SYSTEM_DEFAULT_APP_ID.to_owned())
    }

    pub fn builtin_id(&self) -> Option<&str> {
        match self {
            Self::Builtin(id) => Some(id.as_str()),
            _ => None,
        }
    }

    pub fn plugin_parts(&self) -> Option<(&str, &str)> {
        match self {
            Self::Plugin {
                plugin_id,
                handler_id,
            } => Some((plugin_id.as_str(), handler_id.as_str())),
            _ => None,
        }
    }

    pub fn app_id(&self) -> Option<&str> {
        match self {
            Self::App(id) => Some(id.as_str()),
            _ => None,
        }
    }

    pub fn is_system_default_app(&self) -> bool {
        matches!(self, Self::App(id) if id == SYSTEM_DEFAULT_APP_ID)
    }
}

pub(crate) fn is_kebab_token(value: &str, max_len: usize) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && value.len() <= max_len
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub(crate) fn is_app_id(value: &str) -> bool {
    let mut chars = value.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && value.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

impl fmt::Display for HandlerId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Builtin(id) => write!(f, "builtin:{id}"),
            Self::Plugin {
                plugin_id,
                handler_id,
            } => write!(f, "plugin:{plugin_id}/{handler_id}"),
            Self::App(app_id) => write!(f, "app:{app_id}"),
        }
    }
}

impl FromStr for HandlerId {
    type Err = HandlerIdError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        if let Some(id) = raw.strip_prefix("builtin:") {
            if !is_kebab_token(id, 64) {
                return Err(HandlerIdError::InvalidBuiltinId);
            }
            return Ok(Self::Builtin(id.to_owned()));
        }
        if let Some(rest) = raw.strip_prefix("plugin:") {
            let (plugin_id, handler_id) = rest
                .split_once('/')
                .ok_or(HandlerIdError::InvalidPluginFormat)?;
            if handler_id.contains('/') {
                return Err(HandlerIdError::InvalidPluginFormat);
            }
            if !super::manifest::is_canonical_plugin_id(plugin_id) {
                return Err(HandlerIdError::InvalidPluginId);
            }
            if !is_kebab_token(handler_id, 64) {
                return Err(HandlerIdError::InvalidContributionId);
            }
            return Ok(Self::Plugin {
                plugin_id: plugin_id.to_owned(),
                handler_id: handler_id.to_owned(),
            });
        }
        if let Some(app_id) = raw.strip_prefix("app:") {
            if !is_app_id(app_id) {
                return Err(HandlerIdError::InvalidAppId);
            }
            return Ok(Self::App(app_id.to_owned()));
        }
        Err(HandlerIdError::UnknownPrefix)
    }
}

impl Serialize for HandlerId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for HandlerId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::from_str(&raw).map_err(de::Error::custom)
    }
}

/// What role a handler fulfills for matching files.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HandlerKind {
    /// Read-only in-pane viewer.
    Viewer,
    /// Editable surface committing changes through `DocumentPort` / documents.
    Editor,
    /// Converts format A -> B and renders B with a built-in viewer.
    Converter,
    /// Launches an external OS application.
    External,
}

/// Execution substrate for a handler.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeKind {
    Native,
    Web,
    Process,
    Wasm,
}

/// Eager vs lazy initialization (the preset manifest's `runtime` key, renamed
/// here to avoid colliding with [`RuntimeKind`]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoadingPolicy {
    #[default]
    Eager,
    Lazy,
}

/// Whether a handler ships inside the base app or installs on demand.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Distribution {
    Bundled,
    OnDemand,
}

/// Which document origins a handler may open.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceScope {
    Local,
    Cloud,
    RemoteDevice,
}

/// Matching criteria for a handler: format IDs, extensions, and MIME types.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Handles {
    #[serde(default)]
    pub format_ids: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub mime_types: Vec<String>,
}

impl Handles {
    pub fn is_empty(&self) -> bool {
        self.format_ids.is_empty() && self.extensions.is_empty() && self.mime_types.is_empty()
    }
}

/// Capability tier corresponding to the preset viewer manifest.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HandlerCapability {
    Edit,
    #[default]
    Preview,
    Placeholder,
}

/// Input contract between the document host and the handler.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HandlerSource {
    Content,
    Resource,
    ResourceSession,
    ContentAndResource,
    RangeResource,
    #[default]
    None,
}

impl HandlerSource {
    pub const fn reads_content(self) -> bool {
        matches!(self, Self::Content | Self::ContentAndResource)
    }

    /// Sources that hand a local file/session directly to the handler must
    /// remain local-only so Cloud documents never manufacture local paths.
    pub const fn requires_local_only(self) -> bool {
        matches!(
            self,
            Self::Resource | Self::ResourceSession | Self::ContentAndResource
        )
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceIsolation {
    #[default]
    Inline,
    IsolatedWebcontents,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComputeIsolation {
    #[default]
    MainThread,
    Worker,
    BrowserEngine,
    NativeProcess,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContentSandbox {
    #[default]
    None,
    SandboxedFrame,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MemoryClass {
    #[default]
    Small,
    Medium,
    Large,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourcePolicy {
    pub memory_class: MemoryClass,
    pub max_source_bytes: u64,
    pub max_canvas_pixels: u64,
    pub max_active_canvases: u64,
    pub max_workers: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryPolicy {
    pub max_automatic_retries: u32,
    pub supports_safe_mode: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SurfacePreparation {
    #[default]
    HiddenSafe,
    RequiresVisible,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessSignal {
    #[default]
    DomStable,
    DecodedResource,
    FramePaint,
    FirstRenderedFrame,
    MediaMetadata,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceFamily {
    Document,
    Code,
    Grid,
    Canvas,
    Media,
    Embedded,
    #[default]
    Fallback,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceTrait {
    RichText,
    Monospace,
    Tabular,
    Scrollable,
    Zoomable,
    Paginated,
    Sandboxed,
}

/// Unified handler metadata shared by built-in viewers (derived from
/// `preset-viewers.json`), plugin contributions (derived from manifest v2),
/// and external app handlers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandlerDefinition {
    pub id: HandlerId,
    pub label: String,
    pub handles: Handles,
    pub kind: HandlerKind,
    pub runtime: RuntimeKind,
    pub loading: LoadingPolicy,
    pub distribution: Distribution,
    pub host_api: u32,
    pub size_bytes: u64,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    pub sources: Vec<SourceScope>,
    // Existing preset viewer contract fields retained verbatim:
    pub capability: HandlerCapability,
    pub source: HandlerSource,
    pub surface_isolation: SurfaceIsolation,
    pub compute_isolation: ComputeIsolation,
    pub content_sandbox: ContentSandbox,
    pub resource_policy: ResourcePolicy,
    pub recovery_policy: RecoveryPolicy,
    pub surface_preparation: SurfacePreparation,
    pub readiness_signal: ReadinessSignal,
    pub surface_family: SurfaceFamily,
    #[serde(default)]
    pub surface_traits: Vec<SurfaceTrait>,
}
