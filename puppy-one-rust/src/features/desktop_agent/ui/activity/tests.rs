//! `tool-rendering.test.ts`: what each tool activity shows, through the
//! activity view model the transcript draws.
use super::agent_activity_views::{
    ActivityShell, ActivityView, EvidenceContent, EvidenceTone, ShellDetail, StepMetadata,
    StepSubject, activity_view,
};
use crate::agent::contract::dto::Part;
use core::prelude::v1::test;
use serde_json::{Value, json};

fn part(activity: Value) -> Part {
    serde_json::from_value(activity).unwrap()
}

fn shell(activity: Value) -> ActivityShell {
    crate::localization::set_current("en");
    match activity_view(&part(activity)) {
        ActivityView::Shell(shell) => *shell,
        other => panic!("a step line: {other:?}"),
    }
}

fn evidence(shell: &ActivityShell) -> Vec<(Option<&'static str>, Option<EvidenceTone>, String)> {
    let ShellDetail::Evidence(nodes) = &shell.detail else {
        panic!("evidence")
    };
    nodes
        .iter()
        .map(|node| {
            let text = match &node.content {
                EvidenceContent::Text(text) | EvidenceContent::FilePath(text) => text.clone(),
                EvidenceContent::Empty(text) => text.clone(),
                EvidenceContent::SearchResults(lines) => lines.lines.join("\n"),
            };
            (node.marker, node.tone, text)
        })
        .collect()
}

/// `renders Bash activity as one step line with a bounded expandable
/// transcript`; `presents conservative read-only shell commands as the step
/// they perform`.
#[test]
fn a_command_is_one_step_line_with_its_command_and_output() {
    let ran = shell(
        json!({"id": "command-1", "turnId": "turn-1", "itemId": "tool-1", "kind": "command",
        "label": "Run tests", "status": "completed", "output": "25 files passed", "sequence": 1,
        "detail": {"tool": "bash", "input": {"command": "npm test"}, "metadata": {"exitCode": 0, "duration": 842}}}),
    );
    assert_eq!(ran.title, "Ran");
    assert_eq!(ran.subject, Some(StepSubject::code("npm test", None)));
    assert!(!ran.default_expanded);
    let nodes = evidence(&ran);
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].0, Some("$"));
    assert_eq!(nodes[0].2, "npm test");
    assert!(nodes[1].2.contains("25 files passed"));
    assert!(
        ran.metadata.is_none(),
        "no exit code or duration on the line"
    );
    let searched = shell(
        json!({"id": "command-search", "turnId": "turn-1", "itemId": "tool-search", "kind": "command",
        "label": "Search repository", "status": "completed", "output": "src/App.tsx:12:liangyu", "sequence": 1,
        "detail": {"tool": "bash", "command": "/bin/zsh -lc \"rg -n -i liangyu src\"", "exitCode": 0}}),
    );
    assert_eq!(searched.title, "Searched");
    assert_eq!(
        searched.subject,
        Some(StepSubject::code("rg -n -i liangyu src", None)),
        "the login shell wrapper is provenance"
    );
    assert!(evidence(&searched)[0].2.contains("rg -n -i liangyu src"));
}

/// `renders native Grep as a dedicated bounded result disclosure`; `mounts
/// at most eighty searchable result elements`.
#[test]
fn a_search_names_its_pattern_place_and_results() {
    let grep = shell(
        json!({"id": "grep-1", "turnId": "turn-1", "itemId": "tool-grep", "kind": "tool",
        "label": "Find liangyu", "status": "completed", "output": "src/a.ts:3:liangyu\nsrc/b.ts:8:LIANGYU", "sequence": 1,
        "detail": {"tool": "grep", "input": {"pattern": "liangyu", "path": "src"}}}),
    );
    assert_eq!(grep.title, "Searched");
    assert_eq!(
        grep.subject,
        Some(StepSubject::Code {
            text: "liangyu".into(),
            context: Some("in src".into())
        })
    );
    assert_eq!(grep.metadata, Some(StepMetadata::Facts("2 results".into())));
    let ShellDetail::Evidence(nodes) = &grep.detail else {
        panic!("evidence")
    };
    let EvidenceContent::SearchResults(lines) = &nodes[0].content else {
        panic!("results")
    };
    assert_eq!(lines.lines.len(), 2);
    assert_eq!(
        super::agent_activity_views::result_path(&lines.lines[0]).as_deref(),
        Some("src/a.ts")
    );
    let output: Vec<String> = (0..1_000)
        .map(|index| format!("src/file-{index}.ts:{}:match", index + 1))
        .collect();
    let large = shell(
        json!({"id": "grep-large", "turnId": "turn-large", "itemId": "grep-large", "kind": "tool",
        "label": "Large search", "status": "completed", "output": output.join("\n"), "sequence": 1,
        "detail": {"tool": "grep", "input": {"pattern": "match"}}}),
    );
    let ShellDetail::Evidence(nodes) = &large.detail else {
        panic!("evidence")
    };
    let EvidenceContent::SearchResults(lines) = &nodes[0].content else {
        panic!("results")
    };
    assert_eq!(lines.lines.len(), 80);
    assert_eq!(lines.total_lines, 1_000);
}

