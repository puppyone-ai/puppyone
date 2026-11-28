//! The request a session's history becomes for the model it continues on,
//! after switching connections mid-conversation (Pi's `transformMessages`).
use super::turn::{ContextLosses, portable_tool_call_id, request_context};
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::path::Path;

fn kimi() -> Value {
    json!({ "provider": "kimi", "id": "kimi-k3", "name": "Kimi K3", "contextWindow": 256_000, "input": ["text", "image"] })
}

fn xai() -> Value {
    json!({ "provider": "xai", "id": "grok-5", "name": "Grok 5", "contextWindow": 256_000, "input": ["text"] })
}

fn assistant(model: &Value, content: Value) -> Value {
    json!({
        "role": "assistant",
        "provider": model["provider"],
        "model": model["id"],
        "stopReason": "toolUse",
        "content": content,
    })
}

/// A Kimi turn: a prompt, Kimi's thinking and a tool call with Kimi's own
/// id format, its result and Kimi's answer.
fn kimi_history() -> Vec<Value> {
    vec![
        json!({ "role": "user", "content": [{ "type": "text", "text": "List the files" }] }),
        assistant(
            &kimi(),
            json!([
                { "type": "thinking", "thinking": "I should list the root." },
                { "type": "toolCall", "id": "functions.list:0", "name": "list", "arguments": { "path": "." } },
            ]),
        ),
        json!({ "role": "toolResult", "toolCallId": "functions.list:0", "toolName": "list", "content": [{ "type": "text", "text": "a.txt" }] }),
        assistant(
            &kimi(),
            json!([{ "type": "text", "text": "There is a.txt." }]),
        ),
        json!({ "role": "user", "content": [{ "type": "text", "text": "And now?" }] }),
    ]
}

fn assistants(context: &[Value]) -> Vec<&Value> {
    context
        .iter()
        .filter(|m| m["role"] == "assistant")
        .collect()
}

#[test]
fn the_same_model_gets_its_history_back_unchanged() {
    let (context, losses) = request_context(Path::new("/p"), &kimi_history(), &kimi());
    assert_eq!(losses, ContextLosses::default());
    let turns = assistants(&context);
    assert_eq!(turns[0]["reasoning_content"], "I should list the root.");
    assert_eq!(turns[0]["tool_calls"][0]["id"], "functions.list:0");
    let result = context.iter().find(|m| m["role"] == "tool").unwrap();
    assert_eq!(result["tool_call_id"], "functions.list:0");
}

#[test]
fn another_model_gets_no_thinking_and_portable_tool_call_ids() {
    let (context, losses) = request_context(Path::new("/p"), &kimi_history(), &xai());
    assert_eq!(losses, ContextLosses::default());
    let turns = assistants(&context);
    assert!(
        turns
            .iter()
            .all(|turn| turn.get("reasoning_content").is_none())
    );
    let id = turns[0]["tool_calls"][0]["id"].as_str().unwrap();
    assert_ne!(id, "functions.list:0");
    assert!(
        id.len() <= 64
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    );
    // The result still answers its call, so no receipt is invented.
    let results: Vec<&Value> = context.iter().filter(|m| m["role"] == "tool").collect();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["tool_call_id"], id);
    assert_eq!(results[0]["content"], "a.txt");
    assert_eq!(turns[1]["content"], "There is a.txt.");
    assert_eq!(context.last().unwrap()["content"], "And now?");
}

#[test]
fn portable_ids_are_stable_distinct_and_leave_valid_ids_alone() {
    assert_eq!(portable_tool_call_id("call_abc-1"), "call_abc-1");
    let long = "fc_".to_string() + &"x".repeat(80) + "|rs_1";
    for id in ["functions.read:0", "functions.read:1", long.as_str()] {
        let portable = portable_tool_call_id(id);
        assert_eq!(portable, portable_tool_call_id(id));
        assert!(portable.len() <= 64);
    }
    assert_ne!(
        portable_tool_call_id("functions.read:0"),
        portable_tool_call_id("functions.read:1")
    );
}

#[test]
fn a_model_without_image_input_gets_a_note_for_each_image_turn() {
    let history = vec![json!({
        "role": "user",
        "content": [
            { "type": "text", "text": "What is this?" },
            { "type": "image", "data": "AAAA", "mimeType": "image/png" },
        ],
    })];
    let (context, losses) = request_context(Path::new("/p"), &history, &xai());
    assert_eq!(losses.omitted_images, 1);
    let text = context[1]["content"].as_str().unwrap();
    assert!(text.starts_with("What is this?") && text.contains("image omitted"));
    let (context, losses) = request_context(Path::new("/p"), &history, &kimi());
    assert_eq!(losses.omitted_images, 0);
    assert_eq!(context[1]["content"][1]["type"], "image_url");
}

#[test]
fn a_smaller_window_leaves_out_the_oldest_turns_and_says_so() {
    let filler = "word ".repeat(2_000);
    let mut history = Vec::new();
    for turn in 0..6 {
        history.push(json!({ "role": "user", "content": [{ "type": "text", "text": format!("Q{turn} {filler}") }] }));
        history.push(assistant(
            &kimi(),
            json!([{ "type": "text", "text": format!("A{turn} {filler}") }]),
        ));
    }
    history.push(json!({ "role": "user", "content": [{ "type": "text", "text": "Latest" }] }));
    let small = json!({ "provider": "local", "id": "mlx", "name": "MLX", "contextWindow": 8_000, "input": ["text"] });
    let (context, losses) = request_context(Path::new("/p"), &history, &small);
    assert!(losses.omitted_messages > 0);
    assert_eq!(context.last().unwrap()["content"], "Latest");
    // Whole turns go: the history still starts with a prompt.
    assert_eq!(context[1]["role"], "user");
    assert!(
        context[0]["content"]
            .as_str()
            .unwrap()
            .contains("were left out")
    );
    let kept = context.len() - 1;
    assert_eq!(kept + losses.omitted_messages, history.len());
    // The full window keeps everything.
    let (context, losses) = request_context(Path::new("/p"), &history, &kimi());
    assert_eq!(losses.omitted_messages, 0);
    assert_eq!(context.len(), history.len() + 1);
}
