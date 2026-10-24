//! Port of `domain/agent-activity-presentation.ts`, `AgentToolRendererRegistry`
//! and `AgentToolGlyph`'s classification, over the native message model
//! (`role` names the tool, `input` is its request, `text` its result).
use crate::agent::domain::agent_session_model::Message;
use serde_json::Value;

/// Transcript part kinds (`AgentPart["kind"]`) the native model can express.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartKind {
    User,
    Assistant,
    Reasoning,
    Plan,
    /// Context compaction; `from_tool` keeps a tool part's compact rhythm.
    Compaction {
        from_tool: bool,
    },
    /// Provider status outside the transcript (`StatusPart`).
    System,
    Tool,
}
impl PartKind {
    /// `isGroupableToolRow`: tool parts that join the tool rail.
    pub fn groupable(self) -> bool {
        self == Self::Tool
    }
}

/// `AgentToolRenderer`: which evidence shape a tool part renders.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Renderer {
    Command,
    FileChange,
    FileQuery,
    Generic,
}

/// `agentToolGlyphKind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Glyph {
    Command,
    Edit,
    Fetch,
    Generic,
    /// `list`: ListTree for `list`, FolderSearch for other list-like tools.
    List {
        tree: bool,
    },
    Read,
    Search,
    Write,
}

pub fn part_kind(message: &Message, assistant_roles: &[&str]) -> PartKind {
    match message.role.as_str() {
        "You" => PartKind::User,
        "Reasoning" => PartKind::Reasoning,
        "Plan" => PartKind::Plan,
        "System" => {
            if is_compaction_text(&message.text) {
                PartKind::Compaction { from_tool: false }
            } else {
                PartKind::System
            }
        }
        role if assistant_roles.contains(&role) => PartKind::Assistant,
        role if is_compaction_text(role) => PartKind::Compaction { from_tool: true },
        _ => PartKind::Tool,
    }
}

/// `isContextCompactionActivity`.
pub fn is_compaction_text(value: &str) -> bool {
    let lower = value.trim().to_lowercase();
    if lower == "compaction" || lower == "context-compaction" {
        return true;
    }
    let words: Vec<&str> = lower.split_whitespace().collect();
    words
        .windows(2)
        .any(|w| w[0].starts_with("compact") && w[1] == "context")
        || words
            .windows(3)
            .any(|w| w[0].starts_with("compact") && w[1] == "the" && w[2] == "context")
        || words
            .windows(2)
            .any(|w| w[0] == "context" && w[1].starts_with("compact"))
}

/// Provider tool names → the product's canonical activity tool (providers
/// normalize names before the renderer; `agentActivityToolId` then maps aliases).
pub fn tool_id(role: &str) -> String {
    let lower = role.trim().to_lowercase();
    let squashed: String = lower
        .chars()
        .filter(|c| !matches!(c, ' ' | '_' | '-'))
        .collect();
    let id = match squashed.as_str() {
        "bash" | "shell" | "command" | "execute" | "exec" | "terminal" | "localshell" => "bash",
        "read" | "readfile" | "view" | "openfile" => "read",
        "write" | "writefile" | "create" | "createfile" => "write",
        "edit" | "multiedit" | "notebookedit" | "applypatch" | "patch" | "strreplace"
        | "strreplaceeditor" | "filechanges" | "filechange" => "edit",
        "glob" | "find" => "glob",
        "grep" => "grep",
        "search" | "websearch" => "search",
        "list" | "ls" | "listfiles" => "list",
        "fetch" | "webfetch" => "fetch",
        "reasoning" | "thinking" => "thinking",
        "plan" | "todowrite" => "plan",
        "tool" => "tool",
        _ => return lower,
    };
    id.into()
}

/// The request as structured JSON when the provider sent JSON, else the raw text.
pub fn input_value(message: &Message) -> Value {
    match message.input.as_deref().map(str::trim) {
        None | Some("") => Value::Null,
        Some(raw) => serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.into())),
    }
}

fn first_text<'a>(values: impl IntoIterator<Item = Option<&'a Value>>) -> String {
    values
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(|s| s.chars().take(64 * 1024).collect())
        .unwrap_or_default()
}

