//! `desktop-agent.tool-evidence.test.ts` and
//! `desktop-agent.tool-presentation.test.ts`.
use crate::agent::contract::js;
use crate::features::desktop_agent::domain::agent_activity_presentation::{
    command_presentation_for_activity, output_for_activity,
};
use crate::features::desktop_agent::domain::agent_tool_evidence::{
    AGENT_TOOL_EVIDENCE_LIMITS, collect_agent_tool_result_lines,
    create_agent_tool_evidence_preview, stringify_agent_tool_input,
};
use serde_json::{Map, Value, json};

#[test]
fn preserves_ordinary_output_exactly() {
    let preview = create_agent_tool_evidence_preview("first\nsecond", AGENT_TOOL_EVIDENCE_LIMITS);
    assert_eq!(preview.head, "first\nsecond");
    assert_eq!(preview.tail, "");
    assert_eq!(preview.source_length, 12);
    assert_eq!(preview.total_lines, 2);
    assert_eq!((preview.omitted_chars, preview.omitted_lines), (0, 0));
    assert!(!preview.truncated);
}

#[test]
fn bounds_adversarial_many_line_output_while_retaining_head_and_tail() {
    let source = (0..20_000)
        .map(|index| format!("line-{index}"))
        .collect::<Vec<_>>()
        .join("\n");
    let preview = create_agent_tool_evidence_preview(&source, AGENT_TOOL_EVIDENCE_LIMITS);
    assert!(preview.truncated);
    assert_eq!(preview.total_lines, 20_000);
    assert!(preview.head.contains("line-0"));
    assert!(preview.tail.contains("line-19999"));
    assert!(
        js::len16(&preview.head) + js::len16(&preview.tail) <= AGENT_TOOL_EVIDENCE_LIMITS.max_chars
    );
    assert!(preview.omitted_lines > 19_000);
}

#[test]
fn bounds_one_pathological_line() {
    let preview =
        create_agent_tool_evidence_preview(&"x".repeat(2_000_000), AGENT_TOOL_EVIDENCE_LIMITS);
    assert!(preview.truncated);
    assert_eq!(preview.total_lines, 1);
    assert!(js::len16(&preview.head) <= AGENT_TOOL_EVIDENCE_LIMITS.max_line_chars);
    assert_eq!(preview.tail, "");
    assert!(preview.omitted_chars > 1_900_000);
}

#[test]
fn collects_only_mountable_search_rows_while_reporting_the_full_count() {
    let source = (0..50_000)
        .map(|index| format!("src/file-{index}.ts:{}:match", index + 1))
        .collect::<Vec<_>>()
        .join("\n");
    let results =
        collect_agent_tool_result_lines(&source, 80, AGENT_TOOL_EVIDENCE_LIMITS.max_line_chars);
    assert_eq!(results.lines.len(), 80);
    assert_eq!(results.total_lines, 50_000);
    assert_eq!(results.omitted_lines, 49_920);
    assert!(results.lines.last().expect("line").contains("file-79.ts"));
}

#[test]
fn serializes_wide_structured_input_within_an_aggregate_budget() {
    let mut input = Map::new();
    for index in 0..1_000 {
        input.insert(format!("key-{index}"), Value::from("x".repeat(8_000)));
    }
    // A JSON tree cannot be cyclic; a nested copy stands in for `input.self`.
    input.insert("self".into(), Value::Object(input.clone()));
    let serialized = stringify_agent_tool_input(&Value::Object(input)).expect("serialized");
    assert!(js::len16(&serialized) <= 32 * 1024);
    assert!(serialized.contains("truncated"));
}

fn command(command: &str) -> Value {
    json!({
        "id": "command", "turnId": "turn", "itemId": "tool", "kind": "command", "label": command,
        "status": "completed", "detail": { "tool": "bash", "command": command }, "output": "", "sequence": 1,
    })
}

#[test]
fn classifies_simple_read_only_commands() {
    for (line, tool, title) in [
        ("/bin/zsh -lc \"rg -n needle src\"", "grep", "Grep"),
        ("rg --files src", "glob", "Glob"),
        ("git grep needle", "grep", "Grep"),
        ("cat src/App.tsx", "read", "Read"),
        ("find src -name '*.ts'", "glob", "Glob"),
    ] {
        let presentation = command_presentation_for_activity(&command(line));
        assert_eq!(
            (
                presentation.tool,
                presentation.title,
                presentation.via_shell
            ),
            (tool, title, true),
            "{line}"
        );
    }
}

#[test]
fn keeps_ambiguous_or_mutating_shell_syntax_as_bash() {
    for line in [
        "cat src/App.tsx > /tmp/copy",
        "find src -delete",
        "find src -exec rm {} ;",
        "rg --pre 'node preprocess.js' needle",
        "rg needle src | xargs rm",
    ] {
        let presentation = command_presentation_for_activity(&command(line));
        assert_eq!(
            (
                presentation.tool,
                presentation.title,
                presentation.via_shell
            ),
            ("bash", "Bash", false),
            "{line}"
        );
    }
}

#[test]
fn renders_a_structured_tool_result_without_an_adapter_preview() {
    let mut normalized = command("tool");
    normalized["kind"] = json!("tool");
    normalized["detail"] = json!({
        "tool": "lookup",
        "result": {
            "content": [
                { "type": "text", "text": "visible result" },
                { "type": "artifact", "uri": "artifact://report" },
                { "type": "json", "value": { "count": 2 } },
            ],
            "error": null,
        },
    });
    let expected = "visible result\nartifact://report\n{\n  \"count\": 2\n}";
    assert!(output_for_activity(&normalized).contains(expected));
    normalized["kind"] = json!("mcp");
    assert!(output_for_activity(&normalized).contains(expected));
}