/// `renders Write/Edit activity through shared evidence without row action
/// clutter`; `preserves added / removed blank line and separate
/// replacements without inventing an absent side`; `keeps a failed edit's
/// output visible without inventing zero line counts`; `does not render a
/// generic File Change row without a real change`.
#[test]
fn an_edit_shows_its_file_its_line_counts_and_only_the_sides_it_has() {
    let edit = shell(
        json!({"id": "edit-1", "turnId": "turn-1", "itemId": "tool-2", "kind": "file-change",
        "label": "Updated app.ts", "status": "completed", "output": "", "sequence": 1,
        "detail": {"tool": "edit", "path": "src/app.ts", "changes": [{"path": "src/app.ts", "additions": 2, "deletions": 1,
            "blocks": [{"removed": "old", "added": "new\nextra"}], "diff": "@@ -1,2 +1,3 @@\n-old\n+new\n+extra\n context"}]}}),
    );
    assert_eq!(edit.title, "Edited");
    assert_eq!(
        edit.metadata,
        Some(StepMetadata::DiffStats {
            additions: "+2".into(),
            deletions: "−1".into()
        })
    );
    let nodes = evidence(&edit);
    assert!(
        nodes.iter().any(|n| n.2.contains("src/app.ts")),
        "the file path"
    );
    assert!(nodes.contains(&(Some("−"), Some(EvidenceTone::Deletion), "old".into())));
    assert!(nodes.contains(&(Some("+"), Some(EvidenceTone::Addition), "new\nextra".into())));
    assert!(
        nodes.iter().all(|n| !n.2.contains("@@")),
        "no raw hunk header"
    );
    for (blocks, expected) in [
        (json!([{"added": ""}]), vec![(EvidenceTone::Addition, "")]),
        (json!([{"removed": ""}]), vec![(EvidenceTone::Deletion, "")]),
        (
            json!([{"removed": "first", "added": "next"}, {"removed": "second", "added": "last"}]),
            vec![
                (EvidenceTone::Deletion, "first"),
                (EvidenceTone::Addition, "next"),
                (EvidenceTone::Deletion, "second"),
                (EvidenceTone::Addition, "last"),
            ],
        ),
    ] {
        let edit = shell(
            json!({"id": "edit-blocks", "turnId": "turn", "itemId": "edit", "kind": "file-change",
            "label": "Edit", "status": "completed", "output": "", "sequence": 1,
            "detail": {"tool": "edit", "changes": [{"path": "src/file.ts", "blocks": blocks, "diff": "raw fallback"}]}}),
        );
        let toned: Vec<_> = evidence(&edit)
            .into_iter()
            .filter_map(|(_, tone, text)| tone.map(|tone| (tone, text)))
            .collect();
        let expected: Vec<_> = expected
            .into_iter()
            .map(|(tone, text)| (tone, text.to_owned()))
            .collect();
        assert_eq!(toned, expected);
        assert!(
            evidence(&edit)
                .iter()
                .all(|n| !n.2.contains("raw fallback"))
        );
    }
    let failed = shell(
        json!({"id": "failed-edit", "turnId": "turn", "itemId": "edit", "kind": "file-change",
        "label": "Edit", "status": "failed", "output": "Permission denied", "sequence": 1,
        "detail": {"tool": "edit", "changes": [{"path": "src/file.ts", "diff": "-old\n+new",
            "blocks": [{"removed": "old", "added": "new"}], "basis": "request"}]}}),
    );
    let nodes = evidence(&failed);
    assert!(nodes.iter().any(|n| n.2.contains("Permission denied")));
    assert!(nodes.contains(&(Some("−"), Some(EvidenceTone::Deletion), "old".into())));
    assert!(failed.metadata.is_none(), "no invented line counts");
    let empty = part(
        json!({"id": "empty-change", "turnId": "turn-1", "itemId": "session-diff", "kind": "file-change",
        "label": "File changes", "status": "completed", "output": "", "sequence": 1, "detail": {"changes": []}}),
    );
    assert_eq!(activity_view(&empty), ActivityView::Hidden);
}

