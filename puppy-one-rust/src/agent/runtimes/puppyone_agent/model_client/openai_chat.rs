//! OpenAI Chat Completions (`/chat/completions`): the protocol of
//! OpenAI-compatible services, local servers and PuppyOne compute.
use super::sse::{Events, MAX_CALLS};
use super::{Completion, Usage, settle};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The request body: the context and tools are already in this shape.
/// `keep_details`: the service takes OpenRouter's `reasoning_details` back
/// (PuppyOne compute and OpenRouter); others get them stripped.
pub fn body(
    model: &str,
    context: &[Value],
    tools: Value,
    keep_reasoning: bool,
    keep_details: bool,
) -> Value {
    let messages: Vec<Value> = context
        .iter()
        .map(|message| {
            let mut message = message.clone();
            if let Some(m) = message.as_object_mut() {
                if !keep_details {
                    m.remove("reasoning_details");
                }
                if !keep_reasoning {
                    m.remove("reasoning_content");
                } else if m.get("role").and_then(Value::as_str) == Some("assistant") {
                    // A turn from another model carries no thinking; these
                    // providers refuse an assistant turn without the field
                    // (Pi: `reasoning_content = ""`).
                    m.entry("reasoning_content").or_insert_with(|| json!(""));
                }
            }
            message
        })
        .collect();
    json!({"model":model,"messages":messages,"tools":tools,"stream":true,"stream_options":{"include_usage":true}})
}

/// Providers whose thinking models need an assistant turn's
/// `reasoning_content` sent back with it (Pi: `requiresReasoningContentOn
/// AssistantMessages` for Kimi's K3 family; Kimi Code and Moonshot). Others
/// get it stripped: some refuse the field.
pub fn keeps_reasoning(
    connection: &crate::agent::model_connections::configuration::ModelConnection,
) -> bool {
    let host = url::Url::parse(&connection.endpoint)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .unwrap_or_default();
    matches!(
        connection.provider.as_deref(),
        Some("kimi-code" | "moonshot")
    ) || host == "api.kimi.com"
        || host.ends_with("moonshot.ai")
        || host.ends_with("moonshot.cn")
}

/// Services that take OpenRouter's `reasoning_details` back with the
/// model's own assistant turns.
pub fn keeps_reasoning_details(
    connection: &crate::agent::model_connections::configuration::ModelConnection,
) -> bool {
    let host = url::Url::parse(&connection.endpoint)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .unwrap_or_default();
    connection.provider.as_deref() == Some("openrouter") || host.ends_with("openrouter.ai")
}

/// The Chat Completions event stream; `[DONE]` is its receipt.
#[derive(Default)]
pub struct Parser {
    result: Completion,
    calls: BTreeMap<usize, Value>,
    done: bool,
}

fn usage(v: &Value) -> Usage {
    let number = |v: &Value| v.as_u64().unwrap_or(0);
    Usage {
        input: number(&v["prompt_tokens"]),
        output: number(&v["completion_tokens"]),
        cache_read: v["prompt_tokens_details"]["cached_tokens"]
            .as_u64()
            // DeepSeek reports its cache hits on their own.
            .or_else(|| v["prompt_cache_hit_tokens"].as_u64())
            .unwrap_or(0),
        cache_write: 0,
    }
}

impl Events for Parser {
    fn data(
        &mut self,
        _: &str,
        data: &str,
        delta: &mut dyn FnMut(&str, &str),
    ) -> Result<bool, String> {
        if data == "[DONE]" {
            self.done = true;
            return Ok(true);
        }
        if data.is_empty() {
            return Ok(false);
        }
        let v: Value = serde_json::from_str(data).map_err(|_| "Malformed model stream event")?;
        if let Some(error) = v.get("error").filter(|e| !e.is_null()) {
            return Err(stream_error_message(error));
        }
        if v["usage"].is_object() {
            self.result.usage = usage(&v["usage"]);
        }
        let d = &v["choices"][0]["delta"];
        if let Some(t) = d["content"].as_str() {
            self.result.text.push_str(t);
            delta("text", t);
        }
        // `reasoning_content` (DeepSeek, Kimi) or `reasoning` (OpenRouter).
        let mut streamed_reasoning = false;
        if let Some(t) = d["reasoning_content"]
            .as_str()
            .or_else(|| d["reasoning"].as_str())
            .filter(|t| !t.is_empty())
        {
            self.result.reasoning.push_str(t);
            delta("reasoning", t);
            streamed_reasoning = true;
        }
        if let Some(details) = d["reasoning_details"].as_array() {
            let target = self.result.reasoning_details.get_or_insert_with(Vec::new);
            for item in details {
                merge_reasoning_detail(target, item);
                if !streamed_reasoning
                    && let Some(t) = item["text"]
                        .as_str()
                        .or_else(|| item["summary"].as_str())
                        .filter(|t| !t.is_empty())
                {
                    self.result.reasoning.push_str(t);
                    delta("reasoning", t);
                }
            }
        }
        for call in d["tool_calls"].as_array().into_iter().flatten() {
            let index = call["index"]
                .as_u64()
                .ok_or("Tool call has no stream index")? as usize;
            if index >= MAX_CALLS {
                return Err("Too many tool calls in one model response".into());
            }
            let entry = self.calls.entry(index).or_insert_with(
                || json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
            );
            if let Some(t) = call["id"].as_str() {
                let mut value = entry["id"].as_str().unwrap_or("").to_owned();
                value.push_str(t);
                entry["id"] = json!(value);
            }
            for key in ["name", "arguments"] {
                if let Some(t) = call["function"][key].as_str() {
                    let mut value = entry["function"][key].as_str().unwrap_or("").to_owned();
                    value.push_str(t);
                    entry["function"][key] = json!(value);
                }
            }
        }
        Ok(false)
    }

