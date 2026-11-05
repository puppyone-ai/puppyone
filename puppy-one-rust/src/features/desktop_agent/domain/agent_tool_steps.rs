//! Port of `activity/agent-tool-steps.ts` and `AgentToolStepText`: what a
//! tool call did, in user terms — one line per step with a verb, what it
//! acted on and the outcome. Provider tool ids and read-only shell commands
//! collapse into one small vocabulary, so every Harness reads the same.
//! Runs of four or more settled, successful exploration steps fold into one
//! "Explored" line; running work and failures always keep their own line.
use super::agent_activity_presentation::{
    self as presentation, ActivityStatus, Renderer, command, command_tool, file_changes,
    input_value, tool_id,
};
use crate::agent::domain::legacy_session_model::Message;
use serde_json::Value;
use std::collections::HashSet;

/// `AGENT_TOOL_EXPLORATION_FOLD_MIN`.
pub const FOLD_MIN: usize = 4;

/// `AgentToolStepKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepKind {
    Command,
    Edit,
    Fetch,
    Generic,
    List,
    Read,
    Search,
    Write,
}
impl StepKind {
    /// `agent.toolStep.<kind>`.
    pub fn key(self) -> &'static str {
        match self {
            Self::Command | Self::Generic => "command",
            Self::Edit => "edit",
            Self::Fetch => "fetch",
            Self::List => "list",
            Self::Read => "read",
            Self::Search => "search",
            Self::Write => "write",
        }
    }
    fn exploration(self) -> bool {
        matches!(self, Self::Search | Self::Read | Self::List)
    }
}

/// `agentToolStepKind`.
pub fn step_kind(message: &Message) -> StepKind {
    let tool = tool_id(&message.role);
    if tool == "bash" {
        return match command_tool(&command(message)) {
            "grep" | "glob" => StepKind::Search,
            "read" => StepKind::Read,
            "list" => StepKind::List,
            _ => StepKind::Command,
        };
    }
    if presentation::renderer(message) == Renderer::FileChange || message.role == "File changes" {
        return if tool == "write" {
            StepKind::Write
        } else {
            StepKind::Edit
        };
    }
    match tool.as_str() {
        "grep" | "glob" | "search" => StepKind::Search,
        "read" => StepKind::Read,
        "list" => StepKind::List,
        "edit" => StepKind::Edit,
        "write" => StepKind::Write,
        "fetch" => StepKind::Fetch,
        _ => StepKind::Generic,
    }
}
pub fn active(status: &str) -> bool {
    presentation::activity_status(status) == ActivityStatus::Running
}
fn failed(status: &str) -> bool {
    presentation::activity_status(status) == ActivityStatus::Failed
}

/// One visible line of a tool group.
#[derive(Clone, Debug, PartialEq)]
pub enum Segment {
    /// A step: an index into the group's parts.
    Step(usize),
    /// Folded exploration: the steps' indices, and what they covered.
    Explored {
        id: String,
        parts: Vec<usize>,
        files: usize,
        searches: usize,
    },
}
fn foldable(message: &Message) -> bool {
    !active(&message.status) && !failed(&message.status) && step_kind(message).exploration()
}
/// `agentToolStepSegments`.
pub fn segments(parts: &[Message]) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut run: Vec<usize> = Vec::new();
    let flush = |run: &mut Vec<usize>, segments: &mut Vec<Segment>| {
        if run.len() >= FOLD_MIN {
            let (files, searches) = exploration_counts(run.iter().map(|&i| &parts[i]));
            segments.push(Segment::Explored {
                id: format!("explored:{}", parts[run[0]].id),
                parts: std::mem::take(run),
                files,
                searches,
            });
        } else {
            segments.extend(run.drain(..).map(Segment::Step));
        }
    };
    for (index, part) in parts.iter().enumerate() {
        if foldable(part) {
            run.push(index);
            continue;
        }
        flush(&mut run, &mut segments);
        segments.push(Segment::Step(index));
    }
    flush(&mut run, &mut segments);
    segments
}
/// `explorationCounts`: files read (each path once) and other searches.
fn exploration_counts<'a>(parts: impl Iterator<Item = &'a Message>) -> (usize, usize) {
    let mut paths = HashSet::new();
    let (mut unnamed, mut searches) = (0, 0);
    for part in parts {
        if step_kind(part) != StepKind::Read {
            searches += 1;
            continue;
        }
        let path = if tool_id(&part.role) == "bash" {
            String::new()
        } else {
            path_for(part)
        };
        if path.is_empty() {
            unnamed += 1;
        } else {
            paths.insert(path);
        }
    }
    (paths.len() + unnamed, searches)
}

fn first_text(values: &[Option<&Value>]) -> String {
    values
        .iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_default()
}
/// `pathForActivity`.
pub fn path_for(message: &Message) -> String {
    let input = input_value(message);
    let path = first_text(&[
        input.get("path"),
        input.get("file"),
        input.get("filepath"),
        input.get("file_path"),
        input.get("filePath"),
    ]);
    if !path.is_empty() {
        return path;
    }
    file_changes(message)
        .into_iter()
        .next()
        .map(|c| c.path)
        .unwrap_or_default()
}

