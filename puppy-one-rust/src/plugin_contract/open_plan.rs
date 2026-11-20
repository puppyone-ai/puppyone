//! Resolution outputs produced by Layer ② (`editor::opening`) and consumed by
//! Layer ① (menus / Settings) and Layer ③ (`editor::handlers`).

use super::handler::{Distribution, HandlerId, HandlerKind, RuntimeKind};
use serde::{Deserialize, Serialize};

/// Why [`OpenPlan::handler`] was selected.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OpenReason {
    UserFile,
    UserType,
    BuiltinDefault,
    Suggested,
    Fallback,
}

/// Why a candidate handler was skipped during resolution.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnavailableReason {
    NotInstalled,
    SourceNotAllowed,
    PlatformUnsupported,
    HostApiIncompatible,
    AppVersionIncompatible,
    SniffedExecutableDisallowed,
    NotFound,
}

/// Availability of an alternative handler listed in "Open with…".
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CandidateStatus {
    Available,
    Installable { size_bytes: u64 },
    Unavailable(UnavailableReason),
}

/// One candidate handler surfaced to the user (for example in "Open with…").
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alternative {
    pub handler: HandlerId,
    pub label: String,
    pub kind: HandlerKind,
    pub runtime: RuntimeKind,
    pub distribution: Distribution,
    pub status: CandidateStatus,
}

/// A candidate or stored preference that could not be used, and why.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkippedCandidate {
    pub handler: HandlerId,
    pub reason: UnavailableReason,
}

/// Conversion pipeline for `HandlerKind::Converter`: format A -> format B
/// rendered by a built-in viewer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversionChain {
    pub converter: HandlerId,
    pub source_format: String,
    pub target_format: String,
    pub target_viewer: HandlerId,
}

/// Pure, deterministic plan for opening one document.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenPlan {
    pub format_id: String,
    pub handler: HandlerId,
    pub reason: OpenReason,
    pub fallback: HandlerId,
    #[serde(default)]
    pub alternatives: Vec<Alternative>,
    #[serde(default)]
    pub skipped: Vec<SkippedCandidate>,
    /// Populated when a user preference (`fileOverrides` or `fileTypeDefaults`)
    /// pointed to an unavailable handler and resolution fell through.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preference_notice: Option<SkippedCandidate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chain: Option<ConversionChain>,
}