/// `commandForActivity`.
pub fn command(message: &Message) -> String {
    let input = input_value(message);
    if let Value::String(s) = &input {
        return s.trim().into();
    }
    first_text([input.get("command"), input.get("cmd")])
}

/// `commandPresentationForActivity`: read-only shell commands show the glyph
/// of the tool they stand for (rg → Grep, ls → List, cat → Read…).
pub fn command_tool(command: &str) -> &'static str {
    let visible = unwrap_login_shell(command);
    let simple =
        !visible.contains([';', '&', '|', '<', '>', '`', '\n', '\r']) && !visible.contains("$(");
    if !simple {
        return "bash";
    }
    let executable = shell_executable(&visible);
    let has_flag = |flag: &str| {
        visible
            .split_whitespace()
            .any(|w| w == flag || w.starts_with(&format!("{flag}=")))
    };
    match executable.as_str() {
        "rg" if has_flag("--pre") || has_flag("--pre-glob") => "bash",
        "rg" if has_flag("--files") => "glob",
        "rg" | "grep" | "git-grep" => "grep",
        "find"
            if [
                "-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls",
            ]
            .iter()
            .any(|f| visible.split_whitespace().any(|w| w == *f)) =>
        {
            "bash"
        }
        "find" | "fd" => "glob",
        "ls" => "list",
        "cat" | "head" | "tail" | "bat" | "sed-read" | "nl-read" => "read",
        _ => "bash",
    }
}

fn unwrap_login_shell(command: &str) -> String {
    let trimmed = command.trim();
    for shell in ["zsh", "bash", "sh"] {
        let Some(at) = trimmed.find(&format!("{shell} -lc ")) else {
            continue;
        };
        let prefix = &trimmed[..at];
        if !(prefix.is_empty() || (prefix.starts_with('/') && prefix.ends_with('/'))) {
            continue;
        }
        let rest = trimmed[at + shell.len() + 5..].trim();
        for quote in ['"', '\''] {
            if rest.len() >= 2 && rest.starts_with(quote) && rest.ends_with(quote) {
                return rest[1..rest.len() - 1].trim().into();
            }
        }
    }
    trimmed.into()
}

fn shell_executable(source: &str) -> String {
    let source = source.trim();
    let mut words = source.split_whitespace().peekable();
    if words.peek() == Some(&"command") {
        words.next();
    }
    if words.peek() == Some(&"git") {
        let mut probe = words.clone();
        probe.next();
        if probe.next() == Some("grep") {
            return "git-grep".into();
        }
    }
    if words.peek() == Some(&"env") {
        words.next();
    }
    let word = words.find(|w| {
        !(w.contains('=')
            && w.chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_'))
    });
    let Some(word) = word else {
        return String::new();
    };
    let executable = word.rsplit('/').next().unwrap_or(word).to_lowercase();
    let flag = |f: &str| source.split_whitespace().any(|w| w == f);
    if executable == "sed" && flag("-n") {
        return "sed-read".into();
    }
    if executable == "nl" && flag("-ba") {
        return "nl-read".into();
    }
    executable
}

/// The tool this part presents as: commands that stand for a read-only tool
/// borrow its identity (`commandPresentationForActivity`).
pub fn presented_tool(message: &Message) -> String {
    let id = tool_id(&message.role);
    if id == "bash" {
        command_tool(&command(message)).into()
    } else {
        id
    }
}

pub fn renderer(message: &Message) -> Renderer {
    match tool_id(&message.role).as_str() {
        "bash" => Renderer::Command,
        "write" | "edit" => Renderer::FileChange,
        "read" | "glob" | "grep" | "search" | "list" => Renderer::FileQuery,
        _ => Renderer::Generic,
    }
}

/// `agentToolGlyphKind` (on the presented tool).
pub fn glyph(tool: &str) -> Glyph {
    let n: String = tool
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| !matches!(c, ' ' | '_' | '-'))
        .collect();
    match n.as_str() {
        "grep" | "search" | "find" | "filesearch" => Glyph::Search,
        "read" | "readfile" | "view" | "openfile" => Glyph::Read,
        "edit" | "patch" | "applypatch" | "replace" => Glyph::Edit,
        "write" | "writefile" | "create" | "createfile" => Glyph::Write,
        "glob" | "list" | "listfiles" | "foldersearch" => Glyph::List { tree: n == "list" },
        "fetch" | "webfetch" | "browse" => Glyph::Fetch,
        "bash" | "shell" | "command" | "terminal" => Glyph::Command,
        _ => Glyph::Generic,
    }
}