/// `keeps Read activity compact and reveals output without a redundant row
/// action`; `mounts a bounded tool preview instead of the complete provider
/// output`.
#[test]
fn a_read_reveals_its_output_and_large_output_is_a_bounded_preview() {
    let read = shell(
        json!({"id": "read-1", "turnId": "turn-1", "itemId": "tool-read", "kind": "tool",
        "label": "Read composer", "status": "completed", "output": "export function AgentComposer() {}", "sequence": 1,
        "detail": {"tool": "read", "input": {"path": "src/features/desktop-agent/ui/AgentComposer.tsx"}}}),
    );
    assert_eq!(read.title, "Read");
    assert!(
        evidence(&read)
            .iter()
            .any(|n| n.2.contains("export function AgentComposer"))
    );
    let output: Vec<String> = (0..10_000).map(|index| format!("line-{index}")).collect();
    let large = shell(
        json!({"id": "command-large", "turnId": "turn-large", "itemId": "tool-large", "kind": "command",
        "label": "Large output", "status": "completed", "output": output.join("\n"), "sequence": 1,
        "detail": {"tool": "bash", "command": "generate-output"}}),
    );
    use crate::features::desktop_agent::domain::agent_tool_evidence::{
        AGENT_TOOL_EVIDENCE_LIMITS, create_agent_tool_evidence_preview,
    };
    // The source the evidence keeps is bounded to 64 KiB, and what it shows
    // is a preview of its head and tail with the rest omitted.
    let source = evidence(&large).last().unwrap().2.clone();
    assert_eq!(source.len(), 64 * 1024);
    let preview = create_agent_tool_evidence_preview(&source, AGENT_TOOL_EVIDENCE_LIMITS);
    assert!(preview.truncated && preview.omitted_lines > 0);
    assert!(
        crate::text::len16(&preview.head) + crate::text::len16(&preview.tail)
            <= AGENT_TOOL_EVIDENCE_LIMITS.max_chars
    );
}

// `desktop-agent.tool-group.test.tsx`: tool step lists.

fn tool_part(
    id: &str,
    turn: &str,
    kind: &str,
    sequence: i64,
    tool: &str,
    subject: &str,
    output: &str,
) -> Value {
    let detail = if kind == "command" {
        json!({"tool": tool, "command": subject})
    } else if tool == "grep" {
        json!({"tool": tool, "input": {"pattern": "match", "path": subject}})
    } else {
        json!({"tool": tool, "input": {"path": subject}})
    };
    json!({"id": id, "turnId": turn, "itemId": id, "kind": kind, "label": tool, "status": "completed",
        "detail": detail, "output": output, "sequence": sequence})
}

/// A projection of `parts`, each its own row (`estimatedHeight` 72 for an
/// answer, else 34).
fn projection_of(parts: Vec<Value>) -> crate::agent::contract::dto::AgentProjection {
    use crate::agent::contract::display_state::create_empty_agent_display;
    use std::sync::Arc;
    let mut display = create_empty_agent_display();
    display.rows = parts
        .iter()
        .map(|p| {
            Arc::new(json!({"id": format!("row:{}", p["id"].as_str().unwrap()), "partId": p["id"], "turnId": p["turnId"],
                "kind": p["kind"], "sequence": p["sequence"], "updatedSequence": p.get("updatedSequence").cloned().unwrap_or(p["sequence"].clone()),
                "estimatedHeight": if p["kind"] == "assistant" { 72 } else { 34 }}))
        })
        .collect();
    let last = parts
        .iter()
        .filter_map(|p| p["sequence"].as_i64())
        .max()
        .unwrap_or(0);
    display.parts = parts.into_iter().map(Arc::new).collect();
    display.set("lastSequence", last);
    crate::agent::contract::dto::AgentProjection::project(&display, None).unwrap()
}

