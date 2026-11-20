//! OpenAI Responses: xAI (`/responses`) and ChatGPT's Codex backend
//! (`/codex/responses`). Nothing is stored server-side; a stable
//! `prompt_cache_key` lets repeated turns reuse the cached prefix.
use super::sse::{Events, MAX_CALLS};
use super::{Completion, Usage, call, settle, text_of};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// Instructions used when the context names none.
const DEFAULT_INSTRUCTIONS: &str = "You are a helpful assistant.";
/// The error a provider's plan limit maps to.
pub const USAGE_LIMIT: &str =
    "The account's usage limit is reached; nothing was charged to PuppyOne.";

/// The request body for `context` (OpenAI chat shape) and `tools` (OpenAI
/// function tools); `codex` adds the ChatGPT backend's fields.
pub fn body(model: &str, context: &[Value], tools: &Value, codex: bool) -> Value {
    let mut system = vec![];
    let mut input = vec![];
    for message in context {
        let text = text_of(&message["content"]);
        match message["role"].as_str().unwrap_or("") {
            "system" => {
                if !text.is_empty() {
                    system.push(text);
                }
            }
            "assistant" => {
                if !text.is_empty() {
                    input.push(json!({"type":"message","role":"assistant",
                        "content":[{"type":"output_text","text":text}]}));
                }
                for c in message["tool_calls"].as_array().into_iter().flatten() {
                    input.push(json!({
                        "type": "function_call",
                        "call_id": c["id"],
                        "name": c["function"]["name"],
                        "arguments": c["function"]["arguments"].as_str().unwrap_or("{}"),
                    }));
                }
            }
            "tool" => input.push(json!({
                "type": "function_call_output",
                "call_id": message["tool_call_id"],
                "output": text,
            })),
            _ => input.push(json!({"role":"user","content":[{"type":"input_text","text":text}]})),
        }
    }
    let instructions = if system.is_empty() {
        DEFAULT_INSTRUCTIONS.to_owned()
    } else {
        system.join("\n\n")
    };
    let tools: Vec<Value> = tools
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| {
            let f = &t["function"];
            json!({
                "type": "function",
                "name": f["name"],
                "description": f["description"].as_str().unwrap_or(""),
                "parameters": if f["parameters"].is_object() { f["parameters"].clone() }
                              else { json!({"type":"object","properties":{}}) },
            })
        })
        .collect();
    let tools = json!(tools);
    let key = cache_key(model, &instructions, &tools);
    let mut body = json!({
        "model": model,
        "stream": true,
        "store": false,
        "instructions": instructions,
        "input": input,
        "tools": tools,
        "tool_choice": "auto",
        "parallel_tool_calls": true,
        "prompt_cache_key": key,
    });
    if codex {
        body["include"] = json!(["reasoning.encrypted_content"]);
        body["text"] = json!({"verbosity": "low"});
    }
    body
}

/// The stable prefix's identity: the same model, instructions and tools
/// share one cache entry.
fn cache_key(model: &str, instructions: &str, tools: &Value) -> String {
    let mut hasher = blake3::Hasher::new();
    for part in [model, instructions, &tools.to_string()] {
        hasher.update(&(part.len() as u64).to_le_bytes());
        hasher.update(part.as_bytes());
    }
    hasher.finalize().to_hex()[..32].to_owned()
}

/// A provider error code meaning the account's plan limit.
pub fn usage_limited(code: &str) -> bool {
    matches!(code, "usage_limit_reached" | "rate_limit_exceeded")
}

#[derive(Default)]
struct Call {
    item: String,
    id: String,
    name: String,
    arguments: String,
}

/// The Responses event stream; `response.completed` (or
/// `response.incomplete`) is its receipt.
#[derive(Default)]
pub struct Parser {
    result: Completion,
    calls: BTreeMap<u64, Call>,
    done: bool,
}

impl Parser {
    fn call(&mut self, v: &Value) -> Option<&mut Call> {
        if let Some(index) = v["output_index"].as_u64()
            && self.calls.contains_key(&index)
        {
            return self.calls.get_mut(&index);
        }
        let item = v["item_id"].as_str()?;
        self.calls.values_mut().find(|c| c.item == item)
    }
}

fn failure(error: &Value) -> String {
    let code = error["code"]
        .as_str()
        .or_else(|| error["type"].as_str())
        .unwrap_or("");
    if usage_limited(code) {
        USAGE_LIMIT.into()
    } else {
        "The model endpoint reported an inference error".into()
    }
}

