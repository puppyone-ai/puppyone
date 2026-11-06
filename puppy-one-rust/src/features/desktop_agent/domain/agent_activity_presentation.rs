//! `domain/agent-activity-presentation.ts`: how a display activity
//! (`AgentActivity`) reads as a tool, command, file change or output.
use super::agent_tool_evidence::stringify_agent_tool_input;
use crate::agent::contract::js;
use crate::localization::{Arg, format_number, t, tf};
use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

/// `AgentFileChangeSummary`.
#[derive(Clone, Debug, PartialEq)]
pub struct AgentFileChangeSummary {
    pub path: String,
    pub additions: Option<i64>,
    pub deletions: Option<i64>,
    pub diff: String,
    /// `{ removed?, added? }` blocks.
    pub blocks: Vec<(Option<String>, Option<String>)>,
    pub truncated: bool,
}

/// `record(value)`: an object, or an empty one.
fn record(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

/// `text(value)`.
fn text(value: &Value) -> String {
    value
        .as_str()
        .map(|s| js::trim(s).to_string())
        .unwrap_or_default()
}

/// `firstText(...values)`.
fn first_text(values: &[&Value]) -> String {
    for value in values {
        if let Some(string) = value.as_str()
            && !js::trim(string).is_empty()
        {
            return js::head16(js::trim(string), 64 * 1024).to_string();
        }
    }
    String::new()
}

/// A string property as is (`activity.label`).
fn text_of(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

fn get<'a>(map: &'a Map<String, Value>, key: &str) -> &'a Value {
    map.get(key).unwrap_or(&Value::Null)
}

/// `agentActivityToolId(activity)`.
pub fn agent_activity_tool_id(activity: &Value) -> String {
    let detail_tool = &activity["detail"]["tool"];
    let source = if js::truthy(detail_tool) {
        detail_tool
    } else {
        &activity["kind"]
    };
    let tool = text(source).to_lowercase();
    let known = match tool.as_str() {
        "bash" | "shell" | "command" => "bash",
        "read" => "read",
        "write" => "write",
        "edit" | "apply_patch" | "patch" | "file-change" => "edit",
        "glob" => "glob",
        "grep" => "grep",
        "search" | "websearch" => "search",
        "list" => "list",
        "webfetch" => "fetch",
        "reasoning" => "thinking",
        "plan" => "plan",
        _ => "",
    };
    if !known.is_empty() {
        return known.into();
    }
    if tool.is_empty() { "tool".into() } else { tool }
}

/// `agentActivityToolName(activity)`: the legacy English presentation the
/// classification suites read. Product UI uses [`format_agent_tool_name`].
pub fn agent_activity_tool_name(activity: &Value) -> String {
    let id = agent_activity_tool_id(activity);
    let known = match id.as_str() {
        "bash" => "Bash",
        "read" => "Read",
        "write" => "Write",
        "edit" => "Edit",
        "glob" => "Glob",
        "grep" => "Grep",
        "search" => "Search",
        "list" => "List",
        "fetch" => "Fetch",
        "thinking" => "Thinking",
        "plan" => "Plan",
        "tool" => "Tool",
        _ => "",
    };
    if known.is_empty() {
        title_case(&id)
    } else {
        known.into()
    }
}

const KNOWN_TOOLS: &[&str] = &[
    "bash", "read", "write", "edit", "glob", "grep", "search", "list", "fetch", "thinking", "plan",
    "tool",
];

/// `formatAgentToolName(tool, t)`.
pub fn format_agent_tool_name(tool: &str) -> String {
    if KNOWN_TOOLS.contains(&tool) {
        t(&format!("agent.tool.{tool}")).to_string()
    } else {
        title_case(tool)
    }
}

/// `formatAgentActivityLabel(activity, t)`.
pub fn format_agent_activity_label(activity: &Value) -> String {
    if let Some(label) = activity["label"].as_str().filter(|l| !l.is_empty()) {
        return label.to_string();
    }
    if activity["labelCode"] == "file-changes" {
        let count = activity["detail"]["changes"].as_array().map_or(0, Vec::len) as i64;
        return tf(
            "agent.activity.fileChanges",
            &[("count", Arg::Number(count))],
        );
    }
    let code = activity["labelCode"].as_str().unwrap_or("tool-activity");
    t(&format!("agent.activity.{code}")).to_string()
}

