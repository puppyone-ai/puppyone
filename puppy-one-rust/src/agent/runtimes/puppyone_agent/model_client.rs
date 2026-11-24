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
    account: &dyn crate::agent::model_connections::ComputeAccount,
    context: &[Value],
    tool_schema: Value,
    mut delta: impl FnMut(&str, &str),
) -> Result<Completion, String> {
    connection.validate()?;
    let body = json!({"model":connection.model,"messages":context,"tools":tool_schema,"stream":true,"stream_options":{"include_usage":true}});
    if connection.managed {
        return complete_managed(account, body, delta).await;
    }
    let mut request = crate::platform::proxy::system(reqwest::Client::builder())
        .redirect_policy(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|_| "Cannot initialize model client")?
        .post(format!(
            "{}/chat/completions",
            connection.endpoint.trim_end_matches('/')
        ));
    let secret = connection.credential()?;
    if let Some(secret) = &secret {
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
    let mut redactor = Redactor::new(secret.as_deref());
    let mut done = false;
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| "Model stream was interrupted; the request was not replayed")?;
        if parser.feed(&redactor.feed(&chunk), &mut delta)? {
            done = true;
            break;
        }
    }
    if !done {
        parser.feed(&redactor.finish(), &mut delta)?;
    }
    parser.finish()
}

/// `redactModelResponse`: the connection's own key, echoed by a provider,
/// is replaced before the stream is parsed, shown or kept — also when the
/// echo is split across network chunks. Bytes that could begin the key wait
/// for the next chunk.
struct Redactor {
    secret: Vec<u8>,
    held: Vec<u8>,
}
impl Redactor {
    fn new(secret: Option<&str>) -> Self {
        Self {
            secret: secret.unwrap_or_default().as_bytes().to_vec(),
            held: Vec::new(),
        }
    }
    fn feed(&mut self, chunk: &[u8]) -> Vec<u8> {
        if self.secret.is_empty() {
            return chunk.to_vec();
        }
        self.held.extend_from_slice(chunk);
        let mut out = Vec::with_capacity(self.held.len());
        let mut at = 0;
        while let Some(found) = self.held[at..]
            .windows(self.secret.len())
            .position(|w| w == self.secret.as_slice())
        {
            out.extend_from_slice(&self.held[at..at + found]);
            out.extend_from_slice(b"[redacted]");
            at += found + self.secret.len();
        }
        let keep = (self.secret.len() - 1).min(self.held.len() - at);
        let end = self.held.len() - keep;
        out.extend_from_slice(&self.held[at..end]);
        self.held.drain(..end);
        out
    }
    fn finish(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.held)
    }
}

/// PuppyOne compute (`openAgentStream`): the signed-in account's broker
/// sends the request once; its stream feeds the same parser. A lost
/// response is not replayed — it may already have been charged.
/// The largest managed request sent (`512 KiB`, the product's proxy).
const MANAGED_REQUEST_LIMIT: usize = 512 * 1024;

async fn complete_managed(
    account: &dyn crate::agent::model_connections::ComputeAccount,
    body: Value,
    mut delta: impl FnMut(&str, &str),
) -> Result<Completion, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    // `ai_request_too_large`: answered here, never sent.
    if serde_json::to_vec(&body).map_or(true, |b| b.len() > MANAGED_REQUEST_LIMIT) {
        return Err(format!(
            "This conversation is too large. Start a new conversation. Reference: {request_id}"
        ));
    }
    let (broker, binding) = account.current().ok_or_else(|| {
        crate::localization::t("settings.account.signedOutDetailCompute").to_owned()
    })?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Result<Vec<u8>, String>>();
    let cancel = crate::cloud::auth::Cancellation::default();
    let guard = cancel.clone();
    std::thread::spawn(move || {
        let sink_tx = tx.clone();
        let model = body["model"].as_str().unwrap_or_default().to_owned();
        let result = broker.completion(&binding, &body, &request_id, &cancel, &mut |event| {
            match event {
                // Its receipt is read after the wallet's next refresh.
                crate::cloud::auth::StreamEvent::Reservation(id) => {
                    crate::cloud::auth::reservation::note(&binding, id, &model)
                }
                crate::cloud::auth::StreamEvent::Data(bytes) => {
                    if sink_tx.send(Ok(bytes.to_vec())).is_err() {
                        return Err(crate::cloud::auth::Error::Cancelled);
                    }
                }
                crate::cloud::auth::StreamEvent::Connected => {}
            }
            Ok(())
        });
        if let Err(error) = result {
            let _ = tx.send(Err(managed_refusal(error)));
        }
    });
    // Dropping the turn cancels the request.
    struct Stop(crate::cloud::auth::Cancellation);
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

