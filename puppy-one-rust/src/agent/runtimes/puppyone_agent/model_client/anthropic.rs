//! Anthropic Messages (`/v1/messages`): Anthropic and Kimi Code. The
//! kernel's OpenAI-shaped history is converted here, with prompt-cache
//! breakpoints on the stable prefix.
use super::sse::{Events, MAX_CALLS};
use super::{Completion, call, settle, text_of};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The API version every request names.
pub const VERSION: &str = "2023-06-01";
/// The output budget of one response.
pub const MAX_TOKENS: u64 = 16_384;

fn cached(block: &mut Value) {
    block["cache_control"] = json!({"type": "ephemeral"});
}

/// Appends `blocks` as `role`, merging into the previous message of the
/// same role (Messages alternates roles strictly).
fn push(messages: &mut Vec<Value>, role: &str, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    if let Some(last) = messages.last_mut()
        && last["role"] == role
        && let Some(content) = last["content"].as_array_mut()
    {
        content.extend(blocks);
        return;
    }
    messages.push(json!({"role": role, "content": blocks}));
}

fn text_block(text: String) -> Option<Value> {
    (!text.is_empty()).then(|| json!({"type": "text", "text": text}))
}

/// The request body for `context` (OpenAI chat shape) and `tools` (OpenAI
/// function tools).
pub fn body(model: &str, context: &[Value], tools: &Value) -> Value {
    let mut system = vec![];
    let mut messages = vec![];
    for message in context {
        match message["role"].as_str().unwrap_or("") {
            "system" => system.extend(text_block(text_of(&message["content"]))),
            "assistant" => {
                let mut blocks: Vec<Value> = text_block(text_of(&message["content"]))
                    .into_iter()
                    .collect();
                for c in message["tool_calls"].as_array().into_iter().flatten() {
                    let input = serde_json::from_str::<Value>(
                        c["function"]["arguments"].as_str().unwrap_or("{}"),
                    )
                    .ok()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| json!({}));
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": c["id"],
                        "name": c["function"]["name"],
                        "input": input,
                    }));
                }
                push(&mut messages, "assistant", blocks);
            }
            "tool" => push(
                &mut messages,
                "user",
                vec![json!({
                    "type": "tool_result",
                    "tool_use_id": message["tool_call_id"],
                    "content": text_of(&message["content"]),
                })],
            ),
            _ => push(
                &mut messages,
                "user",
                text_block(text_of(&message["content"]))
                    .into_iter()
                    .collect(),
            ),
        }
    }
    let mut tools: Vec<Value> = tools
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| {
            let f = &t["function"];
            let schema = if f["parameters"].is_object() {
                f["parameters"].clone()
            } else {
                json!({"type": "object", "properties": {}})
            };
            json!({
                "name": f["name"],
                "description": f["description"].as_str().unwrap_or(""),
                "input_schema": schema,
            })
        })
        .collect();
    // Three breakpoints (of the four allowed): the instructions, the tool
    // list and the conversation so far.
    if let Some(last) = system.last_mut() {
        cached(last);
    }
    if let Some(last) = tools.last_mut() {
        cached(last);
    }
    if let Some(block) = messages
        .iter_mut()
        .rev()
        .find(|m| m["role"] == "user")
        .and_then(|m| m["content"].as_array_mut())
        .and_then(|c| c.last_mut())
    {
        cached(block);
    }
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "stream": true,
        "messages": messages,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }
    if !tools.is_empty() {
        body["tools"] = json!(tools);
    }
    body
}

enum Block {
    Text,
    Thinking,
    Tool {
        id: String,
        name: String,
        input: String,
    },
    Other,
}

/// The Messages event stream; `message_stop` is its receipt.
#[derive(Default)]
pub struct Parser {
    result: Completion,
    blocks: BTreeMap<u64, Block>,
    input: u64,
    done: bool,
}

impl Parser {
    fn usage(&mut self, usage: &Value) {
        if let Some(n) = usage["input_tokens"].as_u64() {
            self.input = n;
        }
        if let Some(n) = usage["cache_read_input_tokens"].as_u64() {
            self.result.usage.cache_read = n;
        }
        if let Some(n) = usage["cache_creation_input_tokens"].as_u64() {
            self.result.usage.cache_write = n;
        }
        if let Some(n) = usage["output_tokens"].as_u64() {
            self.result.usage.output = n;
        }
    }
}