/// `agentActivitySummary(activity)`.
pub fn agent_activity_summary(activity: &Value) -> String {
    let label = &activity["label"];
    if activity["kind"] == "command" {
        let command = command_for_activity(activity);
        return if command.is_empty() {
            text_of(label)
        } else {
            command
        };
    }
    if activity["kind"] == "file-change" {
        let path = path_for_activity(activity);
        return if path.is_empty() {
            text_of(label)
        } else {
            path
        };
    }
    let detail = &activity["detail"];
    let input = record(&detail["input"]);
    let tool = agent_activity_tool_id(activity);
    if ["grep", "glob", "search"].contains(&tool.as_str()) {
        return first_text(&[
            get(&input, "pattern"),
            &detail["query"],
            get(&input, "query"),
            &detail["path"],
            get(&input, "path"),
            label,
        ]);
    }
    first_text(&[
        &detail["description"],
        &detail["path"],
        get(&input, "path"),
        get(&input, "file"),
        get(&input, "file_path"),
        get(&input, "filePath"),
        &detail["query"],
        get(&input, "query"),
        get(&input, "pattern"),
        label,
    ])
}

/// `isContextCompactionActivity(activity)`.
pub fn is_context_compaction_activity(activity: &Value) -> bool {
    static EXACT: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(?:compaction|context-compaction)$").expect("exact"));
    static PHRASE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(?:compact(?:ed|ing|ion)?\s+(?:the\s+)?context|context\s+compact)")
            .expect("phrase")
    });
    let detail = &activity["detail"];
    let input = record(&detail["input"]);
    [
        &detail["tool"],
        &detail["kind"],
        &detail["description"],
        get(&input, "action"),
        &activity["label"],
    ]
    .into_iter()
    .map(text)
    .filter(|value| !value.is_empty())
    .any(|value| EXACT.is_match(&value.to_lowercase()) || PHRASE.is_match(&value))
}

/// `commandForActivity(activity)`.
pub fn command_for_activity(activity: &Value) -> String {
    let detail = &activity["detail"];
    let input = record(&detail["input"]);
    let metadata = record(&detail["metadata"]);
    let raw_input = if detail["input"].is_string() {
        detail["input"].clone()
    } else {
        Value::from("")
    };
    first_text(&[
        &detail["command"],
        get(&input, "command"),
        get(&input, "cmd"),
        get(&metadata, "command"),
        &raw_input,
    ])
}

/// `visibleCommandForActivity(activity)`: the command as the user would have
/// typed it, without a login-shell wrapper.
pub fn visible_command_for_activity(activity: &Value) -> String {
    unwrap_login_shell(&command_for_activity(activity))
}

/// `AgentCommandPresentation`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentCommandPresentation {
    pub tool: &'static str,
    pub title: &'static str,
    pub summary: String,
    pub via_shell: bool,
}

