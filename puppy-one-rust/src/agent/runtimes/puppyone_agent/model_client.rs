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
    let body = json!({"model":connection.model,"messages":context,"tools":tool_schema,"stream":true,"stream_options":{"include_usage":true}});
    if connection.managed {
        return complete_managed(body, delta).await;
    }
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
    let mut parser = Parser::default();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| "Model stream was interrupted; the request was not replayed")?;
        if parser.feed(&chunk, &mut delta)? {
            break;
        }
    }
    parser.finish()
}

/// PuppyOne compute (`openAgentStream`): the signed-in account's broker
/// sends the request once; its stream feeds the same parser. A lost
/// response is not replayed — it may already have been charged.
async fn complete_managed(
    body: Value,
    mut delta: impl FnMut(&str, &str),
) -> Result<Completion, String> {
    let (broker, binding) = crate::cloud_auth::current().ok_or_else(|| {
        crate::localization::t("settings.account.signedOutDetailCompute").to_owned()
    })?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Result<Vec<u8>, String>>();
    let cancel = crate::cloud_auth::Cancellation::default();
    let guard = cancel.clone();
    std::thread::spawn(move || {
        let request_id = uuid::Uuid::new_v4().to_string();
        let sink_tx = tx.clone();
        let result = broker.completion(&binding, &body, &request_id, &cancel, &mut |event| {
            if let crate::cloud_auth::StreamEvent::Data(bytes) = event
                && sink_tx.send(Ok(bytes.to_vec())).is_err()
            {
                return Err(crate::cloud_auth::Error::Cancelled);
            }
            Ok(())
        });
        if let Err(error) = result {
            let _ = tx.send(Err(match error {
                crate::cloud_auth::Error::Http(402)
                | crate::cloud_auth::Error::Response(402, _) => {
                    crate::localization::t("agent.compute.paymentUnavailable").to_owned()
                }
                crate::cloud_auth::Error::Cancelled => "Turn stopped".to_owned(),
                _ => {
                    "PuppyOne compute did not complete the request; it was not replayed".to_owned()
                }
            }));
        }
    });
    // Dropping the turn cancels the request.
    struct Stop(crate::cloud_auth::Cancellation);
    impl Drop for Stop {
        fn drop(&mut self) {
            self.0.cancel();
        }
    }
    let _stop = Stop(guard);
    let mut parser = Parser::default();
    while let Some(chunk) = rx.recv().await {
        if parser.feed(&chunk?, &mut delta)? {
            break;
        }
    }
    parser.finish()
}

/// The bounded OpenAI Chat Completions event stream.
#[derive(Default)]
struct Parser {
    buffer: Vec<u8>,
    result: Completion,
    calls: BTreeMap<usize, Value>,
    done: bool,
    total: usize,
}
impl Parser {
    /// `Ok(true)` once the stream sent `[DONE]`.
    fn feed(&mut self, chunk: &[u8], delta: &mut impl FnMut(&str, &str)) -> Result<bool, String> {
        self.total += chunk.len();
        if self.total > 16 * 1024 * 1024 {
            return Err("Model output exceeded the turn limit".into());
        }
        self.buffer.extend_from_slice(chunk);
        if self.buffer.len() > 2 * 1024 * 1024 {
            return Err("Model event exceeded its frame limit".into());
        }
        while let Some(end) = self.buffer.iter().position(|c| *c == b'\n') {
            let line = self.buffer.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|_| "Invalid UTF-8 model stream")?
                .trim();
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data == "[DONE]" {
                self.done = true;
                return Ok(true);
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
                self.result.usage = v["usage"].clone();
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
                if index >= 32 {
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
        }
        Ok(false)
    }
    fn finish(mut self) -> Result<Completion, String> {
        if !self.done {
            return Err(
                "Model stream ended without a completion receipt; nothing was replayed".into(),
            );
        }
        self.result.calls = std::mem::take(&mut self.calls).into_values().collect();
        let mut ids = std::collections::HashSet::new();
        for call in &self.result.calls {
            let id = call["id"].as_str().unwrap_or("");
            if id.is_empty() || !ids.insert(id) {
                return Err("Model returned ambiguous tool identities".into());
            }
        }
        Ok(self.result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_stream_parser_assembles_text_and_tool_calls_across_chunks() {
        let mut parser = Parser::default();
        let mut deltas = vec![];
        let mut sink = |kind: &str, text: &str| deltas.push((kind.to_owned(), text.to_owned()));
        let events = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\",\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"read\",\"arguments\":\"{}\"}}]}}]}\n",
            "data: [DONE]\n"
        );
        let (a, b) = events.split_at(30);
        assert!(!parser.feed(a.as_bytes(), &mut sink).unwrap());
        assert!(parser.feed(b.as_bytes(), &mut sink).unwrap());
        let completion = parser.finish().unwrap();
        assert_eq!(completion.text, "Hello");
        assert_eq!(completion.calls.len(), 1);
        assert_eq!(deltas.len(), 2);
        // No receipt: nothing is assumed.
        assert!(Parser::default().finish().is_err());
    }
}
