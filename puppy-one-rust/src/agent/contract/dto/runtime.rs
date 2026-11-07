//! `types.ts`: what a runtime is, whether it is ready, and what it offers
//! (`AgentRuntimeInspection`, `AgentCapabilities`, models, modes and
//! commands).
use serde::{Deserialize, Serialize};

/// `AgentRuntimeDescriptor`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuntimeDescriptor {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub icon_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub priority: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub compatibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub distribution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ownership: Option<RuntimeOwnership>,
}

/// `AgentRuntimeDescriptor["ownership"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuntimeOwnership {
    #[serde(deserialize_with = "super::lenient::text")]
    pub harness: String,
    #[serde(deserialize_with = "super::lenient::list")]
    pub credentials: Vec<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub models: String,
    #[serde(deserialize_with = "super::lenient::list")]
    pub billing: Vec<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub session: String,
}

/// `AgentRuntimeReadiness`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuntimeReadiness {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub runtime_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub provider: String,
    /// `AgentReadinessStatus`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub status: String,
    /// `AgentReadinessCode`.
    #[serde(deserialize_with = "super::lenient::text")]
    pub code: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub version: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub minimum_version: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub compatibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub diagnostic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub selectable: Option<bool>,
}

impl RuntimeReadiness {
    /// `readiness.status === "ready"`.
    pub fn is_ready(&self) -> bool {
        self.status == "ready"
    }
}

/// `AgentRuntimeCatalogEntry`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RuntimeCatalogEntry {
    pub descriptor: RuntimeDescriptor,
    pub readiness: RuntimeReadiness,
}

/// `AgentAttachmentInputCapability`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AttachmentInputCapability {
    #[serde(deserialize_with = "super::lenient::flag")]
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_types: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub max_bytes: Option<f64>,
}

/// `AgentReferenceInputCapabilities["workspace"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceInputCapability {
    #[serde(deserialize_with = "super::lenient::flag")]
    pub files: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub directories: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub cross_roots: Option<bool>,
}

/// `Record<AgentAttachmentKind, AgentAttachmentInputCapability>`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AttachmentInputCapabilities {
    pub image: AttachmentInputCapability,
    pub text: AttachmentInputCapability,
    pub audio: AttachmentInputCapability,
    pub video: AttachmentInputCapability,
    pub binary: AttachmentInputCapability,
}

impl AttachmentInputCapabilities {
    /// The capability of attachment kind `kind` (`"image"`, `"text"`, …).
    pub fn of(&self, kind: &str) -> Option<&AttachmentInputCapability> {
        Some(match kind {
            "image" => &self.image,
            "text" => &self.text,
            "audio" => &self.audio,
            "video" => &self.video,
            "binary" => &self.binary,
            _ => return None,
        })
    }
}

/// `AgentReferenceInputCapabilities["limits"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReferenceLimits {
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub max_count: Option<f64>,
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub max_bytes_per_reference: Option<f64>,
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub max_total_bytes: Option<f64>,
}

/// `AgentReferenceInputCapabilities`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReferenceInputCapabilities {
    #[serde(deserialize_with = "super::lenient::count")]
    pub schema_version: u32,
    pub workspace: WorkspaceInputCapability,
    pub attachments: AttachmentInputCapabilities,
    pub limits: ReferenceLimits,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub steer: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub attachment_only: bool,
}

/// `AgentCapabilities["history"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryCapabilities {
    #[serde(deserialize_with = "super::lenient::text")]
    pub discovery: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub exact_open: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub hydration: String,
}

/// `AgentCapabilities`. Absent compatibility booleans read as `false`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Capabilities {
    #[serde(deserialize_with = "super::lenient::flag")]
    pub streaming_text: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub structured_tool_events: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub command_output_streaming: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub file_change_events: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub manual_approvals: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub structured_questions: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub resume: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub fork: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub steer: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub queue: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub attachments: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub context_references: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub model_selection: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub mode_selection: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub slash_commands: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub session_history: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub usage: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub account_state: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub mcp: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub skills: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub compaction: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub model_connections: bool,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub read_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<HistoryCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_inputs: Option<ReferenceInputCapabilities>,
}

