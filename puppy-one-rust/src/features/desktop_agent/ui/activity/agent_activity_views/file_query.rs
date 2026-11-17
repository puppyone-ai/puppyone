//! `AgentFileQueryActivity`: reads, searches and listings, and the paths
//! their results name.
use super::*;

/// `AgentFileQueryActivity`.
pub(super) fn file_query_shell(activity: &Part) -> ActivityShell {
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
        if NO_RESULTS.is_match(text::trim(&output)) {
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

fn first_trimmed(values: &[Option<&str>]) -> String {
    values
        .iter()
        .flatten()
        .map(|value| text::trim(value))
        .find(|v| !v.is_empty())
        .unwrap_or_default()
        .to_string()
}

/// `fileQuerySubject(activity, stepKind, t)`.
fn file_query_subject(activity: &Part, step_kind: AgentToolStepKind) -> Option<StepSubject> {
    let detail = &activity.detail;
    let input = detail.record("input").unwrap_or_else(RecordRef::empty);
    if step_kind == AgentToolStepKind::Search {
        let pattern = first_trimmed(&[
            input.text("pattern"),
            detail.text("query"),
            input.text("query"),
            input.text("glob"),
        ]);
        let scope = first_trimmed(&[input.text("path"), detail.text("path")]);
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
    let plain = text::trim(line);
    (!plain.is_empty() && !plain.contains('\0') && !URL.is_match(plain)).then(|| plain.to_string())
}
