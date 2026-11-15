//! What each activity component of `ui/activity` shows, independent of how
//! it is drawn: `AgentToolRenderer` (`AgentCommandActivity`,
//! `AgentFileChangeActivity`, `AgentFileQueryActivity`,
//! `AgentGenericActivity`), `AgentReasoningActivity`, `AgentPlanActivity`,
//! `AgentNoticeActivity`, `AgentSystemActivity`, `AgentToolStepText`,
//! `AgentToolGlyph`'s kind and `AgentActivityShell`'s status icon.
use super::agent_tool_steps::{AgentToolStepKind, agent_tool_step_kind, is_active_tool_status};
use crate::agent::contract::activity_semantics::is_tool_activity;
use crate::agent::contract::dto::{Part, RecordRef};
use crate::features::desktop_agent::domain::agent_activity_presentation::{
    agent_activity_summary, agent_activity_tool_id, command_for_activity, command_metadata,
    command_presentation_for_activity, file_change_totals, file_changes_for_activity,
    format_agent_activity_label, format_agent_duration, format_agent_tool_name,
    is_context_compaction_activity, output_for_activity, path_for_activity,
    structured_input_for_activity, visible_command_for_activity,
};
use crate::features::desktop_agent::domain::agent_tool_evidence::{
    AGENT_TOOL_EVIDENCE_LIMITS, AgentToolResultLines, collect_agent_tool_result_lines,
};
use crate::localization::{Arg, format_number, t, tf};
use crate::text;
use regex::Regex;
use std::sync::LazyLock;

mod command;
mod file_change;
mod file_query;
mod generic;
mod plan;
mod reasoning;
mod system;

use command::*;
use file_change::*;
pub use file_query::result_path;
use file_query::*;
use generic::*;
use plan::*;
use reasoning::*;
use system::*;
/// `AgentToolGlyph`'s kind (`agentToolGlyphKind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentToolGlyphKind {
    Command,
    Edit,
    Fetch,
    Generic,
    /// `ListTree` for `list`, `FolderSearch` for other list-like tools.
    List {
        tree: bool,
    },
    Read,
    Search,
    Write,
}

/// `agentToolGlyphKind(tool)`.
pub fn agent_tool_glyph_kind(tool: &str) -> AgentToolGlyphKind {
    let normalized: String = text::trim(tool)
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '_' && *c != '-')
        .collect();
    match normalized.as_str() {
        "grep" | "search" | "find" | "filesearch" => AgentToolGlyphKind::Search,
        "read" | "readfile" | "view" | "openfile" => AgentToolGlyphKind::Read,
        "edit" | "patch" | "applypatch" | "replace" => AgentToolGlyphKind::Edit,
        "write" | "writefile" | "create" | "createfile" => AgentToolGlyphKind::Write,
        "glob" | "list" | "listfiles" | "foldersearch" => AgentToolGlyphKind::List {
            tree: text::trim(tool).to_lowercase() == "list",
        },
        "fetch" | "webfetch" | "browse" => AgentToolGlyphKind::Fetch,
        "bash" | "shell" | "command" | "terminal" => AgentToolGlyphKind::Command,
        _ => AgentToolGlyphKind::Generic,
    }
}

/// `AgentToolGlyph`'s `is-active`: only running and in-progress move.
pub fn agent_tool_glyph_active(status: &str) -> bool {
    matches!(status, "running" | "in-progress")
}

/// `AgentActivityShell`'s `StatusIcon`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StatusIcon {
    /// Running work shows its glyph's motion, not a second spinner.
    None,
    Failed {
        label: String,
    },
    Completed {
        label: String,
    },
    Stopped {
        label: String,
    },
    Pending {
        label: String,
    },
}