impl Events for Parser {
    fn data(
        &mut self,
        _: &str,
        data: &str,
        delta: &mut dyn FnMut(&str, &str),
    ) -> Result<bool, String> {
        if data.is_empty() || data == "[DONE]" {
            return Ok(false);
        }
        let v: Value = serde_json::from_str(data).map_err(|_| "Malformed model stream event")?;
        match v["type"].as_str().unwrap_or("") {
            "response.output_text.delta" => {
                let t = v["delta"].as_str().unwrap_or("");
                self.result.text.push_str(t);
                delta("text", t);
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                let t = v["delta"].as_str().unwrap_or("");
                self.result.reasoning.push_str(t);
                delta("reasoning", t);
            }
            "response.output_item.added" if v["item"]["type"] == "function_call" => {
                let index = v["output_index"]
                    .as_u64()
                    .ok_or("Tool call has no stream index")?;
                if !self.calls.contains_key(&index) && self.calls.len() >= MAX_CALLS {
                    return Err("Too many tool calls in one model response".into());
                }
                let item = &v["item"];
                self.calls.insert(
                    index,
                    Call {
                        item: item["id"].as_str().unwrap_or("").to_owned(),
                        id: item["call_id"].as_str().unwrap_or("").to_owned(),
                        name: item["name"].as_str().unwrap_or("").to_owned(),
                        arguments: item["arguments"].as_str().unwrap_or("").to_owned(),
                    },
                );
            }
            "response.function_call_arguments.delta" => {
                let t = v["delta"].as_str().unwrap_or("").to_owned();
                if let Some(call) = self.call(&v) {
                    call.arguments.push_str(&t);
                }
            }
            "response.function_call_arguments.done" => {
                if let Some(t) = v["arguments"].as_str().map(str::to_owned)
                    && let Some(call) = self.call(&v)
                {
                    call.arguments = t;
                }
            }
            "response.output_item.done" if v["item"]["type"] == "function_call" => {
                let item = v["item"].clone();
                if let Some(call) = self.call(&v) {
                    for (field, key) in [
                        (&mut call.id, "call_id"),
                        (&mut call.name, "name"),
                        (&mut call.arguments, "arguments"),
                    ] {
                        if let Some(value) = item[key].as_str().filter(|s| !s.is_empty()) {
                            *field = value.to_owned();
                        }
                    }
                }
            }
            "response.completed" | "response.incomplete" => {
                let usage = &v["response"]["usage"];
                self.result.usage = Usage {
                    input: usage["input_tokens"].as_u64().unwrap_or(0),
                    output: usage["output_tokens"].as_u64().unwrap_or(0),
                    cache_read: usage["input_tokens_details"]["cached_tokens"]
                        .as_u64()
                        .unwrap_or(0),
                    cache_write: 0,
                };
                self.done = true;
                return Ok(true);
            }
            "response.failed" => return Err(failure(&v["response"]["error"])),
            "error" => {
                return Err(failure(if v["error"].is_object() {
                    &v["error"]
                } else {
                    &v
                }));
            }
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
        let calls = std::mem::take(&mut self.calls)
            .into_values()
            .map(|c| {
                call(
                    &c.id,
                    &c.name,
                    if c.arguments.trim().is_empty() {
                        "{}"
                    } else {
                        &c.arguments
                    },
                )
            })
            .collect();
        self.result.calls = settle(calls)?;
        Ok(self.result)
    }
}

#[cfg(test)]
mod tests {
    use super::super::sse::Stream;
    use super::*;

    fn history() -> Vec<Value> {
        vec![
            json!({"role":"system","content":"Be brief."}),
            json!({"role":"system","content":"Use tools."}),
            json!({"role":"user","content":"Read two files"}),
            json!({"role":"assistant","content":"Reading.","tool_calls":[
                {"id":"call_1","type":"function","function":{"name":"read","arguments":"{\"path\":\"a\"}"}},
                {"id":"call_2","type":"function","function":{"name":"read","arguments":"{\"path\":\"b\"}"}}]}),
            json!({"role":"tool","tool_call_id":"call_1","content":"A"}),
            json!({"role":"tool","tool_call_id":"call_2","content":"B"}),
            json!({"role":"assistant","content":""}),
            json!({"role":"user","content":"Thanks"}),
        ]
    }

