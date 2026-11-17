//! Port of `terminal-agent/activity/adapters/*` and `normalize-tool-event.mjs`:
//! each provider's event names become phases, tool names become operations
//! and projected path fields become candidate targets.
use super::{Access, Operation, Phase, limits, projector::Projected};
use serde_json::Value;

/// The adapters of `terminal-agent-activity-adapter-registry.mjs`, in order,
/// with their display names.
pub const ADAPTERS: [(&str, &str); 6] = [
    ("codex", "Codex"),
    ("claude", "Claude Code"),
    ("cursor", "Cursor Agent CLI"),
    ("opencode", "OpenCode"),
    ("pi", "Pi Agent"),
    ("hermes", "Hermes Agent"),
];
pub fn known(provider: &str) -> bool {
    ADAPTERS.iter().any(|(id, _)| *id == provider)
}
/// `PROVIDER_LABELS` (`desktop-agent-presence/agentActivity.ts`).
pub fn label(provider: &str) -> &str {
    ADAPTERS
        .iter()
        .find(|(id, _)| *id == provider)
        .map_or(provider, |(_, label)| label)
}

/// A candidate target before workspace containment.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceTarget {
    pub path: String,
    pub access: Access,
}
/// `NormalizedAgentActivitySourceEvent`.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceEvent {
    pub provider_id: String,
    pub terminal_session_id: String,
    pub source_session_id: Option<String>,
    pub native_turn_id: Option<String>,
    pub native_tool_call_id: String,
    pub native_tool_name: String,
    pub phase: Phase,
    pub operation: Operation,
    pub cwd: String,
    pub targets: Vec<SourceTarget>,
    pub occurred_at: u64,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Normalized {
    /// The provider's session ended: its open claims are cancelled.
    SessionEnded {
        source_session_id: Option<String>,
    },
    Event(SourceEvent),
}

fn phase(provider: &str, event: &str) -> Option<Phase> {
    use Phase::*;
    let event = event.to_lowercase();
    let table: &[(&str, Phase)] = match provider {
        "codex" => &[("pretooluse", Started), ("posttooluse", Completed)],
        "claude" => &[
            ("pretooluse", Started),
            ("posttooluse", Completed),
            ("posttoolusefailure", Failed),
        ],
        "cursor" => &[
            ("pretooluse", Started),
            ("posttooluse", Completed),
            ("posttoolusefailure", Failed),
            ("beforereadfile", Started),
            ("afterfileedit", Completed),
        ],
        "hermes" => &[
            ("pre_tool_call", Started),
            ("post_tool_call", Completed),
            ("tool_call_error", Failed),
        ],
        "opencode" => &[
            ("tool.execute.before", Started),
            ("tool.execute.after", Completed),
            ("tool.execute.error", Failed),
        ],
        "pi" => &[
            ("tool_call", Started),
            ("tool_result", Completed),
            ("tool_error", Failed),
        ],
        _ => &[],
    };
    table
        .iter()
        .find(|(name, _)| *name == event)
        .map(|(_, p)| *p)
}
fn session_end(provider: &str, event: &str) -> bool {
    let event = event.to_lowercase();
    match provider {
        "codex" | "claude" | "cursor" => event == "sessionend",
        "hermes" => event == "on_session_end" || event == "on_session_finalize",
        _ => false,
    }
}

/// The adapter's `normalize(payload, context)`; `None` for an unknown
/// provider or an event that is not a tool phase.
pub fn normalize(
    provider: &str,
    payload: &Projected,
    terminal_session_id: &str,
    occurred_at: u64,
) -> Option<Normalized> {
    if !known(provider) {
        return None;
    }
    if session_end(provider, &payload.event_name) {
        return Some(Normalized::SessionEnded {
            source_session_id: payload.session_id.clone(),
        });
    }
    let phase = phase(provider, &payload.event_name)?;
    let classified = classify(&payload.tool_name);
    let operation = if classified == Operation::Command
        && matches!(payload.input.get("read_paths"), Some(Value::Array(_)))
    {
        Operation::Read
    } else {
        classified
    };
    let targets = match operation {
        Operation::Command | Operation::Subagent | Operation::Tool => vec![],
        _ => targets(payload, operation),
    };
    Some(Normalized::Event(SourceEvent {
        provider_id: provider.into(),
        terminal_session_id: terminal_session_id.into(),
        source_session_id: payload.session_id.clone(),
        native_turn_id: payload.turn_id.clone(),
        native_tool_call_id: payload.tool_call_id.clone(),
        native_tool_name: payload.tool_name.clone(),
        phase,
        operation,
        cwd: payload.cwd.clone(),
        targets,
        occurred_at,
    }))
}