fn grouped(
    parts: Vec<Value>,
) -> Vec<super::super::agent_tool_group_presentation::AgentTranscriptRow> {
    use super::super::agent_tool_group_presentation::group_agent_tool_rows;
    use super::super::transcript::transcript_rows::build_agent_timeline;
    let timeline = build_agent_timeline(&projection_of(parts), 34., None);
    group_agent_tool_rows(&timeline.rows, &timeline.parts, 34.)
}

fn fixture() -> Vec<Value> {
    vec![
        tool_part(
            "tool:bash",
            "turn:one",
            "command",
            1,
            "bash",
            "npm test",
            "passed",
        ),
        tool_part(
            "tool:read",
            "turn:one",
            "tool",
            2,
            "read",
            "package.json",
            "contents",
        ),
        json!({"id": "assistant:one", "turnId": "turn:one", "itemId": "assistant:one", "kind": "assistant",
            "text": "Checked the project.", "streaming": false, "terminalState": "completed", "sequence": 3}),
        tool_part(
            "tool:grep",
            "turn:one",
            "tool",
            4,
            "grep",
            "AgentTranscript",
            "match",
        ),
    ]
}

/// `uses distinct provider-neutral glyphs and animates only active work`.
#[test]
fn tools_get_neutral_glyphs_and_only_active_work_moves() {
    use super::agent_activity_views::{
        AgentToolGlyphKind as Glyph, agent_tool_glyph_active, agent_tool_glyph_kind,
    };
    assert_eq!(agent_tool_glyph_kind("grep"), Glyph::Search);
    assert_eq!(agent_tool_glyph_kind("read_file"), Glyph::Read);
    assert_eq!(agent_tool_glyph_kind("apply_patch"), Glyph::Edit);
    assert_eq!(agent_tool_glyph_kind("write_file"), Glyph::Write);
    assert!(agent_tool_glyph_active("running") && agent_tool_glyph_active("in-progress"));
    assert!(!agent_tool_glyph_active("completed") && !agent_tool_glyph_active("failed"));
}

/// `groups only adjacent tools from the same turn without changing their
/// order`; `estimates one application control row per visible step line`;
/// `bounds each visual group so a very long native tool run stays
/// virtualizable`.
#[test]
fn adjacent_tools_of_a_turn_group_in_order_within_a_bound() {
    use super::super::agent_tool_group_presentation::AGENT_TOOL_GROUP_LIMIT;
    let rows = grouped(fixture());
    assert_eq!(rows.len(), 3);
    assert!(rows[0].tool_group);
    assert_eq!(rows[0].part_ids, ["tool:bash", "tool:read"]);
    assert_eq!(rows[1].part_ids, ["assistant:one"]);
    assert_eq!(rows[2].part_ids, ["tool:grep"]);
    assert_eq!(rows[0].row.estimated_height, 68.);
    assert_eq!(rows[2].row.estimated_height, 34.);
    let many: Vec<Value> = (0..AGENT_TOOL_GROUP_LIMIT * 2 + 3)
        .map(|i| {
            tool_part(
                &format!("tool:{i}"),
                "turn:many",
                "tool",
                i as i64 + 1,
                "read",
                &format!("file-{i}.ts"),
                "contents",
            )
        })
        .collect();
    let ids: Vec<String> = many
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_owned())
        .collect();
    let rows = grouped(many);
    assert_eq!(
        rows.iter().map(|r| r.part_ids.len()).collect::<Vec<_>>(),
        [AGENT_TOOL_GROUP_LIMIT, AGENT_TOOL_GROUP_LIMIT, 3]
    );
    assert_eq!(
        rows.iter()
            .flat_map(|r| r.part_ids.clone())
            .collect::<Vec<_>>(),
        ids
    );
}

