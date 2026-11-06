//! What each activity component of `ui/activity` shows, independent of how
//! it is drawn: `AgentToolRenderer` (`AgentCommandActivity`,
//! `AgentFileChangeActivity`, `AgentFileQueryActivity`,
//! `AgentGenericActivity`), `AgentReasoningActivity`, `AgentPlanActivity`,
//! `AgentNoticeActivity`, `AgentSystemActivity`, `AgentToolStepText`,
//! `AgentToolGlyph`'s kind and `AgentActivityShell`'s status icon.
use super::agent_tool_steps::{AgentToolStepKind, agent_tool_step_kind, is_active_tool_status};
use crate::agent::contract::activity_semantics::is_agent_tool_activity;
use crate::agent::contract::js;
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
use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

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
    let normalized: String = js::trim(tool)
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
            tree: js::trim(tool).to_lowercase() == "list",
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
        let trimmed = TRAILING.replace(js::trim(path), "").to_string();
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
    let line = js::trim(text).split('\n').next().unwrap_or_default();
    let line = line.strip_suffix('\r').unwrap_or(line);
    if js::len16(line) > 512 {
        format!("{}…", js::head16(line, 512))
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
    None,
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
            ShellDetail::None => false,
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

fn status_of(activity: &Value) -> String {
    activity["status"].as_str().unwrap_or_default().to_string()
}

fn glyph(tool: &str, status: &str) -> StepIcon {
    StepIcon::Glyph {
        kind: agent_tool_glyph_kind(tool),
        active: agent_tool_glyph_active(status),
    }
}

/// `AgentPartRenderer` for an activity part.
pub fn activity_view(part: &Value) -> ActivityView {
    match part["kind"].as_str().unwrap_or_default() {
        "reasoning" => reasoning_view(part),
        "plan" => ActivityView::Shell(Box::new(plan_shell(part))),
        "warning" | "error" => ActivityView::Notice {
            error: part["kind"] == "error",
            label: format_agent_activity_label(part),
        },
        "system" => system_view(part),
        "tool" | "command" | "file-change" => tool_view(part),
        _ => ActivityView::Hidden,
    }
}

/// `AgentToolRenderer`: the renderer registered for the tool, then for the
/// kind, else the generic one.
pub fn tool_view(part: &Value) -> ActivityView {
    if !is_agent_tool_activity(part) {
        return ActivityView::Hidden;
    }
    let tool = match part["detail"]["tool"].as_str() {
        Some(tool) => js::trim(tool).to_lowercase(),
        None => js::trim(part["kind"].as_str().unwrap_or_default()).to_lowercase(),
    };
    let renderer = match tool.as_str() {
        "command" | "bash" | "shell" => "command",
        "file-change" | "write" | "edit" | "apply_patch" | "patch" => "file-change",
        "read" | "glob" | "grep" | "search" | "list" => "file-query",
        "tool" | "webfetch" | "websearch" => "generic",
        _ => match part["kind"].as_str().unwrap_or_default() {
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

/// `AgentCommandActivity`.
fn command_shell(activity: &Value) -> ActivityShell {
    let status = status_of(activity);
    let command = command_for_activity(activity);
    let output = output_for_activity(activity);
    let presentation = command_presentation_for_activity(activity);
    let step_kind = agent_tool_step_kind(activity);
    let visible = visible_command_for_activity(activity);
    let visible = if visible.is_empty() {
        activity["label"].as_str().unwrap_or_default().to_string()
    } else {
        visible
    };
    let (exit_code, duration_ms) = command_metadata(activity);
    // Only facts worth a glance: a non-zero exit, and runs long enough to
    // notice.
    let facts: Vec<String> = if is_active_tool_status(&status) {
        Vec::new()
    } else {
        [
            exit_code.filter(|code| *code != 0.).map(|code| {
                tf(
                    "agent.toolStep.exitCode",
                    &[("code", Arg::Text(format_number(code as i64)))],
                )
            }),
            duration_ms
                .filter(|ms| *ms >= 1_000.)
                .map(format_agent_duration),
        ]
        .into_iter()
        .flatten()
        .collect()
    };
    let mut evidence = Vec::new();
    if !command.is_empty() {
        evidence.push(EvidenceNode {
            marker: Some("$"),
            tone: None,
            content: EvidenceContent::Text(command),
        });
    }
    if !output.is_empty() {
        evidence.push(EvidenceNode::text(output));
    }
    let kind = if step_kind == AgentToolStepKind::Generic {
        "command"
    } else {
        kind_key(step_kind)
    };
    ActivityShell {
        title: step_verb(kind, &status),
        subject: (!visible.is_empty()).then(|| StepSubject::code(&visible, None)),
        summary: None,
        metadata: (!facts.is_empty()).then(|| StepMetadata::Facts(facts.join(" · "))),
        icon: glyph(presentation.tool, &status),
        status,
        detail: ShellDetail::Evidence(evidence),
        default_expanded: false,
    }
}

/// `AgentFileChangeActivity`: nothing when it names no file and has no
/// output.
fn file_change_shell(activity: &Value) -> Option<ActivityShell> {
    let status = status_of(activity);
    let changes = file_changes_for_activity(activity);
    let tool = agent_activity_tool_id(activity);
    let totals = file_change_totals(&changes);
    let path = path_for_activity(activity);
    let output = output_for_activity(activity);
    if changes.is_empty() && path.is_empty() && output.is_empty() {
        return None;
    }
    let files: Vec<ChangedFile> = if !changes.is_empty() {
        changes
            .iter()
            .map(|change| {
                (
                    change.path.clone(),
                    change.blocks.clone(),
                    change.diff.clone(),
                    change.truncated,
                )
            })
            .collect()
    } else if !path.is_empty() {
        vec![(path, Vec::new(), String::new(), false)]
    } else {
        Vec::new()
    };
    let step_kind = if agent_tool_step_kind(activity) == AgentToolStepKind::Write {
        "write"
    } else {
        "edit"
    };
    let subject = match files.len() {
        0 => None,
        1 => Some(StepSubject::path(&files[0].0)),
        count => Some(StepSubject::text(&tf(
            "agent.activity.fileCount",
            &[("count", Arg::Number(count as i64))],
        ))),
    };
    let mut evidence = Vec::new();
    for (path, blocks, diff, truncated) in &files {
        evidence.push(EvidenceNode {
            marker: None,
            tone: None,
            content: EvidenceContent::FilePath(path.clone()),
        });
        for (removed, added) in blocks {
            if let Some(removed) = removed {
                evidence.push(EvidenceNode {
                    marker: Some("−"),
                    tone: Some(EvidenceTone::Deletion),
                    content: EvidenceContent::Text(removed.clone()),
                });
            }
            if let Some(added) = added {
                evidence.push(EvidenceNode {
                    marker: Some("+"),
                    tone: Some(EvidenceTone::Addition),
                    content: EvidenceContent::Text(added.clone()),
                });
            }
        }
        if blocks.is_empty() && !diff.is_empty() {
            evidence.push(EvidenceNode::text(diff.clone()));
        }
        if *truncated {
            evidence.push(EvidenceNode {
                marker: None,
                tone: None,
                content: EvidenceContent::Empty(t("agent.activity.diffPartial").into()),
            });
        }
    }
    if !output.is_empty() {
        evidence.push(EvidenceNode::text(output));
    }
    Some(ActivityShell {
        title: step_verb(step_kind, &status),
        subject,
        summary: None,
        metadata: totals.map(|(additions, deletions)| StepMetadata::DiffStats {
            additions: format!("+{}", format_number(additions)),
            deletions: format!("−{}", format_number(deletions)),
        }),
        icon: glyph(&tool, &status),
        status,
        detail: ShellDetail::Evidence(evidence),
        default_expanded: false,
    })
}

/// `AgentFileQueryActivity`.
fn file_query_shell(activity: &Value) -> ActivityShell {
    static NO_RESULTS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^no (?:matches|files|results)(?: found)?\.?$").expect("no results")
    });
    let status = status_of(activity);
    let tool = agent_activity_tool_id(activity);
    let output = output_for_activity(activity);
    let results =
        collect_agent_tool_result_lines(&output, 80, AGENT_TOOL_EVIDENCE_LIMITS.max_line_chars);
    let searchable = ["grep", "glob", "search", "list"].contains(&tool.as_str());
    let step_kind = agent_tool_step_kind(activity);
    // Line counts are only meaningful for local match listings, not web
    // search prose.
    let countable =
        (tool == "grep" || tool == "glob") && !is_active_tool_status(&status) && !output.is_empty();
    let result_count = countable.then(|| {
        if NO_RESULTS.is_match(js::trim(&output)) {
            0
        } else {
            results.total_lines
        }
    });
    let kind = if step_kind == AgentToolStepKind::Generic {
        "search"
    } else {
        kind_key(step_kind)
    };
    let evidence = if output.is_empty() {
        Vec::new()
    } else if searchable {
        vec![EvidenceNode {
            marker: None,
            tone: None,
            content: EvidenceContent::SearchResults(results),
        }]
    } else {
        vec![EvidenceNode::text(output)]
    };
    ActivityShell {
        title: step_verb(kind, &status),
        subject: file_query_subject(activity, step_kind),
        summary: None,
        metadata: result_count.map(|count| {
            StepMetadata::Facts(if count == 0 {
                t("agent.activity.noResults").to_string()
            } else {
                tf(
                    "agent.toolStep.results",
                    &[
                        ("count", Arg::Number(count as i64)),
                        ("value", Arg::Text(format_number(count as i64))),
                    ],
                )
            })
        }),
        icon: glyph(&tool, &status),
        status,
        detail: ShellDetail::Evidence(evidence),
        default_expanded: false,
    }
}

fn first_trimmed(values: &[&Value]) -> String {
    values
        .iter()
        .find_map(|value| value.as_str().map(js::trim).filter(|v| !v.is_empty()))
        .unwrap_or_default()
        .to_string()
}

/// `fileQuerySubject(activity, stepKind, t)`.
fn file_query_subject(activity: &Value, step_kind: AgentToolStepKind) -> Option<StepSubject> {
    let detail = &activity["detail"];
    let input = if detail["input"].is_object() {
        detail["input"].clone()
    } else {
        Value::Null
    };
    if step_kind == AgentToolStepKind::Search {
        let pattern = first_trimmed(&[
            &input["pattern"],
            &detail["query"],
            &input["query"],
            &input["glob"],
        ]);
        let scope = first_trimmed(&[&input["path"], &detail["path"]]);
        if !pattern.is_empty() {
            let context = (!scope.is_empty())
                .then(|| tf("agent.toolStep.searchScope", &[("path", Arg::Text(scope))]));
            return Some(StepSubject::code(&pattern, context));
        }
    }
    let path = path_for_activity(activity);
    if !path.is_empty() {
        return Some(StepSubject::path(&path));
    }
    let summary = agent_activity_summary(activity);
    (!summary.is_empty()).then(|| StepSubject::text(&summary))
}

/// `resultPath(line)`: the file a search result line names.
pub fn result_path(line: &str) -> Option<String> {
    static NUMBERED: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(.+?):\d+(?::\d+)?:").expect("numbered"));
    static URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^https?://").expect("url"));
    if let Some(captures) = NUMBERED.captures(line) {
        return Some(captures[1].to_string());
    }
    let plain = js::trim(line);
    (!plain.is_empty() && !plain.contains('\0') && !URL.is_match(plain)).then(|| plain.to_string())
}

/// `AgentGenericActivity`.
fn generic_view(activity: &Value) -> ActivityView {
    if is_context_compaction_activity(activity) {
        return ActivityView::ContextDivider(t("agent.activity.contextCompacted").into());
    }
    let status = status_of(activity);
    let tool = agent_activity_tool_id(activity);
    let output = output_for_activity(activity);
    let input = structured_input_for_activity(activity);
    let step_kind = agent_tool_step_kind(activity);
    let detail = &activity["detail"];
    let structured = if detail["input"].is_object() {
        detail["input"].clone()
    } else {
        Value::Null
    };
    let target = [
        &structured["url"],
        &structured["uri"],
        &detail["url"],
        &structured["query"],
        &detail["query"],
    ]
    .into_iter()
    .find_map(|value| value.as_str().filter(|v| !js::trim(v).is_empty()))
    .map(str::to_string);
    let title = if matches!(
        step_kind,
        AgentToolStepKind::Fetch | AgentToolStepKind::Search
    ) {
        step_verb(kind_key(step_kind), &status)
    } else {
        format_agent_tool_name(&tool)
    };
    // A provider label that only repeats the tool name adds nothing.
    let summary = agent_activity_summary(activity);
    let repeated = [
        Some(title.as_str()),
        Some(tool.as_str()),
        detail["tool"].as_str(),
    ]
    .into_iter()
    .flatten()
    .any(|value| js::trim(value).to_lowercase() == js::trim(&summary).to_lowercase());
    let informative = !summary.is_empty() && !repeated;
    let subject = match target {
        Some(target) => Some(StepSubject::code(&target, None)),
        None if informative => Some(StepSubject::text(&summary)),
        None => None,
    };
    let mut evidence = Vec::new();
    if !output.is_empty() || input.is_some() {
        if let Some(input) = input {
            evidence.push(EvidenceNode::text(input));
        }
        if !output.is_empty() {
            evidence.push(EvidenceNode::text(output));
        }
    }
    ActivityView::Shell(Box::new(ActivityShell {
        title,
        subject,
        summary: None,
        metadata: None,
        icon: glyph(&tool, &status),
        status,
        detail: ShellDetail::Evidence(evidence),
        default_expanded: false,
    }))
}

/// `AgentReasoningActivity`: the live tail is the single authority for
/// in-progress feedback; a settled public summary alone becomes a row.
fn reasoning_view(activity: &Value) -> ActivityView {
    let status = status_of(activity);
    let reasoning = match activity["detail"]["delta"].as_str() {
        Some(delta) => delta.to_string(),
        None => output_for_activity(activity),
    };
    if matches!(status.as_str(), "running" | "pending" | "in-progress")
        || js::trim(&reasoning).is_empty()
    {
        return ActivityView::Hidden;
    }
    let duration = command_metadata(activity).1.map(format_agent_duration);
    ActivityView::Shell(Box::new(ActivityShell {
        title: match duration {
            Some(duration) => tf(
                "agent.activity.thoughtFor",
                &[("duration", Arg::Text(duration))],
            ),
            None => t("agent.activity.thoughtBriefly").into(),
        },
        subject: None,
        summary: None,
        metadata: None,
        status,
        icon: StepIcon::Brain,
        detail: ShellDetail::Prose {
            text: Some(reasoning),
            plan: Vec::new(),
        },
        default_expanded: false,
    }))
}

/// `AgentPlanActivity`.
fn plan_shell(activity: &Value) -> ActivityShell {
    let status = status_of(activity);
    let steps: Vec<PlanStep> = activity["detail"]["steps"]
        .as_array()
        .map(|steps| {
            steps
                .iter()
                .take(100)
                .map(|step| {
                    let text = match step.get("step") {
                        None | Some(Value::Null) => String::new(),
                        Some(value) => js::to_js_string(Some(value)),
                    };
                    let status = match step.get("status") {
                        None | Some(Value::Null) => "pending".to_string(),
                        Some(value) => js::to_js_string(Some(value)),
                    };
                    PlanStep {
                        step: js::head16(&text, 2_000).to_string(),
                        status_label: plan_status_label(&status),
                        status,
                    }
                })
                .filter(|step| !step.step.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let detail = &activity["detail"];
    let text = detail["text"]
        .as_str()
        .or_else(|| detail["explanation"].as_str())
        .map(|text| js::head16(text, 64 * 1024).to_string())
        .filter(|text| !text.is_empty());
    ActivityShell {
        title: t("agent.tool.plan").into(),
        subject: None,
        summary: None,
        metadata: None,
        default_expanded: status == "running",
        status,
        icon: StepIcon::ListTodo,
        detail: ShellDetail::Prose { text, plan: steps },
    }
}

/// `formatPlanStatus(status, t)`.
fn plan_status_label(status: &str) -> String {
    match status {
        "pending" => t("agent.plan.pending").into(),
        "inProgress" | "in-progress" | "in_progress" => t("agent.plan.inProgress").into(),
        "completed" => t("agent.plan.completed").into(),
        other => other.to_string(),
    }
}

/// `AgentSystemActivity`: only context compaction belongs in the
/// transcript.
fn system_view(activity: &Value) -> ActivityView {
    if activity["detail"]["category"] != "compaction" {
        return ActivityView::Hidden;
    }
    let status = status_of(activity);
    let label = match status.as_str() {
        "completed" | "succeeded" => t("agent.activity.contextCompacted").to_string(),
        "running" | "queued" | "pending" | "in-progress" => {
            t("agent.activity.compactingContext").to_string()
        }
        other => {
            let state = match other {
                "failed" => "failed",
                "cancelled" | "interrupted" => "stopped",
                _ => "unknown",
            };
            format!(
                "{}: {}",
                t("agent.header.compactContext"),
                t(&format!("agent.status.{state}"))
            )
        }
    };
    ActivityView::ContextDivider(label)
}