impl Events for Parser {
    fn data(
        &mut self,
        _: &str,
        data: &str,
        delta: &mut dyn FnMut(&str, &str),
    ) -> Result<bool, String> {
        if data.is_empty() {
            return Ok(false);
        }
        let v: Value = serde_json::from_str(data).map_err(|_| "Malformed model stream event")?;
        match v["type"].as_str().unwrap_or("") {
            "message_start" => self.usage(&v["message"]["usage"]),
            "message_delta" => self.usage(&v["usage"]),
            "content_block_start" => {
                let index = v["index"].as_u64().ok_or("Malformed model stream event")?;
                let block = &v["content_block"];
                let block = match block["type"].as_str().unwrap_or("") {
                    "text" => {
                        if let Some(t) = block["text"].as_str().filter(|t| !t.is_empty()) {
                            self.result.text.push_str(t);
                            delta("text", t);
                        }
                        Block::Text
                    }
                    "thinking" => Block::Thinking,
                    "tool_use" => {
                        let tools = self
                            .blocks
                            .values()
                            .filter(|b| matches!(b, Block::Tool { .. }))
                            .count();
                        if tools >= MAX_CALLS {
                            return Err("Too many tool calls in one model response".into());
                        }
                        Block::Tool {
                            id: block["id"].as_str().unwrap_or("").to_owned(),
                            name: block["name"].as_str().unwrap_or("").to_owned(),
                            input: String::new(),
                        }
                    }
                    _ => Block::Other,
                };
                self.blocks.insert(index, block);
            }
            "content_block_delta" => {
                let index = v["index"].as_u64().ok_or("Malformed model stream event")?;
                let d = &v["delta"];
                match (
                    d["type"].as_str().unwrap_or(""),
                    self.blocks.get_mut(&index),
                ) {
                    ("text_delta", Some(Block::Text)) => {
                        let t = d["text"].as_str().unwrap_or("");
                        self.result.text.push_str(t);
                        delta("text", t);
                    }
                    ("thinking_delta", Some(Block::Thinking)) => {
                        let t = d["thinking"].as_str().unwrap_or("");
                        self.result.reasoning.push_str(t);
                        delta("reasoning", t);
                    }
                    ("input_json_delta", Some(Block::Tool { input, .. })) => {
                        input.push_str(d["partial_json"].as_str().unwrap_or(""));
                    }
                    _ => {}
                }
            }
            "message_stop" => {
                self.done = true;
                return Ok(true);
            }
            "error" => return Err("The model endpoint reported an inference error".into()),
            _ => {}
        }
        Ok(false)
    }

    fn finish(mut self) -> Result<Completion, String> {
        if !self.done {
            return Err(
                "Model stream ended without a completion receipt; nothing was replayed".into(),
            );
        }
        let calls = std::mem::take(&mut self.blocks)
            .into_values()
            .filter_map(|block| match block {
                Block::Tool { id, name, input } => Some(call(
                    &id,
                    &name,
                    if input.trim().is_empty() {
                        "{}"
                    } else {
                        &input
                    },
                )),
                _ => None,
            })
            .collect();
        self.result.calls = settle(calls)?;
        let usage = &mut self.result.usage;
        usage.input = self.input + usage.cache_read + usage.cache_write;
        Ok(self.result)
    }
}

#[cfg(test)]
mod tests {
    use super::super::Usage;
    use super::super::sse::Stream;
    use super::*;

    fn history() -> Vec<Value> {
        vec![
            json!({"role":"system","content":"Be brief."}),
            json!({"role":"system","content":"Use tools."}),
            json!({"role":"user","content":"Read two files"}),
            json!({"role":"assistant","content":"Reading.","tool_calls":[
                {"id":"t1","type":"function","function":{"name":"read","arguments":"{\"path\":\"a\"}"}},
                {"id":"t2","type":"function","function":{"name":"read","arguments":"not json"}}]}),
            json!({"role":"tool","tool_call_id":"t1","content":"A"}),
            json!({"role":"tool","tool_call_id":"t2","content":"B"}),
            json!({"role":"assistant","content":"Both read."}),
            json!({"role":"user","content":"Thanks"}),
        ]
    }

