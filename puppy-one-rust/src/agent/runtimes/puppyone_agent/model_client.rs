//! Bounded OpenAI-compatible Chat Completions stream, with no redirect or hidden retry.
use super::configuration::ModelConnection;
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Default)]
pub struct Completion {
    pub text: String,
    pub reasoning: String,
    pub calls: Vec<Value>,
    pub usage: Value,
}
impl Completion {
    pub fn message(&self) -> Value {
        let mut v = json!({"role":"assistant","content":self.text});
        if !self.calls.is_empty() {
            v["tool_calls"] = json!(self.calls);
        }
        v
    }
}
pub async fn complete(
    connection: &ModelConnection,
    context: &[Value],
    tool_schema: Value,
    mut delta: impl FnMut(&str, &str),
) -> Result<Completion, String> {
    connection.validate()?;
    let mut request = reqwest::Client::builder()
        .redirect_policy(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|_| "Cannot initialize model client")?
        .post(format!(
            "{}/chat/completions",
            connection.endpoint.trim_end_matches('/')
        ));
    if let Some(secret) = connection.credential()? {
        request = request.bearer_auth(secret);
    }
    let body = json!({"model":connection.model,"messages":context,"tools":tool_schema,"stream":true,"stream_options":{"include_usage":true}});
    let response = request.json(&body).send().await.map_err(
        |_| "Model request failed before a response. Check the configured endpoint and connection.",
    )?;
    if !response.status().is_success() {
        return Err(format!(
            "Model endpoint returned HTTP {}. Check its availability, model and credential.",
            response.status().as_u16()
        ));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut result = Completion::default();
    let mut calls: BTreeMap<usize, Value> = BTreeMap::new();
    let mut done = false;
    let mut total = 0usize;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| "Model stream was interrupted; the request was not replayed")?;
        total += chunk.len();
        if total > 16 * 1024 * 1024 {
            return Err("Model output exceeded the turn limit".into());
        }
        buffer.extend_from_slice(&chunk);
        if buffer.len() > 2 * 1024 * 1024 {
            return Err("Model event exceeded its frame limit".into());
        }
        while let Some(end) = buffer.iter().position(|c| *c == b'\n') {
            let line = buffer.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "Invalid UTF-8 model stream")?
                .trim();
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data == "[DONE]" {
                done = true;
                break;
            }
            if data.is_empty() {
                continue;
            }
            let v: Value =
                serde_json::from_str(data).map_err(|_| "Malformed model stream event")?;
            if v.get("error").is_some() {
                return Err("The model endpoint reported an inference error".into());
            }
            if !v["usage"].is_null() {
                result.usage = v["usage"].clone();
            }
            let d = &v["choices"][0]["delta"];
            if let Some(t) = d["content"].as_str() {
                result.text.push_str(t);
                delta("text", t);
            }
            if let Some(t) = d["reasoning_content"].as_str() {
                result.reasoning.push_str(t);
                delta("reasoning", t);
            }
            for call in d["tool_calls"].as_array().into_iter().flatten() {
                let index = call["index"]
                    .as_u64()
                    .ok_or("Tool call has no stream index")? as usize;
                if index >= 32 {
                    return Err("Too many tool calls in one model response".into());
                }
                let entry = calls.entry(index).or_insert_with(
                    || json!({"id":"","type":"function","function":{"name":"","arguments":""}}),
                );
                for key in ["id"] {
                    if let Some(t) = call[key].as_str() {
                        let mut value = entry[key].as_str().unwrap_or("").to_owned();
                        value.push_str(t);
                        entry[key] = json!(value);
                    }
                }
                for key in ["name", "arguments"] {
                    if let Some(t) = call["function"][key].as_str() {
                        let mut value = entry["function"][key].as_str().unwrap_or("").to_owned();
                        value.push_str(t);
                        entry["function"][key] = json!(value);
                    }
                }
            }
        }
        if done {
            break;
        }
    }
    if !done {
        return Err("Model stream ended without a completion receipt; nothing was replayed".into());
    }
    result.calls = calls.into_values().collect();
    let mut ids = std::collections::HashSet::new();
    for call in &result.calls {
        let id = call["id"].as_str().unwrap_or("");
        if id.is_empty() || !ids.insert(id) {
            return Err("Model returned ambiguous tool identities".into());
        }
    }
    Ok(result)
}