/// What a refused managed request says: the service's reviewed code as
/// words, and its reference, never the service's own prose.
fn managed_refusal(error: crate::cloud::auth::Error) -> String {
    use crate::cloud::auth::Error;
    let (code, reference) = match error {
        Error::Http(402) | Error::Response(402, _, _) => {
            return crate::localization::t("agent.compute.paymentUnavailable").to_owned();
        }
        Error::Cancelled => return "Turn stopped".to_owned(),
        Error::Response(_, Some(code), diagnostic) if code.starts_with("ai_") => {
            (code, diagnostic.request_id)
        }
        _ => {
            return "PuppyOne compute did not complete the request; it was not replayed".to_owned();
        }
    };
    let words = match code {
        "ai_request_invalid" => "The Agent request is not valid.",
        "ai_request_too_large" => "This conversation is too large. Start a new conversation.",
        "ai_context_limit" => {
            "This conversation is longer than the model can read. Start a new conversation."
        }
        "ai_model_unavailable" | "ai_route_unavailable" => "Select an available Agent model.",
        "ai_balance_insufficient" => "Add credit to use this model.",
        "ai_rate_limited" => "PuppyOne compute is busy. Try again shortly.",
        "ai_access_denied" | "ai_authentication_required" => {
            "Sign in again to use PuppyOne compute."
        }
        _ => "PuppyOne compute could not answer the request.",
    };
    match reference {
        Some(reference) => format!("{words} Reference: {}", reference.as_str()),
        None => words.to_owned(),
    }
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

    /// `managedConnection.test.mjs` #17 (`returns a readable local protocol
    /// error for invalid input`, the oversized body): a managed request
    /// over 512 KiB is answered here with its reference, before any
    /// account or network is asked.
    #[test]
    fn an_oversized_managed_request_is_refused_before_it_is_sent() {
        struct Asked(std::sync::atomic::AtomicBool);
        impl crate::agent::model_connections::ComputeAccount for Asked {
            fn current(
                &self,
            ) -> Option<(
                std::sync::Arc<crate::cloud::auth::Broker>,
                crate::cloud::auth::model::Binding,
            )> {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
                None
            }
        }
        let asked = Asked(Default::default());
        let body = json!({"model": "test/model", "messages": [{"role": "user", "content": "x".repeat(524_289)}]});
        let error =
            futures_util::FutureExt::now_or_never(complete_managed(&asked, body, |_, _| {}))
                .unwrap()
                .err()
                .unwrap();
        let reference = error
            .strip_prefix("This conversation is too large. Start a new conversation. Reference: ")
            .unwrap();
        assert!(uuid::Uuid::parse_str(reference).is_ok(), "{error}");
        assert!(
            !asked.0.load(std::sync::atomic::Ordering::SeqCst),
            "nothing asked"
        );
        // Within the limit, the account is asked.
        let small = json!({"model": "test/model", "messages": []});
        let _ = futures_util::FutureExt::now_or_never(complete_managed(&asked, small, |_, _| {}));
        assert!(asked.0.load(std::sync::atomic::Ordering::SeqCst));
    }

    /// #15 at the model client: the reviewed refusal reads as words with
    /// its reference; prose and unknown codes never surface.
    #[test]
    fn a_reviewed_refusal_reads_as_words_with_its_reference() {
        use crate::cloud::auth::{
            Error,
            model::{Diagnostic, RequestId},
        };
        let refused = |code, reference: Option<&str>| {
            managed_refusal(Error::Response(
                422,
                Some(code),
                Diagnostic {
                    retryable: None,
                    request_id: reference.and_then(RequestId::parse),
                },
            ))
        };
        assert_eq!(
            refused("ai_request_invalid", Some("reference-123")),
            "The Agent request is not valid. Reference: reference-123"
        );
        assert_eq!(
            refused("ai_model_unavailable", None),
            "Select an available Agent model."
        );
        assert_eq!(
            refused("ai_usage_pending", Some("r-1")),
            "PuppyOne compute could not answer the request. Reference: r-1"
        );
        assert_eq!(
            managed_refusal(Error::Unavailable),
            "PuppyOne compute did not complete the request; it was not replayed"
        );
    }

    /// `redacts split provider echoes before native persistence, preserving
    /// Unicode`: one byte at a time, the key never reaches the parser.
    #[test]
    fn an_echoed_key_is_redacted_even_one_byte_at_a_time() {
        let text = "data: {\"choices\":[{\"delta\":{\"content\":\"中文😀 synthetic-private-key done\"}}]}\n\ndata: [DONE]\n";
        let mut redactor = Redactor::new(Some("synthetic-private-key"));
        let mut out = Vec::new();
        for byte in text.as_bytes() {
            out.extend(redactor.feed(std::slice::from_ref(byte)));
        }
        out.extend(redactor.finish());
        assert_eq!(
            String::from_utf8(out.clone()).unwrap(),
            text.replace("synthetic-private-key", "[redacted]")
        );
        let mut parser = Parser::default();
        let mut shown = String::new();
        let mut sink = |_: &str, text: &str| shown.push_str(text);
        assert!(parser.feed(&out, &mut sink).unwrap());
        assert_eq!(shown, "中文😀 [redacted] done");
        assert_eq!(parser.finish().unwrap().text, "中文😀 [redacted] done");
        // Without a key the stream passes through untouched.
        assert_eq!(Redactor::new(None).feed(b"abc"), b"abc");
    }
}