/// `formatAgentToolName`: a catalog key for known tools, else title case.
pub enum ToolName {
    Key(&'static str),
    Literal(String),
}
pub fn tool_name(tool: &str) -> ToolName {
    match tool {
        "bash" => ToolName::Key("agent.tool.bash"),
        "read" => ToolName::Key("agent.tool.read"),
        "write" => ToolName::Key("agent.tool.write"),
        "edit" => ToolName::Key("agent.tool.edit"),
        "glob" => ToolName::Key("agent.tool.glob"),
        "grep" => ToolName::Key("agent.tool.grep"),
        "search" => ToolName::Key("agent.tool.search"),
        "list" => ToolName::Key("agent.tool.list"),
        "fetch" => ToolName::Key("agent.tool.fetch"),
        "thinking" => ToolName::Key("agent.tool.thinking"),
        "plan" => ToolName::Key("agent.tool.plan"),
        "tool" => ToolName::Key("agent.tool.tool"),
        other => ToolName::Literal(title_case(other)),
    }
}
fn title_case(value: &str) -> String {
    let spaced: String = value
        .chars()
        .map(|c| if c == '_' || c == '-' { ' ' } else { c })
        .collect();
    spaced
        .split(' ')
        .map(|w| {
            let mut c = w.chars();
            c.next().map_or(String::new(), |f| {
                f.to_uppercase().collect::<String>() + c.as_str()
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// `structuredInputForActivity`: object input minus fields shown elsewhere.
pub fn structured_input(message: &Message) -> Option<String> {
    let Value::Object(object) = input_value(message) else {
        return None;
    };
    let visible: serde_json::Map<String, Value> = object
        .into_iter()
        .filter(|(k, _)| !["command", "cmd", "patch", "diff", "content"].contains(&k.as_str()))
        .take(20)
        .collect();
    super::agent_tool_evidence::stringify_input(&Value::Object(visible))
}

/// One edited file (`AgentFileChangeSummary`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FileChange {
    pub path: String,
    pub additions: Option<usize>,
    pub deletions: Option<usize>,
    pub diff: String,
    pub blocks: Vec<(Option<String>, Option<String>)>,
}

/// One removed/added run of a unified diff.
type DiffBlock = (Option<String>, Option<String>);

/// Removed/added runs of a unified diff, with line counts.
fn diff_blocks(diff: &str) -> (Vec<DiffBlock>, usize, usize) {
    let (mut blocks, mut removed, mut added) = (Vec::new(), Vec::<&str>::new(), Vec::<&str>::new());
    let (mut additions, mut deletions) = (0, 0);
    let flush = |blocks: &mut Vec<_>, removed: &mut Vec<&str>, added: &mut Vec<&str>| {
        if !removed.is_empty() || !added.is_empty() {
            blocks.push((
                (!removed.is_empty()).then(|| removed.join("\n")),
                (!added.is_empty()).then(|| added.join("\n")),
            ));
            removed.clear();
            added.clear();
        }
    };
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if let Some(text) = line.strip_prefix('-') {
            if !added.is_empty() {
                flush(&mut blocks, &mut removed, &mut added);
            }
            removed.push(text);
            deletions += 1;
        } else if let Some(text) = line.strip_prefix('+') {
            added.push(text);
            additions += 1;
        } else {
            flush(&mut blocks, &mut removed, &mut added);
        }
    }
    flush(&mut blocks, &mut removed, &mut added);
    (blocks, additions, deletions)
}

fn line_count(text: &str) -> usize {
    if text.is_empty() {
        0
    } else {
        text.lines().count().max(1)
    }
}

/// `fileChangesForActivity` for the native shapes: Codex `File changes`
/// (`path\ndiff` per file) and edit/write tools with old/new or content input.
pub fn file_changes(message: &Message) -> Vec<FileChange> {
    if message.role == "File changes" {
        let mut changes: Vec<FileChange> = Vec::new();
        let mut current: Option<(String, Vec<&str>)> = None;
        for line in message.text.lines() {
            let diff_line = line.starts_with(['+', '-', ' ', '@', '\\']) || line.is_empty();
            match &mut current {
                Some((_, body)) if diff_line => body.push(line),
                _ => {
                    if let Some((path, body)) = current.take() {
                        changes.push(change_from_diff(path, &body.join("\n")));
                    }
                    current = Some((line.trim().into(), Vec::new()));
                }
            }
        }
        if let Some((path, body)) = current {
            changes.push(change_from_diff(path, &body.join("\n")));
        }
        return changes
            .into_iter()
            .filter(|c| !c.path.is_empty())
            .take(100)
            .collect();
    }
    let input = input_value(message);
    let path = first_text(
        ["path", "file", "filepath", "file_path", "filePath"]
            .iter()
            .map(|k| input.get(k)),
    );
    if path.is_empty() {
        return vec![];
    }
    let text = |keys: &[&str]| {
        keys.iter()
            .find_map(|k| input.get(*k).and_then(Value::as_str))
            .map(str::to_owned)
    };
    let old = text(&["old_string", "oldText", "old_str", "old"]);
    let new = text(&["new_string", "newText", "new_str", "new"]).or_else(|| text(&["content"]));
    if let Some(patch) = text(&["patch", "diff"]) {
        return vec![change_from_diff(path, &patch)];
    }
    if old.is_none() && new.is_none() {
        return vec![FileChange {
            path,
            ..Default::default()
        }];
    }
    vec![FileChange {
        path,
        deletions: Some(old.as_deref().map_or(0, line_count)),
        additions: Some(new.as_deref().map_or(0, line_count)),
        diff: String::new(),
        blocks: vec![(old, new)],
    }]
}

fn change_from_diff(path: String, diff: &str) -> FileChange {
    let (blocks, additions, deletions) = diff_blocks(diff);
    FileChange {
        path,
        additions: Some(additions),
        deletions: Some(deletions),
        diff: diff.into(),
        blocks,
    }
}

/// `fileChangeTotals`: only when every file reports both counts.
pub fn file_change_totals(changes: &[FileChange]) -> Option<(usize, usize)> {
    if changes.is_empty() {
        return None;
    }
    changes.iter().try_fold((0, 0), |(a, d), c| {
        Some((a + c.additions?, d + c.deletions?))
    })
}

/// `formatAgentDuration`: catalog key and value parts ("< 1s", "2m 5s").
pub fn duration_parts(ms: u64) -> Vec<(&'static str, u64)> {
    if ms < 1_000 {
        return vec![("agent.duration.lessThanSecond", 0)];
    }
    let mut seconds = ((ms as f64) / 1_000.).round().max(1.) as u64;
    let days = seconds / 86_400;
    seconds %= 86_400;
    let hours = seconds / 3_600;
    seconds %= 3_600;
    let minutes = seconds / 60;
    seconds %= 60;
    let mut parts = vec![];
    if days > 0 {
        parts.push(("agent.duration.days", days));
    }
    if hours > 0 {
        parts.push(("agent.duration.hours", hours));
    }
    if minutes > 0 {
        parts.push(("agent.duration.minutes", minutes));
    }
    if seconds > 0 || (days == 0 && hours == 0 && minutes == 0) {
        parts.push(("agent.duration.seconds", seconds));
    }
    parts
}

/// Status families of `AgentActivityShell`'s trailing icon.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityStatus {
    Running,
    Completed,
    Failed,
    Stopped,
    Waiting,
    Unknown,
}
pub fn activity_status(status: &str) -> ActivityStatus {
    match status {
        "running" | "pending" | "in-progress" | "in_progress" | "inProgress" => {
            ActivityStatus::Running
        }
        "failed" | "warning" | "blocked" | "error" | "declined" => ActivityStatus::Failed,
        "completed" | "succeeded" | "success" | "" => ActivityStatus::Completed,
        "cancelled" | "canceled" | "interrupted" => ActivityStatus::Stopped,
        "queued" | "waiting-for-user" => ActivityStatus::Waiting,
        _ => ActivityStatus::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tool(role: &str, input: Option<&str>, text: &str) -> Message {
        Message {
            id: "t".into(),
            role: role.into(),
            text: text.into(),
            status: "completed".into(),
            input: input.map(Into::into),
        }
    }
    #[test]
    fn read_only_shell_commands_present_as_their_tool() {
        assert_eq!(command_tool("rg -n padding src"), "grep");
        assert_eq!(command_tool("rg --files src"), "glob");
        assert_eq!(command_tool("/bin/zsh -lc \"rg -n x dev\""), "grep");
        assert_eq!(command_tool("ls -la"), "list");
        assert_eq!(command_tool("sed -n 1,10p a.rs"), "read");
        assert_eq!(command_tool("cat a | wc -l"), "bash");
        assert_eq!(command_tool("find . -delete"), "bash");
        assert_eq!(command_tool("cargo test"), "bash");
        let rg = tool("Command", Some("rg -n padding src"), "");
        assert_eq!(presented_tool(&rg), "grep");
        assert_eq!(glyph(&presented_tool(&rg)), Glyph::Search);
        assert_eq!(renderer(&rg), Renderer::Command);
    }
    #[test]
    fn provider_tool_names_map_to_product_tools() {
        assert_eq!(tool_id("Bash"), "bash");
        assert_eq!(tool_id("MultiEdit"), "edit");
        assert_eq!(tool_id("File changes"), "edit");
        assert_eq!(tool_id("WebFetch"), "fetch");
        assert_eq!(tool_id("mcp__linear"), "mcp__linear");
        assert_eq!(glyph("read"), Glyph::Read);
        assert_eq!(glyph("list"), Glyph::List { tree: true });
        assert_eq!(glyph("glob"), Glyph::List { tree: false });
        assert!(matches!(
            tool_name("grep"),
            ToolName::Key("agent.tool.grep")
        ));
        assert!(matches!(tool_name("mcp_tool"), ToolName::Literal(ref s) if s == "Mcp Tool"));
    }
    #[test]
    fn file_changes_come_from_codex_diffs_and_edit_inputs() {
        let codex = tool(
            "File changes",
            None,
            "src/a.css\n@@ -1,1 +1,1 @@\n-  padding: 12px;\n+  padding: 24px;\nsrc/b.css\n@@ -3 +3 @@\n+x",
        );
        let changes = file_changes(&codex);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].path, "src/a.css");
        assert_eq!(
            changes[0].blocks,
            vec![(
                Some("  padding: 12px;".into()),
                Some("  padding: 24px;".into())
            )]
        );
        assert_eq!(file_change_totals(&changes), Some((2, 1)));
        let edit = tool(
            "Edit",
            Some(r#"{"file_path":"a.rs","old_string":"a","new_string":"b\nc"}"#),
            "ok",
        );
        assert_eq!(file_changes(&edit)[0].additions, Some(2));
        assert_eq!(file_changes(&edit)[0].path, "a.rs");
    }
    #[test]
    fn durations_follow_the_product_format() {
        assert_eq!(
            duration_parts(400),
            vec![("agent.duration.lessThanSecond", 0)]
        );
        assert_eq!(duration_parts(2_400), vec![("agent.duration.seconds", 2)]);
        assert_eq!(
            duration_parts(125_000),
            vec![("agent.duration.minutes", 2), ("agent.duration.seconds", 5)]
        );
        assert_eq!(duration_parts(3_600_000), vec![("agent.duration.hours", 1)]);
    }
    #[test]
    fn compaction_is_recognised_from_tools_and_system_text() {
        assert!(is_compaction_text("Compacted context"));
        assert!(is_compaction_text("compaction"));
        assert!(is_compaction_text("Conversation context compacted"));
        assert!(!is_compaction_text("Compact"));
        let m = tool("compaction", None, "");
        assert_eq!(part_kind(&m, &[]), PartKind::Compaction { from_tool: true });
    }
}