/// `folds only long runs of settled, successful exploration`.
#[test]
fn only_long_settled_exploration_folds() {
    use super::agent_tool_steps::{
        AGENT_TOOL_EXPLORATION_FOLD_MIN, AgentToolStepSegment, agent_tool_step_segments,
    };
    use std::sync::Arc;
    let explored: Vec<Arc<Part>> = [
        tool_part(
            "tool:read-a",
            "turn:fold",
            "tool",
            1,
            "read",
            "src/a.ts",
            "a",
        ),
        tool_part(
            "tool:read-a-again",
            "turn:fold",
            "tool",
            2,
            "read",
            "src/a.ts",
            "a",
        ),
        tool_part(
            "tool:read-b",
            "turn:fold",
            "tool",
            3,
            "read",
            "src/b.ts",
            "b",
        ),
        tool_part(
            "tool:grep",
            "turn:fold",
            "tool",
            4,
            "grep",
            "src",
            "src/a.ts:1:match",
        ),
        tool_part(
            "tool:rg",
            "turn:fold",
            "command",
            5,
            "bash",
            "rg -n match src",
            "src/a.ts:1:match",
        ),
    ]
    .into_iter()
    .map(|p| Arc::new(part(p)))
    .collect();
    let edit = Arc::new(part(tool_part(
        "tool:edit",
        "turn:fold",
        "tool",
        6,
        "edit",
        "src/a.ts",
        "",
    )));
    assert_eq!(AGENT_TOOL_EXPLORATION_FOLD_MIN, 4);
    let mut all = explored.clone();
    all.push(edit);
    let segments = agent_tool_step_segments(&all);
    assert_eq!(segments.len(), 2);
    let AgentToolStepSegment::Explored {
        parts,
        files,
        searches,
        ..
    } = &segments[0]
    else {
        panic!("explored")
    };
    assert_eq!((*files, *searches), (2, 2));
    assert_eq!(
        parts.iter().map(|p| p.id.clone()).collect::<Vec<_>>(),
        explored.iter().map(|p| p.id.clone()).collect::<Vec<_>>()
    );
    assert!(matches!(segments[1], AgentToolStepSegment::Step { .. }));
    let steps = |parts: &[Arc<Part>]| {
        agent_tool_step_segments(parts)
            .iter()
            .all(|s| matches!(s, AgentToolStepSegment::Step { .. }))
    };
    assert!(steps(&explored[..3]), "three steps stay visible");
    let mut running = (*explored[2]).clone();
    running.status = "running".into();
    let mut failed = (*explored[3]).clone();
    failed.status = "failed".into();
    assert!(
        steps(&[
            explored[0].clone(),
            explored[1].clone(),
            Arc::new(running),
            Arc::new(failed),
            explored[4].clone(),
        ]),
        "running and failed work is never folded"
    );
}

/// `removes resolved approval rows and rejoins the surrounding tool flow`;
/// `keeps permission / question state available without duplicate
/// transcript rows`.
#[test]
fn interactions_leave_no_rows_and_tools_around_them_rejoin() {
    use super::super::transcript::transcript_rows::build_agent_timeline;
    let rows = grouped(vec![
        tool_part(
            "tool:grep-before",
            "turn:approval",
            "tool",
            1,
            "grep",
            "before",
            "match",
        ),
        json!({"id": "permission:search", "turnId": "turn:approval", "itemId": "tool:grep-before", "kind": "permission",
            "requestId": "search", "state": "resolved", "sequence": 2, "updatedSequence": 3}),
        tool_part(
            "tool:grep-after",
            "turn:approval",
            "tool",
            4,
            "grep",
            "after",
            "match",
        ),
    ]);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].part_ids, ["tool:grep-before", "tool:grep-after"]);
    for kind in ["permission", "question"] {
        for state in ["pending", "resolved", "unavailable"] {
            let projection = projection_of(vec![
                json!({"id": "interaction", "turnId": "turn:approval", "itemId": "tool:grep",
                "kind": kind, "requestId": "pending", "state": state, "sequence": 1}),
            ]);
            let timeline = build_agent_timeline(&projection, 34., None);
            assert!(timeline.rows.is_empty(), "{kind} {state}");
            assert_eq!(timeline.parts["interaction"].kind, kind);
        }
    }
}

// `provider-activity-routing.test.tsx`, `reasoning.test.ts` and
// `pi-tool-history.test.tsx`: what provider activity becomes.

fn projected(runtime: &str, events: Vec<Value>) -> crate::agent::contract::dto::AgentProjection {
    use crate::agent::domain::agent_session_actor::{ActorOptions, EventInput, SessionActor};
    let actor = SessionActor::new(ActorOptions::default()).unwrap();
    for event in events {
        actor
            .append_event(EventInput {
                session_id: "session".into(),
                runtime_id: runtime.into(),
                provider_session_id: Some("native".into()),
                event,
            })
            .unwrap();
    }
    crate::agent::contract::dto::AgentProjection::project(&actor.snapshot().display, None).unwrap()
}

fn event(kind: &str, item: &str, payload: Value) -> Value {
    json!({"type": kind, "turnId": "turn", "itemId": item, "payload": payload})
}