    fn tools() -> Value {
        json!([{"type":"function","function":{"name":"read","description":"Read a file",
            "parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}])
    }

    #[test]
    fn openai_history_converts_to_responses_input() {
        let body = body("grok-4", &history(), &tools(), false);
        let key = body["prompt_cache_key"].as_str().unwrap().to_owned();
        assert_eq!(key.len(), 32);
        assert_eq!(
            body,
            json!({
                "model": "grok-4",
                "stream": true,
                "store": false,
                "instructions": "Be brief.\n\nUse tools.",
                "input": [
                    {"role":"user","content":[{"type":"input_text","text":"Read two files"}]},
                    {"type":"message","role":"assistant","content":[{"type":"output_text","text":"Reading."}]},
                    {"type":"function_call","call_id":"call_1","name":"read","arguments":"{\"path\":\"a\"}"},
                    {"type":"function_call","call_id":"call_2","name":"read","arguments":"{\"path\":\"b\"}"},
                    {"type":"function_call_output","call_id":"call_1","output":"A"},
                    {"type":"function_call_output","call_id":"call_2","output":"B"},
                    {"role":"user","content":[{"type":"input_text","text":"Thanks"}]},
                ],
                "tools": [{"type":"function","name":"read","description":"Read a file",
                           "parameters":{"type":"object","properties":{"path":{"type":"string"}}}}],
                "tool_choice": "auto",
                "parallel_tool_calls": true,
                "prompt_cache_key": key,
            })
        );
    }

    #[test]
    fn the_codex_body_is_stateless_and_its_cache_key_follows_the_prefix() {
        let codex = body("gpt-5.5", &history(), &tools(), true);
        assert_eq!(codex["store"], false);
        assert_eq!(codex["stream"], true);
        assert_eq!(codex["instructions"], "Be brief.\n\nUse tools.");
        assert_eq!(codex["include"], json!(["reasoning.encrypted_content"]));
        assert_eq!(codex["text"], json!({"verbosity":"low"}));
        let key = |b: &Value| b["prompt_cache_key"].clone();
        // A longer conversation keeps the key: only the prefix names it.
        let mut longer = history();
        longer.push(json!({"role":"user","content":"More"}));
        assert_eq!(key(&body("gpt-5.5", &longer, &tools(), true)), key(&codex));
        assert_eq!(
            key(&body("gpt-5.5", &history(), &tools(), true)),
            key(&codex)
        );
        assert_ne!(
            key(&body("gpt-5.5", &history(), &json!([]), true)),
            key(&codex)
        );
        assert_ne!(
            key(&body("gpt-5.4", &history(), &tools(), true)),
            key(&codex)
        );
        let mut other = history();
        other[0] = json!({"role":"system","content":"Be long."});
        assert_ne!(key(&body("gpt-5.5", &other, &tools(), true)), key(&codex));
        assert_eq!(
            body(
                "m",
                &[json!({"role":"user","content":"hi"})],
                &json!([]),
                false
            )["instructions"],
            DEFAULT_INSTRUCTIONS
        );
    }

    const EVENTS: &str = concat!(
        "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{}}\n\n",
        "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"Plan\"}\n\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hel\"}\n\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"lo\"}\n\n",
        "data: {\"type\":\"response.output_item.added\",\"output_index\":1,\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"read\",\"arguments\":\"\"}}\n\n",
        "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"output_index\":1,\"delta\":\"{\\\"pa\"}\n\n",
        "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"output_index\":1,\"delta\":\"th\\\":\\\"a\\\"}\"}\n\n",
        "data: {\"type\":\"response.output_item.done\",\"output_index\":1,\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"read\",\"arguments\":\"{\\\"path\\\":\\\"a\\\"}\"}}\n\n",
        "data: {\"type\":\"response.output_item.added\",\"output_index\":2,\"item\":{\"type\":\"function_call\",\"id\":\"fc_2\",\"call_id\":\"call_2\",\"name\":\"list\"}}\n\n",
        "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_2\",\"delta\":\"{}\"}\n\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":900,\"input_tokens_details\":{\"cached_tokens\":768},\"output_tokens\":30}}}\n\n"
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
    fn the_stream_assembles_text_reasoning_calls_and_cached_usage_at_any_split() {
        for split in 0..EVENTS.len() {
            let (completion, deltas) = run(EVENTS, split);
            let completion = completion.unwrap();
            assert_eq!(completion.text, "Hello");
            assert_eq!(completion.reasoning, "Plan");
            assert_eq!(
                completion.calls,
                [
                    json!({"id":"call_1","type":"function","function":{"name":"read","arguments":"{\"path\":\"a\"}"}}),
                    json!({"id":"call_2","type":"function","function":{"name":"list","arguments":"{}"}}),
                ]
            );
            assert_eq!(
                completion.usage,
                Usage {
                    input: 900,
                    output: 30,
                    cache_read: 768,
                    cache_write: 0
                }
            );
            assert_eq!(deltas.len(), 3);
        }
    }

    #[test]
    fn missing_receipts_failures_and_usage_limits_are_errors() {
        let receipt = EVENTS
            .rfind("data: {\"type\":\"response.completed\"")
            .unwrap();
        let (result, _) = run(&EVENTS[..receipt], 0);
        assert!(result.unwrap_err().contains("without a completion receipt"));
        let (result, _) = run(
            "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"server_error\",\"message\":\"secret\"}}}\n\n",
            0,
        );
        assert_eq!(
            result.unwrap_err(),
            "The model endpoint reported an inference error"
        );
        let (result, _) = run(
            "data: {\"type\":\"error\",\"code\":\"usage_limit_reached\",\"message\":\"plan\"}\n\n",
            0,
        );
        assert_eq!(result.unwrap_err(), USAGE_LIMIT);
        let (result, _) = run(
            "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"rate_limit_exceeded\"}}}\n\n",
            0,
        );
        assert_eq!(result.unwrap_err(), USAGE_LIMIT);
        let incomplete = "data: {\"type\":\"response.incomplete\",\"response\":{\"usage\":{\"input_tokens\":5,\"output_tokens\":1}}}\n\n";
        assert_eq!(run(incomplete, 3).0.unwrap().usage.input, 5);
        let many: String = (0..=MAX_CALLS)
            .map(|i| format!("data: {{\"type\":\"response.output_item.added\",\"output_index\":{i},\"item\":{{\"type\":\"function_call\",\"id\":\"f{i}\",\"call_id\":\"c{i}\",\"name\":\"x\"}}}}\n"))
            .collect();
        assert!(run(&many, 0).0.unwrap_err().contains("Too many tool calls"));
    }
}