/// What a step acted on.
#[derive(Clone, Debug, PartialEq)]
pub enum Subject {
    /// A file: its name first, the folder as quiet context.
    Path {
        name: String,
        folder: String,
    },
    /// A pattern, command or URL, literal and monospace.
    Code {
        text: String,
        context: Option<String>,
    },
    Text(String),
}
/// `firstLine`: one line of at most 512 characters.
fn first_line(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or_default();
    if line.chars().count() > 512 {
        format!("{}…", line.chars().take(512).collect::<String>())
    } else {
        line.to_owned()
    }
}
/// `splitPath`.
pub fn path_subject(path: &str) -> Subject {
    let trimmed = path.trim().trim_end_matches(['/', '\\']);
    match trimmed.rfind(['/', '\\']) {
        Some(at) => Subject::Path {
            name: trimmed[at + 1..].to_owned(),
            folder: trimmed[..at].to_owned(),
        },
        None => Subject::Path {
            name: trimmed.to_owned(),
            folder: String::new(),
        },
    }
}
pub fn code_subject(text: &str, context: Option<String>) -> Subject {
    Subject::Code {
        text: first_line(text),
        context,
    }
}
/// `unwrapLoginShell` of the command, as the line shows it.
pub fn visible_command(message: &Message) -> String {
    let command = command(message);
    let trimmed = command.trim();
    for shell in ["zsh", "bash", "sh"] {
        if let Some(at) = trimmed.find(&format!("{shell} -lc ")) {
            let prefix = &trimmed[..at];
            if !(prefix.is_empty() || (prefix.starts_with('/') && prefix.ends_with('/'))) {
                continue;
            }
            let rest = trimmed[at + shell.len() + 5..].trim();
            for quote in ['"', '\''] {
                if rest.len() >= 2 && rest.starts_with(quote) && rest.ends_with(quote) {
                    return rest[1..rest.len() - 1].trim().to_owned();
                }
            }
        }
    }
    trimmed.to_owned()
}
/// The search's scope phrase (`agent.toolStep.searchScope`) is the
/// caller's; this is the scope itself.
pub fn file_query_subject(message: &Message) -> Option<(Subject, Option<String>)> {
    let input = input_value(message);
    if step_kind(message) == StepKind::Search {
        let pattern = first_text(&[input.get("pattern"), input.get("query"), input.get("glob")]);
        let scope = first_text(&[input.get("path")]);
        if !pattern.is_empty() {
            return Some((
                code_subject(&pattern, None),
                Some(scope).filter(|s| !s.is_empty()),
            ));
        }
    }
    let path = path_for(message);
    if !path.is_empty() {
        return Some((path_subject(&path), None));
    }
    // `agentActivitySummary`.
    let summary = first_text(&[
        input.get("description"),
        input.get("query"),
        input.get("pattern"),
    ]);
    (!summary.is_empty()).then(|| (Subject::Text(first_line(&summary)), None))
}
/// `genericSubject`: the URL or query, else nothing.
pub fn generic_subject(message: &Message) -> Option<Subject> {
    let input = input_value(message);
    let target = first_text(&[input.get("url"), input.get("uri"), input.get("query")]);
    (!target.is_empty()).then(|| code_subject(&target, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn tool(id: &str, role: &str, status: &str, input: &str) -> Message {
        Message {
            id: id.into(),
            role: role.into(),
            text: String::new(),
            status: status.into(),
            input: Some(input.into()),
        }
    }

    #[test]
    fn shell_commands_read_as_the_step_they_are() {
        assert_eq!(
            step_kind(&tool(
                "a",
                "Bash",
                "completed",
                r#"{"command":"rg -n todo"}"#
            )),
            StepKind::Search
        );
        assert_eq!(
            step_kind(&tool("a", "Bash", "completed", r#"{"command":"cat a.md"}"#)),
            StepKind::Read
        );
        assert_eq!(
            step_kind(&tool(
                "a",
                "Bash",
                "completed",
                r#"{"command":"cargo test"}"#
            )),
            StepKind::Command
        );
        assert_eq!(
            step_kind(&tool(
                "a",
                "Write",
                "completed",
                r#"{"path":"a.md","content":"x"}"#
            )),
            StepKind::Write
        );
        assert_eq!(
            path_subject("docs/plan.md"),
            Subject::Path {
                name: "plan.md".into(),
                folder: "docs".into()
            }
        );
    }

    #[test]
    fn settled_exploration_folds_and_work_keeps_its_line() {
        let parts = vec![
            tool("1", "Read", "completed", r#"{"path":"a.md"}"#),
            tool("2", "Read", "completed", r#"{"path":"a.md"}"#),
            tool("3", "Grep", "completed", r#"{"pattern":"x"}"#),
            tool("4", "Read", "completed", r#"{"path":"b.md"}"#),
            tool("5", "Edit", "completed", r#"{"path":"a.md"}"#),
            tool("6", "Read", "completed", r#"{"path":"c.md"}"#),
            tool("7", "Read", "failed", r#"{"path":"d.md"}"#),
            tool("8", "Read", "running", r#"{"path":"e.md"}"#),
        ];
        assert_eq!(
            segments(&parts),
            vec![
                Segment::Explored {
                    id: "explored:1".into(),
                    parts: vec![0, 1, 2, 3],
                    files: 2,
                    searches: 1
                },
                Segment::Step(4),
                Segment::Step(5),
                Segment::Step(6),
                Segment::Step(7),
            ]
        );
    }
}