pub fn status_icon(status: &str) -> StatusIcon {
    match status {
        "running" | "pending" | "in-progress" => StatusIcon::None,
        "failed" | "warning" | "blocked" => StatusIcon::Failed {
            label: t(if status == "warning" {
                "agent.status.warning"
            } else {
                "agent.status.failed"
            })
            .into(),
        },
        "completed" | "succeeded" => StatusIcon::Completed {
            label: t("agent.status.completed").into(),
        },
        "cancelled" | "interrupted" => StatusIcon::Stopped {
            label: t("agent.status.stopped").into(),
        },
        "queued" => StatusIcon::Pending {
            label: t("agent.status.queued").into(),
        },
        "waiting-for-user" => StatusIcon::Pending {
            label: t("agent.status.waitingForUser").into(),
        },
        _ => StatusIcon::Pending {
            label: t("agent.status.unknown").into(),
        },
    }
}

/// `AgentToolStepPath` / `AgentToolStepCode` / `AgentToolStepText`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StepSubject {
    /// A file reads as its name first; the folder is quiet context.
    Path {
        name: String,
        folder: String,
    },
    /// Patterns, commands and URLs keep their literal monospace form.
    Code {
        text: String,
        context: Option<String>,
    },
    Text(String),
}

impl StepSubject {
    pub fn path(path: &str) -> Self {
        static TRAILING: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"[\\/]+$").expect("trailing"));
        let trimmed = TRAILING.replace(text::trim(path), "").to_string();
        match trimmed.rfind(['/', '\\']) {
            None => Self::Path {
                name: trimmed,
                folder: String::new(),
            },
            Some(separator) => Self::Path {
                name: trimmed[separator + 1..].to_string(),
                folder: trimmed[..separator].to_string(),
            },
        }
    }
    pub fn code(text: &str, context: Option<String>) -> Self {
        Self::Code {
            text: first_line(text),
            context,
        }
    }
    pub fn text(text: &str) -> Self {
        Self::Text(first_line(text))
    }
}

/// `firstLine(text)`.
fn first_line(text: &str) -> String {
    let line = text::trim(text).split('\n').next().unwrap_or_default();
    let line = line.strip_suffix('\r').unwrap_or(line);
    if text::len16(line) > 512 {
        format!("{}…", text::head16(line, 512))
    } else {
        line.to_string()
    }
}

/// The metadata slot of a step line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StepMetadata {
    /// `.desktop-agent-tool-facts`.
    Facts(String),
    /// `.desktop-agent-tool-diff-stats`.
    DiffStats {
        additions: String,
        deletions: String,
    },
}

/// `AgentToolEvidenceNode`'s tone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvidenceTone {
    Addition,
    Deletion,
}

/// What one evidence node holds.
#[derive(Clone, Debug, PartialEq)]
pub enum EvidenceContent {
    /// `AgentToolTextEvidence`: bounded text (the full source stays copyable).
    Text(String),
    /// `.desktop-agent-tool-file-path`: opens the file when navigable.
    FilePath(String),
    /// `SearchResults`: each line may open the file it names.
    SearchResults(AgentToolResultLines),
    /// `.desktop-agent-tool-empty`.
    Empty(String),
}

/// `AgentToolEvidenceNode`.
#[derive(Clone, Debug, PartialEq)]
pub struct EvidenceNode {
    pub marker: Option<&'static str>,
    pub tone: Option<EvidenceTone>,
    pub content: EvidenceContent,
}

impl EvidenceNode {
    fn text(text: impl Into<String>) -> Self {
        Self {
            marker: None,
            tone: None,
            content: EvidenceContent::Text(text.into()),
        }
    }
}

/// The detail an `AgentActivityShell` discloses.
#[derive(Clone, Debug, PartialEq)]
pub enum ShellDetail {
    Evidence(Vec<EvidenceNode>),
    /// Reasoning and plan text in a quiet prose branch.
    Prose {
        text: Option<String>,
        plan: Vec<PlanStep>,
    },
}

/// `AgentPlanItem`'s steps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanStep {
    pub step: String,
    pub status: String,
    pub status_label: String,
}

/// What a step icon draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepIcon {
    /// `AgentToolGlyph` of the tool.
    Glyph {
        kind: AgentToolGlyphKind,
        active: bool,
    },
    Brain,
    ListTodo,
}