    fn finish(mut self) -> Result<Completion, String> {
        if !self.done {
            return Err(
                "Model stream ended without a completion receipt; nothing was replayed".into(),
            );
        }
        self.result.calls = settle(std::mem::take(&mut self.calls).into_values().collect())?;
        Ok(self.result)
    }
}

/// An SSE `{"error": ...}` payload as one bounded, readable line.
fn stream_error_message(error: &Value) -> String {
    if let Some(code) = error["code"].as_str() {
        let words = match code {
            "ai_usage_pending" => {
                "The model request was interrupted. Balance will refresh after usage is reconciled."
            }
            "ai_provider_unavailable" => {
                "The model provider is temporarily unavailable. Try again shortly."
            }
            "ai_balance_insufficient" => "Add credit to use this model.",
            "ai_rate_limited" => "PuppyOne compute is busy. Try again shortly.",
            _ => "",
        };
        if !words.is_empty() {
            return words.to_owned();
        }
    }
    if let Some(message) = error
        .as_str()
        .or_else(|| error["message"].as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return super::sanitize_message(message);
    }
    "The model endpoint reported an inference error".into()
}

/// Accumulates streamed OpenRouter `reasoning_details` chunks by
/// `(type, id, index)`.
fn merge_reasoning_detail(target: &mut Vec<Value>, item: &Value) {
    let kind = item["type"].as_str().unwrap_or_default();
    let id = item.get("id").and_then(Value::as_str);
    let index = item.get("index").and_then(Value::as_u64);
    if let Some(existing) = target.iter_mut().find(|entry| {
        entry["type"].as_str().unwrap_or_default() == kind
            && entry.get("id").and_then(Value::as_str) == id
            && entry.get("index").and_then(Value::as_u64) == index
    }) {
        let field = match kind {
            "reasoning.text" => Some("text"),
            "reasoning.summary" => Some("summary"),
            "reasoning.encrypted" => Some("data"),
            _ => None,
        };
        if let Some(field) = field {
            if let Some(more) = item[field].as_str() {
                let mut joined = existing[field].as_str().unwrap_or("").to_owned();
                joined.push_str(more);
                existing[field] = Value::from(joined);
            }
            if kind == "reasoning.text"
                && let Some(signature) = item["signature"].as_str()
            {
                existing["signature"] = Value::from(signature);
            }
            return;
        }
    }
    target.push(item.clone());
}

#[cfg(test)]
mod tests {
    use super::super::sse::Stream;
    use super::*;