/// `renders a chat with a quiet notification without tools, text splits or
/// transcript geometry`; `shows warning / error notice text without
/// misrepresenting it as a tool`; `keeps a real unknown tool visible and
/// expandable beside a notification`; `rejects a non-tool passed directly
/// to the tool renderer`; `renders compaction as a system divider and
/// completed authentication as no current status`.
#[test]
fn provider_notices_stay_out_of_the_tool_flow_and_real_tools_stay_in_it() {
    use super::super::provider_notices::provider_notices;
    use super::agent_activity_views::tool_view;
    crate::localization::set_current("en");
    let chat = projected(
        "pi",
        vec![
            event("turn.started", "", json!({"prompt": "Hello"})),
            event("assistant.delta", "item", json!({"delta": "Hello "})),
            event(
                "provider.notification",
                "notice",
                json!({"message": "Generation statistics", "severity": "info", "source": "Extension"}),
            ),
            event("assistant.delta", "item", json!({"delta": "again."})),
            event("turn.completed", "", json!({"status": "completed"})),
        ],
    );
    assert!(chat.rows.iter().all(|row| row.kind != "notification"));
    assert_eq!(
        chat.messages
            .iter()
            .filter(|m| m.role == "assistant")
            .map(|m| m.text.clone())
            .collect::<Vec<_>>(),
        ["Hello again."]
    );
    let notices = provider_notices(&chat);
    assert_eq!(notices.len(), 1);
    assert!(
        notices[0].label.contains("Generation statistics")
            || notices[0].detail.text("message") == Some("Generation statistics")
    );
    for severity in ["warning", "error"] {
        let notice = projected(
            "pi",
            vec![event(
                "provider.notification",
                "notice",
                json!({"severity": severity, "message": "Extension needs attention"}),
            )],
        );
        let part = Part::of_activity(&notice.activities[0]);
        assert_eq!(
            tool_view(&part),
            ActivityView::Hidden,
            "{severity}: not a tool"
        );
        assert_eq!(provider_notices(&notice).len(), 1, "{severity}");
    }
    let unknown = projected(
        "pi",
        vec![
            event(
                "tool.completed",
                "tool",
                json!({"tool": "custom_lookup", "status": "completed", "outputPreview": "Found the result"}),
            ),
            event(
                "provider.notification",
                "notice",
                json!({"message": "Notice", "severity": "info"}),
            ),
        ],
    );
    let tool = unknown
        .parts
        .iter()
        .find(|p| p.item_id.as_deref() == Some("tool"))
        .unwrap();
    let ActivityView::Shell(shell) = activity_view(tool) else {
        panic!("a visible tool")
    };
    assert!(!shell.default_expanded);
    assert!(matches!(
        shell.icon,
        super::agent_activity_views::StepIcon::Glyph {
            kind: super::agent_activity_views::AgentToolGlyphKind::Generic,
            ..
        }
    ));
    let system = projected(
        "pi",
        vec![
            event(
                "provider.activity",
                "compact",
                json!({"category": "compaction", "status": "completed"}),
            ),
            event(
                "provider.activity",
                "auth",
                json!({"category": "authentication", "status": "completed", "message": "Signed in"}),
            ),
        ],
    );
    let compact = system
        .parts
        .iter()
        .find(|p| p.item_id.as_deref() == Some("compact"))
        .unwrap();
    assert_eq!(
        activity_view(compact),
        ActivityView::ContextDivider("Compacted context".into())
    );
    assert!(provider_notices(&system).is_empty());
}

