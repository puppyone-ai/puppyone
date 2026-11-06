//! `ui/activity/agent-tool-steps.ts`: what a tool call did, in user terms.
//! Provider tool ids and conservative read-only shell commands collapse into
//! the same small vocabulary so every Harness reads the same way.
use crate::agent::contract::activity_semantics::is_agent_tool_activity;
use crate::features::desktop_agent::domain::agent_activity_presentation::{
    agent_activity_tool_id, command_presentation_for_activity, path_for_activity,
};
use serde_json::Value;
use std::collections::HashSet;

/// `AgentToolStepKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AgentToolStepKind {
    Command,
    Edit,
    Fetch,
    Generic,
    List,
    Read,
    Search,
    Write,
}

/// `AgentToolStepSegment`.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentToolStepSegment {
    Step {
        id: String,
        part: Value,
    },
    Explored {
        id: String,
        parts: Vec<Value>,
        files: usize,
        searches: usize,
    },
}

impl AgentToolStepSegment {
    pub fn id(&self) -> &str {
        match self {
            Self::Step { id, .. } | Self::Explored { id, .. } => id,
        }
    }
}

/// Settled exploration runs longer than three steps read as one "Explored"
/// line.
pub const AGENT_TOOL_EXPLORATION_FOLD_MIN: usize = 4;

const ACTIVE_STATUSES: &[&str] = &["running", "pending", "in-progress"];
const FAILED_STATUSES: &[&str] = &["failed", "warning", "blocked"];

/// `isActiveToolStatus(status)`.
pub fn is_active_tool_status(status: &str) -> bool {
    ACTIVE_STATUSES.contains(&status)
}

/// `agentToolStepKind(activity)`.
pub fn agent_tool_step_kind(activity: &Value) -> AgentToolStepKind {
    let tool = agent_activity_tool_id(activity);
    if activity["kind"] == "command" || tool == "bash" {
        return match command_presentation_for_activity(activity).tool {
            "grep" | "glob" => AgentToolStepKind::Search,
            "read" => AgentToolStepKind::Read,
            "list" => AgentToolStepKind::List,
            _ => AgentToolStepKind::Command,
        };
    }
    if activity["kind"] == "file-change" {
        return if tool == "write" {
            AgentToolStepKind::Write
        } else {
            AgentToolStepKind::Edit
        };
    }
    match tool.as_str() {
        "grep" | "glob" | "search" => AgentToolStepKind::Search,
        "read" => AgentToolStepKind::Read,
        "list" => AgentToolStepKind::List,
        "edit" => AgentToolStepKind::Edit,
        "write" => AgentToolStepKind::Write,
        "fetch" => AgentToolStepKind::Fetch,
        _ => AgentToolStepKind::Generic,
    }
}

/// `isExplorationStep(kind)`.
pub fn is_exploration_step(kind: AgentToolStepKind) -> bool {
    matches!(
        kind,
        AgentToolStepKind::Search | AgentToolStepKind::Read | AgentToolStepKind::List
    )
}

/// `agentToolStepSegments(parts)`: one tool group's visible lines. Only
/// settled, successful exploration is folded; running work and failures
/// stay on their own line.
pub fn agent_tool_step_segments(parts: &[Value]) -> Vec<AgentToolStepSegment> {
    let mut segments = Vec::new();
    let mut run: Vec<Value> = Vec::new();
    let flush = |run: &mut Vec<Value>, segments: &mut Vec<AgentToolStepSegment>| {
        if run.len() >= AGENT_TOOL_EXPLORATION_FOLD_MIN {
            let (files, searches) = exploration_counts(run);
            segments.push(AgentToolStepSegment::Explored {
                id: format!("explored:{}", run[0]["id"].as_str().unwrap_or_default()),
                parts: std::mem::take(run),
                files,
                searches,
            });
        } else {
            for part in run.drain(..) {
                segments.push(AgentToolStepSegment::Step {
                    id: part["id"].as_str().unwrap_or_default().to_string(),
                    part,
                });
            }
        }
    };
    for part in parts {
        if is_foldable_exploration(part) {
            run.push(part.clone());
            continue;
        }
        flush(&mut run, &mut segments);
        segments.push(AgentToolStepSegment::Step {
            id: part["id"].as_str().unwrap_or_default().to_string(),
            part: part.clone(),
        });
    }
    flush(&mut run, &mut segments);
    segments
}

fn is_foldable_exploration(part: &Value) -> bool {
    let status = part["status"].as_str().unwrap_or_default();
    is_agent_tool_activity(part)
        && !ACTIVE_STATUSES.contains(&status)
        && !FAILED_STATUSES.contains(&status)
        && is_exploration_step(agent_tool_step_kind(part))
}

fn exploration_counts(parts: &[Value]) -> (usize, usize) {
    let mut paths = HashSet::new();
    let mut unnamed_reads = 0;
    let mut searches = 0;
    for part in parts {
        if agent_tool_step_kind(part) != AgentToolStepKind::Read {
            searches += 1;
            continue;
        }
        let path = if part["kind"] == "command" {
            String::new()
        } else {
            path_for_activity(part)
        };
        if path.is_empty() {
            unnamed_reads += 1;
        } else {
            paths.insert(path);
        }
    }
    (paths.len() + unnamed_reads, searches)
}