/// `AgentActivityShell`.
#[derive(Clone, Debug, PartialEq)]
pub struct ActivityShell {
    pub title: String,
    pub subject: Option<StepSubject>,
    pub summary: Option<String>,
    pub metadata: Option<StepMetadata>,
    pub status: String,
    pub icon: StepIcon,
    pub detail: ShellDetail,
    pub default_expanded: bool,
}

impl ActivityShell {
    pub fn has_detail(&self) -> bool {
        match &self.detail {
            ShellDetail::Evidence(nodes) => !nodes.is_empty(),
            ShellDetail::Prose { text, plan } => {
                text.as_deref().is_some_and(|t| !t.is_empty()) || !plan.is_empty()
            }
        }
    }
    pub fn active(&self) -> bool {
        is_active_tool_status(&self.status)
    }
}

/// A changed file's path, diff blocks, unified diff and truncation flag.
type ChangedFile = (String, Vec<(Option<String>, Option<String>)>, String, bool);

/// What an activity part renders as.
#[derive(Clone, Debug, PartialEq)]
pub enum ActivityView {
    Shell(Box<ActivityShell>),
    /// `.desktop-agent-context-divider`.
    ContextDivider(String),
    /// `AgentNoticeActivity`.
    Notice {
        error: bool,
        label: String,
    },
    /// Nothing in the transcript.
    Hidden,
}

/// `agentToolStepVerb(kind, status, t)`.
fn step_verb(kind: &str, status: &str) -> String {
    let phase = if is_active_tool_status(status) {
        "active"
    } else {
        "done"
    };
    t(&format!("agent.toolStep.{kind}.{phase}")).to_string()
}

fn kind_key(kind: AgentToolStepKind) -> &'static str {
    match kind {
        AgentToolStepKind::Command => "command",
        AgentToolStepKind::Edit => "edit",
        AgentToolStepKind::Fetch => "fetch",
        AgentToolStepKind::Generic => "generic",
        AgentToolStepKind::List => "list",
        AgentToolStepKind::Read => "read",
        AgentToolStepKind::Search => "search",
        AgentToolStepKind::Write => "write",
    }
}

fn status_of(activity: &Part) -> String {
    activity.status.clone()
}

fn glyph(tool: &str, status: &str) -> StepIcon {
    StepIcon::Glyph {
        kind: agent_tool_glyph_kind(tool),
        active: agent_tool_glyph_active(status),
    }
}

/// `AgentPartRenderer` for an activity part.
pub fn activity_view(part: &Part) -> ActivityView {
    match part.kind.as_str() {
        "reasoning" => reasoning_view(part),
        "plan" => ActivityView::Shell(Box::new(plan_shell(part))),
        "warning" | "error" => ActivityView::Notice {
            error: part.kind == "error",
            label: format_agent_activity_label(part),
        },
        "system" => system_view(part),
        "tool" | "command" | "file-change" => tool_view(part),
        _ => ActivityView::Hidden,
    }
}

/// `AgentToolRenderer`: the renderer registered for the tool, then for the
/// kind, else the generic one.
pub fn tool_view(part: &Part) -> ActivityView {
    if !is_tool_activity(part) {
        return ActivityView::Hidden;
    }
    let tool = match part.detail.text("tool") {
        Some(tool) => text::trim(tool).to_lowercase(),
        None => text::trim(&part.kind).to_lowercase(),
    };
    let renderer = match tool.as_str() {
        "command" | "bash" | "shell" => "command",
        "file-change" | "write" | "edit" | "apply_patch" | "patch" => "file-change",
        "read" | "glob" | "grep" | "search" | "list" => "file-query",
        "tool" | "webfetch" | "websearch" => "generic",
        _ => match part.kind.as_str() {
            "command" => "command",
            "file-change" => "file-change",
            _ => "generic",
        },
    };
    match renderer {
        "command" => ActivityView::Shell(Box::new(command_shell(part))),
        "file-change" => file_change_shell(part).map_or(ActivityView::Hidden, |shell| {
            ActivityView::Shell(Box::new(shell))
        }),
        "file-query" => ActivityView::Shell(Box::new(file_query_shell(part))),
        _ => generic_view(part),
    }
}