/// One capability flag by its product name (`capabilities[name]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Capability {
    Steer,
    Queue,
    ModelSelection,
    ModeSelection,
    SlashCommands,
    ModelConnections,
    ReadOnly,
}

impl Capabilities {
    pub fn has(&self, capability: Capability) -> bool {
        match capability {
            Capability::Steer => self.steer,
            Capability::Queue => self.queue,
            Capability::ModelSelection => self.model_selection,
            Capability::ModeSelection => self.mode_selection,
            Capability::SlashCommands => self.slash_commands,
            Capability::ModelConnections => self.model_connections,
            Capability::ReadOnly => self.read_only,
        }
    }
}

/// `AgentAccountState["account"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuntimeAccount {
    #[serde(rename = "type")]
    #[serde(deserialize_with = "super::lenient::text")]
    pub kind: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub email: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub plan_type: Option<String>,
}

/// `AgentAccountState`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountState {
    pub account: Option<RuntimeAccount>,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub requires_openai_auth: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub requires_runtime_setup: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub setup_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub error: Option<String>,
}

/// `AgentModel["modelCapabilities"]`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ModelCapabilities {
    #[serde(deserialize_with = "super::lenient::text")]
    pub text: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub tools: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub images: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub reasoning: Option<String>,
}

/// `AgentModel`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Model {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub model: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub display_name: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub description: String,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub is_default: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variants: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub default_variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub context_window: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub connection_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_capabilities: Option<ModelCapabilities>,
}

impl Model {
    /// `model.modelCapabilities?.images === "supported"`.
    pub fn accepts_images(&self) -> bool {
        self.model_capabilities
            .as_ref()
            .is_some_and(|c| c.images == "supported")
    }
}

/// `AgentInferenceProvider`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InferenceProvider {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub default_model: Option<String>,
    #[serde(deserialize_with = "super::lenient::number")]
    #[serde(serialize_with = "super::lenient::write_number")]
    pub model_count: f64,
}

/// `AgentMode`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Mode {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub display_name: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub description: String,
    #[serde(deserialize_with = "super::lenient::flag")]
    pub is_default: bool,
}

/// `AgentCommand`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SlashCommand {
    #[serde(deserialize_with = "super::lenient::text")]
    pub name: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub description: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub source: String,
}

/// `AgentRuntimeInspection`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuntimeInspection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtimes: Option<Vec<RuntimeCatalogEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub selected_runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<RuntimeDescriptor>,
    pub readiness: Option<RuntimeReadiness>,
    pub account: Option<AccountState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub providers: Option<Vec<InferenceProvider>>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub models: Vec<Model>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<Vec<Mode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<Vec<SlashCommand>>,
    pub capabilities: Option<Capabilities>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub warnings: Vec<String>,
}

impl RuntimeInspection {
    /// `inspection.capabilities?.[name]` is truthy.
    pub fn capability(&self, capability: Capability) -> bool {
        self.capabilities
            .as_ref()
            .is_some_and(|c| c.has(capability))
    }
    /// `inspection.runtimes ?? []`.
    pub fn runtime_entries(&self) -> &[RuntimeCatalogEntry] {
        self.runtimes.as_deref().unwrap_or_default()
    }
    /// `inspection.modes ?? []`.
    pub fn mode_list(&self) -> &[Mode] {
        self.modes.as_deref().unwrap_or_default()
    }
    /// `inspection.providers ?? []`.
    pub fn provider_list(&self) -> &[InferenceProvider] {
        self.providers.as_deref().unwrap_or_default()
    }
    /// `inspection.commands ?? []`.
    pub fn command_list(&self) -> &[SlashCommand] {
        self.commands.as_deref().unwrap_or_default()
    }
}