/// `renders reasoning as a quiet disclosure branch instead of a message
/// bubble`; `omits empty reasoning boundaries after the owning turn
/// settles`; `renders context compaction as a divider instead of a generic
/// Tool timeline row`.
#[test]
fn reasoning_is_a_folded_branch_and_empty_reasoning_and_compaction_are_not_steps() {
    crate::localization::set_current("en");
    let reasoning = shell(
        json!({"id": "reasoning-1", "turnId": "turn-1", "itemId": "reasoning", "kind": "reasoning",
        "label": "Reasoning summary", "status": "completed", "output": "", "sequence": 1,
        "detail": {"delta": "Compared the provider boundaries."}}),
    );
    assert!(!reasoning.default_expanded);
    assert_eq!(reasoning.icon, super::agent_activity_views::StepIcon::Brain);
    assert_eq!(
        reasoning.detail,
        ShellDetail::Prose {
            text: Some("Compared the provider boundaries.".into()),
            plan: vec![]
        }
    );
    let settled = projected(
        "cursor",
        vec![
            event("turn.started", "", json!({"prompt": "?"})),
            event(
                "reasoning.summary.delta",
                "cursor-thought",
                json!({"delta": "", "boundary": true, "status": "working"}),
            ),
            event(
                "assistant.completed",
                "cursor-message",
                json!({"text": "I'm here."}),
            ),
            event("turn.completed", "", json!({"status": "completed"})),
        ],
    );
    for part in settled.parts.iter().filter(|p| p.kind == "reasoning") {
        assert_eq!(
            activity_view(part),
            ActivityView::Hidden,
            "no empty Thought line"
        );
    }
    let compaction = part(
        json!({"id": "compact-1", "turnId": "turn-1", "itemId": "compact", "kind": "tool",
        "label": "Compacted context", "status": "completed", "output": "", "detail": {"tool": "compaction"}, "sequence": 1}),
    );
    assert_eq!(
        activity_view(&compaction),
        ActivityView::ContextDivider("Compacted context".into())
    );
}

/// `keeps expandable tool results after a model failure (live / history)`.
#[test]
fn pi_tool_results_stay_expandable_after_a_model_failure() {
    use crate::agent::protocols::pi_rpc::pi_event_normalizer::{
        PiEventState, normalize_pi_history, normalize_pi_rpc_event,
    };
    crate::localization::set_current("en");
    let calls = [
        ("call-read", "read", json!({"path": "fixture.txt"})),
        ("call-list", "ls", json!({"path": "."})),
        ("call-bash", "bash", json!({"command": "pwd"})),
    ];
    let mut content = vec![json!({"type": "thinking", "thinking": "Synthetic private reasoning."})];
    content.extend(calls.iter().map(
        |(id, name, args)| json!({"type": "toolCall", "id": id, "name": name, "arguments": args}),
    ));
    let assistant = json!({"role": "assistant", "content": content, "stopReason": "toolUse"});
    let results: Vec<Value> = calls
        .iter()
        .map(|(id, name, _)| {
            json!({"role": "toolResult", "toolCallId": id, "toolName": name, "isError": false,
            "content": [{"type": "text", "text": format!("Result for {name}")}]})
        })
        .collect();
    let failure = json!({"role": "assistant", "content": [], "stopReason": "error", "errorMessage": "422 status code (no body)"});
    for mode in ["live", "history"] {
        let events: Vec<Value> = if mode == "history" {
            let mut messages = vec![
                json!({"role": "user", "content": "Inspect the fixture."}),
                assistant.clone(),
            ];
            messages.extend(results.iter().cloned());
            messages.push(failure.clone());
            normalize_pi_history(
                &messages,
                Some("native-tools"),
                Some("puppyone-agent"),
                None,
            )
        } else {
            let mut state = PiEventState::new(
                Some("turn-tools"),
                Some("native-tools"),
                "puppyone-agent",
                "Pi",
            );
            let mut raw = vec![json!({"type": "message_end", "message": assistant})];
            for ((id, name, args), result) in calls.iter().zip(&results) {
                raw.push(json!({"type": "tool_execution_start", "toolCallId": id, "toolName": name, "args": args}));
                raw.push(json!({"type": "tool_execution_end", "toolCallId": id, "toolName": name, "result": result, "isError": false}));
            }
            raw.push(json!({"type": "message_end", "message": failure}));
            raw.push(json!({"type": "agent_settled"}));
            raw.iter()
                .flat_map(|e| normalize_pi_rpc_event(e, &mut state))
                .collect()
        };
        let projection = projected("puppyone-agent", events);
        let shells: Vec<ActivityShell> = projection
            .parts
            .iter()
            .filter_map(|p| match activity_view(p) {
                ActivityView::Shell(shell)
                    if shell.icon != super::agent_activity_views::StepIcon::Brain =>
                {
                    Some(*shell)
                }
                _ => None,
            })
            .collect();
        assert_eq!(shells.len(), 3, "{mode}");
        for ((_, name, _), shell) in calls.iter().zip(&shells) {
            assert!(shell.has_detail(), "{mode} {name}");
            assert!(
                evidence(shell)
                    .iter()
                    .any(|n| n.2.contains(&format!("Result for {name}"))),
                "{mode} {name}"
            );
        }
    }
}