/// `commandPresentationForActivity(activity)`.
pub fn command_presentation_for_activity(activity: &Value) -> AgentCommandPresentation {
    static UNSAFE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[;&|<>`\n\r]").expect("unsafe"));
    static PRE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?:^|\s)--pre(?:-glob)?(?:\s|=|$)").expect("pre"));
    static FILES: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?:^|\s)--files(?:\s|$)").expect("files"));
    static FIND_ACTION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fprint|fprintf|fls)(?:\s|$)")
            .expect("find")
    });
    let command = command_for_activity(activity);
    let visible = unwrap_login_shell(&command);
    let executable = read_shell_executable(&visible);
    let bash = || AgentCommandPresentation {
        tool: "bash",
        title: "Bash",
        summary: if command.is_empty() {
            text_of(&activity["label"])
        } else {
            command.clone()
        },
        via_shell: false,
    };
    let shell = |tool: &'static str, title: &'static str| AgentCommandPresentation {
        tool,
        title,
        summary: visible.clone(),
        via_shell: true,
    };
    let simple_read_only = !UNSAFE.is_match(&visible) && !visible.contains("$(");
    if !simple_read_only {
        return bash();
    }
    match executable.as_str() {
        "rg" => {
            if PRE.is_match(&visible) {
                return bash();
            }
            if FILES.is_match(&visible) {
                shell("glob", "Glob")
            } else {
                shell("grep", "Grep")
            }
        }
        "grep" | "git-grep" => shell("grep", "Grep"),
        "find" | "fd" => {
            if executable == "find" && FIND_ACTION.is_match(&visible) {
                return bash();
            }
            shell("glob", "Glob")
        }
        "ls" => shell("list", "List"),
        "cat" | "head" | "tail" | "bat" | "sed-read" | "nl-read" => shell("read", "Read"),
        _ => bash(),
    }
}

/// `pathForActivity(activity)`.
pub fn path_for_activity(activity: &Value) -> String {
    let detail = &activity["detail"];
    let input = record(&detail["input"]);
    let first_change = file_changes_for_activity(activity)
        .into_iter()
        .next()
        .map_or(Value::Null, |change| Value::from(change.path));
    first_text(&[
        &detail["path"],
        get(&input, "path"),
        get(&input, "file"),
        get(&input, "filepath"),
        get(&input, "file_path"),
        get(&input, "filePath"),
        &first_change,
    ])
}

/// `outputForActivity(activity)`.
pub fn output_for_activity(activity: &Value) -> String {
    let detail = &activity["detail"];
    let result = Value::from(canonical_tool_result_text(&detail["result"]));
    let nested = if detail["detail"].is_string() {
        detail["detail"].clone()
    } else {
        Value::from("")
    };
    first_text(&[
        &activity["output"],
        &detail["outputPreview"],
        &result,
        &detail["content"],
        &detail["error"],
        &nested,
    ])
}

fn canonical_tool_result_text(value: &Value) -> String {
    let result = record(value);
    let content = get(&result, "content")
        .as_array()
        .cloned()
        .unwrap_or_default();
    let rendered: Vec<String> = content
        .iter()
        .take(100)
        .flat_map(|entry| {
            let item = record(entry);
            match get(&item, "type").as_str() {
                Some("text") => vec![text(get(&item, "text"))],
                Some("artifact") => vec![first_text(&[get(&item, "text"), get(&item, "uri")])],
                Some("json") if item.contains_key("value") => {
                    serde_json::to_string_pretty(get(&item, "value"))
                        .into_iter()
                        .collect()
                }
                _ => Vec::new(),
            }
        })
        .filter(|entry| !entry.is_empty())
        .collect();
    let rendered = Value::from(rendered.join("\n"));
    first_text(&[&rendered, get(&result, "error")])
}

/// `commandMetadata(activity)`: `{ exitCode, durationMs }`.
pub fn command_metadata(activity: &Value) -> (Option<f64>, Option<f64>) {
    let detail = &activity["detail"];
    let metadata = record(&detail["metadata"]);
    let finite = |values: &[&Value]| values.iter().find_map(|value| js::finite_number(value));
    (
        finite(&[
            &detail["exitCode"],
            get(&metadata, "exitCode"),
            get(&metadata, "exit"),
            get(&metadata, "code"),
        ]),
        finite(&[
            &detail["duration"],
            &detail["durationMs"],
            &detail["elapsedMs"],
            get(&metadata, "duration"),
            get(&metadata, "durationMs"),
            get(&metadata, "elapsed"),
        ]),
    )
}

/// `formatAgentDuration(value, t, formatNumber)`.
pub fn format_agent_duration(value: f64) -> String {
    let bounded = if value.is_finite() { value.max(0.) } else { 0. };
    if bounded < 1_000. {
        return t("agent.duration.lessThanSecond").to_string();
    }
    let mut seconds = ((bounded / 1_000.).round() as i64).max(1);
    let days = seconds / 86_400;
    seconds %= 86_400;
    let hours = seconds / 3_600;
    seconds %= 3_600;
    let minutes = seconds / 60;
    seconds %= 60;
    let unit = |key: &str, value: i64| tf(key, &[("value", Arg::Text(format_number(value)))]);
    let mut parts = Vec::new();
    if days > 0 {
        parts.push(unit("agent.duration.days", days));
    }
    if hours > 0 {
        parts.push(unit("agent.duration.hours", hours));
    }
    if minutes > 0 {
        parts.push(unit("agent.duration.minutes", minutes));
    }
    if seconds > 0 || (days == 0 && hours == 0 && minutes == 0) {
        parts.push(unit("agent.duration.seconds", seconds));
    }
    parts.join(" ")
}

/// `fileChangesForActivity(activity)`.
pub fn file_changes_for_activity(activity: &Value) -> Vec<AgentFileChangeSummary> {
    let Some(changes) = activity["detail"]["changes"].as_array() else {
        return Vec::new();
    };
    changes
        .iter()
        .take(100)
        .filter_map(|entry| {
            let value = record(entry);
            let path = first_text(&[
                get(&value, "path"),
                get(&value, "file"),
                get(&value, "filepath"),
            ]);
            if path.is_empty() {
                return None;
            }
            let count = |key: &str| js::finite_number(get(&value, key)).map(bounded_count);
            Some(AgentFileChangeSummary {
                path: js::head16(&path, 4_096).to_string(),
                additions: count("additions"),
                deletions: count("deletions"),
                diff: get(&value, "diff").as_str().unwrap_or_default().to_string(),
                blocks: get(&value, "blocks")
                    .as_array()
                    .map(|blocks| {
                        blocks
                            .iter()
                            .take(100)
                            .filter_map(|block| {
                                let removed = block["removed"].as_str().map(str::to_string);
                                let added = block["added"].as_str().map(str::to_string);
                                (removed.is_some() || added.is_some()).then_some((removed, added))
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                truncated: get(&value, "truncated") == &Value::Bool(true),
            })
        })
        .collect()
}

/// `fileChangeTotals(changes)`: `(additions, deletions)` when every change
/// reports both.
pub fn file_change_totals(changes: &[AgentFileChangeSummary]) -> Option<(i64, i64)> {
    if changes.is_empty()
        || changes
            .iter()
            .any(|c| c.additions.is_none() || c.deletions.is_none())
    {
        return None;
    }
    Some(changes.iter().fold((0, 0), |(added, removed), change| {
        (
            added + change.additions.unwrap_or(0),
            removed + change.deletions.unwrap_or(0),
        )
    }))
}

/// `structuredInputForActivity(activity)`.
pub fn structured_input_for_activity(activity: &Value) -> Option<String> {
    let input = activity["detail"]["input"].as_object()?;
    let visible: Map<String, Value> = input
        .iter()
        .filter(|(key, _)| !["command", "cmd", "patch", "diff", "content"].contains(&key.as_str()))
        .take(20)
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    stringify_agent_tool_input(&Value::Object(visible))
}

fn bounded_count(value: f64) -> i64 {
    value.trunc().clamp(0., 1_000_000.) as i64
}

/// `titleCase(value)`: `_`/`-` runs become spaces and each ASCII word starts
/// upper-case.
fn title_case(value: &str) -> String {
    static SEPARATORS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[_-]+").expect("separators"));
    let spaced = SEPARATORS.replace_all(value, " ");
    let mut previous_word = false;
    spaced
        .chars()
        .map(|c| {
            let word = c.is_ascii_alphanumeric() || c == '_';
            let next = if word && !previous_word {
                c.to_ascii_uppercase()
            } else {
                c
            };
            previous_word = word;
            next
        })
        .collect()
}

/// `unwrapLoginShell(command)`.
fn unwrap_login_shell(command: &str) -> String {
    static LOGIN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"^(?:/[^\s]+/)?(?:zsh|bash|sh)\s+-lc\s+(?:"([\s\S]*)"|'([\s\S]*)')$"#)
            .expect("login")
    });
    let trimmed = js::trim(command);
    LOGIN
        .captures(trimmed)
        .and_then(|captures| captures.get(1).or_else(|| captures.get(2)))
        .map(|inner| inner.as_str())
        .filter(|inner| !inner.is_empty())
        .map_or_else(|| trimmed.to_string(), |inner| js::trim(inner).to_string())
}

/// `readShellExecutable(command)`.
fn read_shell_executable(command: &str) -> String {
    static GIT_GREP: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(?:command\s+)?git\s+grep(?:\s|$)").expect("git"));
    static EXECUTABLE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(?:command\s+)?(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*(?:/[^\s]+/)?([A-Za-z0-9._+-]+)(?:\s|$)")
            .expect("executable")
    });
    static N_FLAG: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?:^|\s)-n(?:\s|$)").expect("n"));
    static BA_FLAG: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?:^|\s)-ba(?:\s|$)").expect("ba"));
    let source = js::trim(command);
    if source.is_empty() {
        return String::new();
    }
    if GIT_GREP.is_match(source) {
        return "git-grep".into();
    }
    let executable = EXECUTABLE
        .captures(source)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().to_lowercase())
        .unwrap_or_default();
    if executable == "sed" && N_FLAG.is_match(source) {
        return "sed-read".into();
    }
    if executable == "nl" && BA_FLAG.is_match(source) {
        return "nl-read".into();
    }
    executable
}