    fn tools() -> Value {
        json!([
            {"type":"function","function":{"name":"read","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}},
            {"type":"function","function":{"name":"list","parameters":{"type":"object"}}}
        ])
    }

    #[test]
    fn openai_history_converts_to_messages_with_cache_breakpoints() {
        let body = body("claude-sonnet-4-5", &history(), &tools());
        let eph = json!({"type":"ephemeral"});
        assert_eq!(
            body,
            json!({
                "model": "claude-sonnet-4-5",
                "max_tokens": MAX_TOKENS,
                "stream": true,
                "system": [
                    {"type":"text","text":"Be brief."},
                    {"type":"text","text":"Use tools.","cache_control":eph},
                ],
                "tools": [
                    {"name":"read","description":"Read a file","input_schema":{"type":"object","properties":{"path":{"type":"string"}}}},
                    {"name":"list","description":"","input_schema":{"type":"object"},"cache_control":eph},
                ],
                "messages": [
                    {"role":"user","content":[{"type":"text","text":"Read two files"}]},
                    {"role":"assistant","content":[
                        {"type":"text","text":"Reading."},
                        {"type":"tool_use","id":"t1","name":"read","input":{"path":"a"}},
                        {"type":"tool_use","id":"t2","name":"read","input":{}},
                    ]},
                    {"role":"user","content":[
                        {"type":"tool_result","tool_use_id":"t1","content":"A"},
                        {"type":"tool_result","tool_use_id":"t2","content":"B"},
                    ]},
                    {"role":"assistant","content":[{"type":"text","text":"Both read."}]},
                    {"role":"user","content":[{"type":"text","text":"Thanks","cache_control":eph}]},
                ],
            })
        );
        let breakpoints = body.to_string().matches("ephemeral").count();
        assert_eq!(breakpoints, 3);
    }

    #[test]
    fn a_trailing_tool_result_carries_the_conversation_breakpoint() {
        let mut context = history();
        context.truncate(6);
        context.push(json!({"role":"user","content":"and?"}));
        let body = body("m", &context, &json!([]));
        assert!(body.get("tools").is_none());
        let last = body["messages"].as_array().unwrap().last().unwrap().clone();
        // The user's words merge after the tool results; the last block is cached.
        assert_eq!(last["content"].as_array().unwrap().len(), 3);
        assert_eq!(last["content"][2]["cache_control"]["type"], "ephemeral");
        assert!(last["content"][0].get("cache_control").is_none());
    }

    const EVENTS: &str = concat!(
        "event: message_start\n",
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"cache_creation_input_tokens\":200,\"cache_read_input_tokens\":3000,\"output_tokens\":1}}}\n\n",
        "event: ping\ndata: {\"type\":\"ping\"}\n\n",
        "event: content_block_start\n",
        "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Plan\"}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig\"}}\n\n",
        "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi \\u4f60\"}}\n\n",
        "data: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"read\",\"input\":{}}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"pa\"}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"th\\\":\\\"a\\\"}\"}}\n\n",
        "data: {\"type\":\"content_block_start\",\"index\":3,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_2\",\"name\":\"list\",\"input\":{}}}\n\n",
        "event: message_delta\n",
        "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":42}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
    );

    fn run(input: &str, split: usize) -> (Result<Completion, String>, Vec<(String, String)>) {
        let mut deltas = vec![];
        let mut sink = |kind: &str, text: &str| deltas.push((kind.to_owned(), text.to_owned()));
        let mut stream = Stream::new(Parser::default());
        let (a, b) = input.as_bytes().split_at(split);
        let fed = (|| {
            if !stream.feed(a, &mut sink)? {
                stream.feed(b, &mut sink)?;
            }
            Ok::<_, String>(())
        })();
        (fed.and_then(|_| stream.finish()), deltas)
    }

    #[test]
    fn the_stream_assembles_thinking_text_tools_and_cache_usage_at_any_split() {
        for split in 0..EVENTS.len() {
            let (completion, deltas) = run(EVENTS, split);
            let completion = completion.unwrap();
            assert_eq!(completion.text, "Hi 你");
            assert_eq!(completion.reasoning, "Plan");
            assert_eq!(
                completion.calls,
                [
                    json!({"id":"toolu_1","type":"function","function":{"name":"read","arguments":"{\"path\":\"a\"}"}}),
                    json!({"id":"toolu_2","type":"function","function":{"name":"list","arguments":"{}"}}),
                ]
            );
            assert_eq!(
                completion.usage,
                Usage {
                    input: 3210,
                    output: 42,
                    cache_read: 3000,
                    cache_write: 200
                }
            );
            assert_eq!(
                deltas,
                [
                    ("reasoning".to_owned(), "Plan".to_owned()),
                    ("text".to_owned(), "Hi 你".to_owned())
                ]
            );
        }
    }

    #[test]
    fn missing_receipts_and_error_events_fail() {
        let (result, _) = run(&EVENTS.replace("data: {\"type\":\"message_stop\"}", ""), 0);
        assert!(result.unwrap_err().contains("without a completion receipt"));
        let (result, _) = run(
            "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"secret detail\"}}\n\n",
            0,
        );
        assert_eq!(
            result.unwrap_err(),
            "The model endpoint reported an inference error"
        );
        let many: String = (0..=MAX_CALLS)
            .map(|i| format!("data: {{\"type\":\"content_block_start\",\"index\":{i},\"content_block\":{{\"type\":\"tool_use\",\"id\":\"t{i}\",\"name\":\"x\"}}}}\n"))
            .collect();
        let (result, _) = run(&many, 0);
        assert!(result.unwrap_err().contains("Too many tool calls"));
    }
}