    const EVENTS: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Hmm\"}}]}\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"lo\",\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"pa\"}}]}}]}\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"th\\\":1}\"}}]}}]}\n",
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":7,\"prompt_tokens_details\":{\"cached_tokens\":64}}}\n",
        "data: [DONE]\n"
    );

    fn run(input: &str, split: usize) -> (Result<Completion, String>, Vec<(String, String)>) {
        let mut deltas = vec![];
        let mut sink = |kind: &str, text: &str| deltas.push((kind.to_owned(), text.to_owned()));
        let mut stream = Stream::new(Parser::default());
        let (a, b) = input.as_bytes().split_at(split);
        let result = (|| {
            if !stream.feed(a, &mut sink)? {
                stream.feed(b, &mut sink)?;
            }
            Ok::<_, String>(())
        })();
        let result = result.and_then(|_| stream.finish());
        (result, deltas)
    }

    #[test]
    fn the_stream_parser_assembles_text_reasoning_calls_and_usage_at_any_split() {
        for split in 0..EVENTS.len() {
            let (completion, deltas) = run(EVENTS, split);
            let completion = completion.unwrap();
            assert_eq!(completion.text, "Hello");
            assert_eq!(completion.reasoning, "Hmm");
            assert_eq!(
                completion.calls,
                [
                    json!({"id":"c1","type":"function","function":{"name":"read","arguments":"{\"path\":1}"}})
                ]
            );
            assert_eq!(
                completion.usage,
                Usage {
                    input: 100,
                    output: 7,
                    cache_read: 64,
                    cache_write: 0
                }
            );
            assert_eq!(deltas.len(), 3);
        }
    }

    #[test]
    fn missing_receipts_errors_and_ambiguous_calls_fail() {
        let (result, _) = run(&EVENTS.replace("data: [DONE]\n", ""), 0);
        assert!(result.unwrap_err().contains("without a completion receipt"));
        // The service's reason reads as one masked line, like an HTTP refusal.
        let (result, _) = run(
            "data: {\"error\":{\"message\":\"Rate limited for sk-abcdef1234567890\"}}\n",
            0,
        );
        assert_eq!(result.unwrap_err(), "Rate limited for …");
        let (result, _) = run("data: {\"error\":{}}\n", 0);
        assert_eq!(
            result.unwrap_err(),
            "The model endpoint reported an inference error"
        );
        let (result, _) = run(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":32,\"id\":\"x\"}]}}]}\n",
            0,
        );
        assert!(result.unwrap_err().contains("Too many tool calls"));
        let (result, _) = run(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"a\"}}]}}]}\ndata: [DONE]\n",
            0,
        );
        assert_eq!(
            result.unwrap_err(),
            "Model returned ambiguous tool identities"
        );
    }

    #[test]
    fn thinking_goes_back_only_to_providers_that_need_it() {
        use crate::agent::model_connections::configuration::ModelConnection;
        let context = vec![serde_json::json!({
            "role": "assistant", "content": "", "reasoning_content": "Plan",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "ls", "arguments": "{}"}}]
        })];
        let kimi = ModelConnection {
            endpoint: "https://api.kimi.com/coding/v1".into(),
            ..Default::default()
        };
        let deepseek = ModelConnection {
            endpoint: "https://api.deepseek.com/v1".into(),
            ..Default::default()
        };
        assert!(keeps_reasoning(&kimi) && !keeps_reasoning(&deepseek));
        let kept = body("k", &context, serde_json::json!([]), true, false);
        assert_eq!(kept["messages"][0]["reasoning_content"], "Plan");
        let dropped = body("d", &context, serde_json::json!([]), false, false);
        assert!(dropped["messages"][0].get("reasoning_content").is_none());
        assert_eq!(dropped["messages"][0]["tool_calls"][0]["id"], "c1");
        // Another model's turn reaches Kimi with an empty field, never
        // without one.
        let foreign = vec![
            serde_json::json!({"role": "user", "content": "Hi"}),
            serde_json::json!({"role": "assistant", "content": "Hello"}),
        ];
        let kept = body("k", &foreign, serde_json::json!([]), true, false);
        assert!(kept["messages"][0].get("reasoning_content").is_none());
        assert_eq!(kept["messages"][1]["reasoning_content"], "");
    }

    /// A `null` error is no error; a stream's error reads as words; the
    /// reasoning dialects (`reasoning`, OpenRouter's `reasoning_details`
    /// merged by id) all reach the transcript, and the details go back.
    #[test]
    fn parser_ignores_null_error_surfaces_stream_error_and_parses_reasoning_dialects() {
        let mut stream = Stream::new(Parser::default());
        let mut deltas = vec![];
        let mut sink = |kind: &str, text: &str| deltas.push((kind.to_owned(), text.to_owned()));
        let events = concat!(
            "data: {\"error\":null,\"choices\":[{\"delta\":{\"reasoning\":\"step 1 \"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"reasoning_details\":[{\"type\":\"reasoning.text\",\"id\":\"r1\",\"index\":0,\"text\":\"step 2\"}]}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"reasoning_details\":[{\"type\":\"reasoning.text\",\"id\":\"r1\",\"index\":0,\"text\":\" done\",\"signature\":\"sig1\"}]}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Answer\"}}]}\n",
            "data: [DONE]\n"
        );
        assert!(stream.feed(events.as_bytes(), &mut sink).unwrap());
        let completion = stream.finish().unwrap();
        assert_eq!(completion.text, "Answer");
        assert_eq!(completion.reasoning, "step 1 step 2 done");
        let details = completion.reasoning_details.as_ref().unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(details[0]["text"], "step 2 done");
        assert_eq!(details[0]["signature"], "sig1");
        assert_eq!(
            completion.message()["reasoning_details"][0]["signature"],
            "sig1"
        );

        let mut failed = Stream::new(Parser::default());
        let error = failed
            .feed(
                b"data: {\"error\":{\"code\":\"ai_usage_pending\",\"message\":\"interrupted\"}}\n",
                &mut |_, _| {},
            )
            .unwrap_err();
        assert!(error.contains("reconciled"), "{error}");
    }

    /// Only a service that takes them back gets `reasoning_details`.
    #[test]
    fn reasoning_details_go_back_only_where_they_are_taken() {
        use crate::agent::model_connections::configuration::ModelConnection;
        let context = vec![serde_json::json!({
            "role": "assistant", "content": "",
            "reasoning_details": [{"type": "reasoning.text", "text": "Plan"}]
        })];
        let openrouter = ModelConnection {
            endpoint: "https://openrouter.ai/api/v1".into(),
            ..Default::default()
        };
        assert!(keeps_reasoning_details(&openrouter));
        let kept = body("o", &context, serde_json::json!([]), false, true);
        assert_eq!(kept["messages"][0]["reasoning_details"][0]["text"], "Plan");
        let dropped = body("d", &context, serde_json::json!([]), false, false);
        assert!(dropped["messages"][0].get("reasoning_details").is_none());
    }
}
