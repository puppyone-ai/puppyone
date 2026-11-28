//! `user-message-types.ts`: what a draft refers to (`AgentDraftReference`),
//! where those references sit in its prompt (`AgentPromptReferenceMention`),
//! how the transcript shows them (`AgentReferenceDisplay`) and the intent a
//! submission captures (`AgentSubmissionIntent`).
use serde::{Deserialize, Serialize};

/// `AgentDraftReference["kind"]`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReferenceKind {
    /// A file or directory of an admitted workspace root.
    #[default]
    WorkspaceEntry,
    /// A snapshot Main staged from an external file or bytes.
    StagedAttachment,
}

/// `AgentWorkspaceEntryReference["entryType"]`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntryType {
    #[default]
    File,
    Directory,
}

/// `AgentReferenceStatus`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReferenceStatus {
    Resolving,
    #[default]
    Ready,
    Error,
}

/// `AgentReferenceError`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReferenceError {
    #[serde(deserialize_with = "super::lenient::text")]
    pub code: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_flag")]
    pub retryable: Option<bool>,
}

impl ReferenceError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            ..Self::default()
        }
    }
}

/// `AgentDraftReference`: a workspace entry or a staged attachment. The
/// fields of the other kind stay empty.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DraftReference {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    pub kind: ReferenceKind,
    /// Workspace entries: a file or a directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_type: Option<EntryType>,
    /// Workspace entries: the owning root's identity.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub resource_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub workspace_folder_id: Option<String>,
    /// Workspace entries: a reference from another root says which.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub workspace_name: Option<String>,
    /// Workspace entries: the provider-relative path.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub relative_path: Option<String>,
    /// Staged attachments: Main's grant.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub token: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub size: Option<f64>,
    pub status: ReferenceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ReferenceError>,
}

impl DraftReference {
    pub fn is_ready(&self) -> bool {
        self.status == ReferenceStatus::Ready
    }
    pub fn is_staged(&self) -> bool {
        self.kind == ReferenceKind::StagedAttachment
    }
    /// The staged grant, when there is a non-empty one.
    pub fn grant(&self) -> Option<&str> {
        self.token.as_deref().filter(|token| !token.is_empty())
    }
    /// `reference.size ?? 0`.
    pub fn byte_size(&self) -> f64 {
        self.size.unwrap_or(0.)
    }
    /// The reference marked failed with `error`.
    pub fn failed(mut self, error: ReferenceError) -> Self {
        self.status = ReferenceStatus::Error;
        self.error = Some(error);
        self
    }
}

/// `AgentPromptReferenceMention`: UTF-16 offsets into the prompt.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PromptMention {
    #[serde(deserialize_with = "super::lenient::text")]
    pub reference_id: String,
    #[serde(deserialize_with = "super::lenient::index")]
    pub start: usize,
    #[serde(deserialize_with = "super::lenient::index")]
    pub end: usize,
}

/// `AgentReferenceDisplay["kind"]`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReferenceDisplayKind {
    #[default]
    WorkspaceFile,
    WorkspaceDirectory,
    Attachment,
}

/// `AgentReferenceDisplay`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReferenceDisplay {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    pub kind: ReferenceDisplayKind,
    #[serde(deserialize_with = "super::lenient::text")]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub workspace_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_number")]
    #[serde(serialize_with = "super::lenient::write_optional_number")]
    pub size: Option<f64>,
}

/// `AgentFileReference`: a legacy attachment or context path.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FileReference {
    #[serde(deserialize_with = "super::lenient::text")]
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub name: Option<String>,
}

/// `AgentSubmissionIntent`: the immutable capture of one submission while
/// Main admits it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SubmissionIntent {
    #[serde(deserialize_with = "super::lenient::text")]
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub recovery_of_turn_id: Option<String>,
    #[serde(deserialize_with = "super::lenient::text")]
    pub reference_epoch: String,
    #[serde(deserialize_with = "super::lenient::text")]
    pub prompt: String,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub model: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub effort: Option<String>,
    #[serde(default, deserialize_with = "super::lenient::optional_text")]
    pub mode: Option<String>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub references: Vec<DraftReference>,
    #[serde(deserialize_with = "super::lenient::list")]
    pub prompt_mentions: Vec<PromptMention>,
}
