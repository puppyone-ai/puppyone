//! OpenAI Chat Completions (`/chat/completions`): the protocol of
//! OpenAI-compatible services, local servers and PuppyOne compute.
use super::sse::{Events, MAX_CALLS};
use super::{Completion, Usage, settle};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The request body: the context and tools are already in this shape.
pub fn body(model: &str, context: &[Value], tools: Value) -> Value {
    json!({"model":model,"messages":context,"tools":tools,"stream":true,"stream_options":{"include_usage":true}})
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
        if v.get("error").is_some() {
            return Err("The model endpoint reported an inference error".into());
        }
        if v["usage"].is_object() {
            self.result.usage = usage(&v["usage"]);
        }
        let d = &v["choices"][0]["delta"];
        if let Some(t) = d["content"].as_str() {
            self.result.text.push_str(t);
            delta("text", t);
        }
        if let Some(t) = d["reasoning_content"].as_str() {
            self.result.reasoning.push_str(t);
            delta("reasoning", t);
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
        let (result, _) = run("data: {\"error\":{\"message\":\"secret\"}}\n", 0);
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
}