/// `DEFAULT_TOOL_GROUPS`, first match wins; anything else is a plain tool.
pub fn classify(tool: &str) -> Operation {
    use std::sync::OnceLock;
    static GROUPS: OnceLock<Vec<(Operation, regex::Regex)>> = OnceLock::new();
    let groups = GROUPS.get_or_init(|| {
        [
            (
                Operation::Command,
                r"^(?:bash|shell|terminal|exec|exec_command)$",
            ),
            (
                Operation::Subagent,
                r"^(?:agent|task|delegate_task|spawn_agent)$",
            ),
            (
                Operation::Delete,
                r"(?:delete|remove|unlink).*(?:file|path)|^(?:delete_file|remove_file)$",
            ),
            (
                Operation::Move,
                r"(?:move|rename).*(?:file|path)|^(?:move_file|rename_file)$",
            ),
            (
                Operation::Write,
                r"(?:write|edit|patch|replace|create|save|apply_patch)",
            ),
            (Operation::Search, r"(?:grep|glob|search|find|list_files)"),
            (Operation::Read, r"(?:read|view|open|get).*(?:file|path)?"),
        ]
        .into_iter()
        .map(|(op, pattern)| (op, regex::Regex::new(pattern).unwrap()))
        .collect()
    });
    let name = tool.to_lowercase();
    groups
        .iter()
        .find(|(_, pattern)| pattern.is_match(&name))
        .map_or(Operation::Tool, |(op, _)| *op)
}

/// `createTargets`: every projected path, deduplicated by path and access.
fn targets(payload: &Projected, operation: Operation) -> Vec<SourceTarget> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for (key, item) in &payload.input {
        let candidates: Vec<&str> = match item {
            Value::Array(items) => items.iter().filter_map(Value::as_str).collect(),
            other => other.as_str().into_iter().collect(),
        };
        for path in candidates {
            let access = access(operation, key);
            if seen.insert((path.to_owned(), access)) {
                result.push(SourceTarget {
                    path: path.into(),
                    access,
                });
            }
        }
    }
    result.truncate(limits::TARGETS_PER_ACTIVITY);
    result
}
fn access(operation: Operation, key: &str) -> Access {
    match operation {
        Operation::Read => Access::Read,
        Operation::Search => Access::Search,
        Operation::Delete => Access::Delete,
        Operation::Move if matches!(key, "source_path" | "old_path" | "from") => Access::MoveFrom,
        Operation::Move => Access::MoveTo,
        _ => Access::Write,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;
    fn payload(event: &str, tool: &str, input: Value) -> Projected {
        Projected {
            event_name: event.into(),
            session_id: Some("s".into()),
            turn_id: None,
            tool_call_id: "call".into(),
            tool_name: tool.into(),
            cwd: "/repo".into(),
            input: input.as_object().unwrap().clone(),
        }
    }
    fn event(n: Option<Normalized>) -> SourceEvent {
        match n {
            Some(Normalized::Event(e)) => e,
            other => panic!("{other:?}"),
        }
    }
    #[test]
    fn provider_events_become_phases() {
        let p = payload("PreToolUse", "Read", json!({ "file_path": "a.rs" }));
        let e = event(normalize("claude", &p, "t", 5));
        assert_eq!((e.phase, e.operation), (Phase::Started, Operation::Read));
        assert_eq!(e.targets[0].access, Access::Read);
        assert_eq!(
            event(normalize(
                "cursor",
                &payload("afterFileEdit", "Write", json!({})),
                "t",
                5
            ))
            .phase,
            Phase::Completed
        );
        assert_eq!(
            event(normalize(
                "pi",
                &payload("tool_error", "edit", json!({})),
                "t",
                5
            ))
            .phase,
            Phase::Failed
        );
        // Codex has no failure event; unknown events and providers are dropped.
        assert!(
            normalize(
                "codex",
                &payload("PostToolUseFailure", "x", json!({})),
                "t",
                5
            )
            .is_none()
        );
        assert!(normalize("other", &p, "t", 5).is_none());
        assert_eq!(
            normalize(
                "hermes",
                &payload("on_session_finalize", "x", json!({})),
                "t",
                5
            ),
            Some(Normalized::SessionEnded {
                source_session_id: Some("s".into())
            })
        );
        assert!(normalize("opencode", &payload("SessionEnd", "x", json!({})), "t", 5).is_none());
    }
    #[test]
    fn tools_classify_like_the_product() {
        for (tool, op) in [
            ("Bash", Operation::Command),
            ("Task", Operation::Subagent),
            ("delete_file", Operation::Delete),
            ("rename_path", Operation::Move),
            ("MultiEdit", Operation::Write),
            ("apply_patch", Operation::Write),
            ("Grep", Operation::Search),
            ("read_file", Operation::Read),
            ("WebFetch", Operation::Tool),
        ] {
            assert_eq!(classify(tool), op, "{tool}");
        }
        // A shell read with literal operands is a read of those files.
        let read = event(normalize(
            "codex",
            &payload("PreToolUse", "Bash", json!({ "read_paths": ["a", "b"] })),
            "t",
            1,
        ));
        assert_eq!(read.operation, Operation::Read);
        assert_eq!(read.targets.len(), 2);
        let mv = event(normalize(
            "claude",
            &payload("PreToolUse", "move_file", json!({ "from": "a", "to": "b" })),
            "t",
            1,
        ));
        assert_eq!(
            mv.targets.iter().map(|t| t.access).collect::<Vec<_>>(),
            [Access::MoveFrom, Access::MoveTo]
        );
        let cmd = event(normalize(
            "claude",
            &payload("PreToolUse", "Bash", json!({ "path": "x" })),
            "t",
            1,
        ));
        assert!(cmd.targets.is_empty());
    }
}
