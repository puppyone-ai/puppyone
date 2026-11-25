//! The Built-in Agent's model client: one bounded streaming request per
//! turn step, with no redirect or hidden retry. The kernel keeps its history
//! in OpenAI Chat shape; each protocol driver converts it on the way out and
//! reports the same [`Completion`] back.
mod anthropic;
mod openai_chat;
mod responses;
mod sse;

use super::configuration::{Auth, ModelConnection};
use crate::agent::model_connections::providers::Protocol;
use futures_util::StreamExt;
use serde_json::{Value, json};
use sse::{Events, Stream};

/// Token counts of one response. `input` is the whole prompt, cached
/// tokens included.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

#[derive(Debug, Default)]
pub struct Completion {
    pub text: String,
    pub reasoning: String,
    /// OpenAI-shaped tool calls (`{id, type: "function", function}`).
    pub calls: Vec<Value>,
    pub usage: Usage,
}
impl Completion {
    /// The assistant message, in the kernel's OpenAI Chat shape.
    pub fn message(&self) -> Value {
        let mut v = json!({"role":"assistant","content":self.text});
        if !self.reasoning.is_empty() {
            v["reasoning_content"] = json!(self.reasoning);
        }
        if !self.calls.is_empty() {
            v["tool_calls"] = json!(self.calls);
        }
        v
    }
}

/// One OpenAI-shaped tool call.
fn call(id: &str, name: &str, arguments: &str) -> Value {
    json!({"id":id,"type":"function","function":{"name":name,"arguments":arguments}})
}

/// A response's calls, refused when an identity is missing or repeated.
fn settle(calls: Vec<Value>) -> Result<Vec<Value>, String> {
    let mut ids = std::collections::HashSet::new();
    for call in &calls {
        let id = call["id"].as_str().unwrap_or("");
        if id.is_empty() || !ids.insert(id.to_owned()) {
            return Err("Model returned ambiguous tool identities".into());
        }
    }
    Ok(calls)
}

/// A message's text: a string, or the text parts of a content array.
fn text_of(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
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
    let delta: &mut dyn FnMut(&str, &str) = &mut delta;
    if connection.managed {
        let body = openai_chat::body(&connection.model, context, tool_schema, false);
        return complete_managed(account, body, delta).await;
    }
    let protocol = connection.driver.protocol();
    let oauth = connection.auth == Auth::Oauth;
    let endpoint = connection.endpoint.trim_end_matches('/');
    let client = client()?;
    let send = |credential| {
        let request = build_request(
            &client,
            connection,
            protocol,
            endpoint,
            oauth,
            &credential,
            context,
            &tool_schema,
        );
        async move {
            request?.send().await.map_err(|_| {
                "Model request failed before a response. Check the configured endpoint and connection."
                    .to_owned()
            })
        }
    };
    let mut credential = connection.resolve_credential().await?;
    let mut response = send(credential.clone()).await?;
    // A subscription token the provider refuses may have been rotated or
    // revoked early: refresh it once and retry (Cherry Studio's
    // `forceRefresh`), then ask the user to sign in again.
    if oauth
        && response.status().as_u16() == 401
        && let Some(fresh) = connection.resolve_fresh_credential().await?
    {
        credential = Some(fresh);
        response = send(credential.clone()).await?;
    }
    let status = response.status().as_u16();
    if !response.status().is_success() {
        // What this request carried is masked out of the provider's text.
        let secrets: Vec<String> = credential
            .iter()
            .flat_map(|c| [Some(c.bearer.clone()), c.account_id.clone()])
            .flatten()
            .filter(|s| !s.is_empty())
            .collect();
        let detail = provider_message(response, &secrets).await;
        return Err(status_error(status, oauth, protocol, detail.as_deref()));
    }
    let secret = credential.as_ref().map(|c| c.bearer.as_str());
    match protocol {
        Protocol::OpenaiChat => read(response, openai_chat::Parser::default(), secret, delta).await,
        Protocol::AnthropicMessages => {
            read(response, anthropic::Parser::default(), secret, delta).await
        }
        Protocol::OpenaiResponses | Protocol::CodexResponses => {
            read(response, responses::Parser::default(), secret, delta).await
        }
    }
}

/// The provider's own reason for refusing a request (`error.message`,
/// `message`, `error_description` or `error`): one line, at most 240
/// characters. Never a credential: request headers are not echoed, and a
/// bearer-looking token in the text is masked.
async fn provider_message(response: reqwest::Response, secrets: &[String]) -> Option<String> {
    let bytes = crate::agent::model_connections::read_limited(response, 64 * 1024).await?;
    let head = &bytes[..bytes.len().min(16 * 1024)];
    let body: Value = serde_json::from_slice(head).ok()?;
    let text = [
        &body["error"]["message"],
        &body["message"],
        &body["error_description"],
        &body["error"],
        &body["detail"],
    ]
    .into_iter()
    .find_map(|v| v.as_str().filter(|s| !s.trim().is_empty()))?;
    let mut text = text.to_owned();
    for secret in secrets {
        text = text.replace(secret.as_str(), "…");
    }
    Some(sanitize_message(&text))
}

/// One line, masked tokens, at most 240 characters.
pub fn sanitize_message(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let masked = line
        .split(' ')
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            // Keys, JWTs and account / organization / project identifiers.
            let key_like = [
                "sk-", "sk_", "pk-", "eyj", "bearer", "acct", "org-", "org_", "user-", "user_",
                "proj_", "proj-",
            ]
            .iter()
            .any(|p| lower.starts_with(p))
                && word.len() >= 8;
            let token_like = key_like
                || (word.len() >= 24
                    && word
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)));
            if token_like { "…" } else { word }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let mut out: String = masked.chars().take(240).collect();
    if masked.chars().count() > 240 {
        out.push('…');
    }
    out
}

/// The error a refused request reports: the status and the provider's
/// reason, never its key or account.
fn status_error(status: u16, oauth: bool, protocol: Protocol, detail: Option<&str>) -> String {
    match (status, detail) {
        // Still refused after a fresh token: the sign-in itself is gone.
        (401, _) if oauth => "OAUTH_REAUTH_REQUIRED".into(),
        (429, _)
            if matches!(
                protocol,
                Protocol::OpenaiResponses | Protocol::CodexResponses
            ) =>
        {
            responses::USAGE_LIMIT.into()
        }
        (_, Some(detail)) => format!("Model endpoint returned HTTP {status}: {detail}"),
        _ => format!(
            "Model endpoint returned HTTP {status}. Check its availability, model and credential."
        ),
    }
}

fn client() -> Result<reqwest::Client, String> {
    crate::agent::model_connections::http_client(std::time::Duration::from_secs(300))
        .map_err(|_| "Cannot initialize model client".into())
}

async fn read<P: Events>(
    response: reqwest::Response,
    parser: P,
    secret: Option<&str>,
    delta: &mut dyn FnMut(&str, &str),
) -> Result<Completion, String> {
    let mut bytes = response.bytes_stream();
    let mut stream = Stream::new(parser);
    let mut redactor = Redactor::new(secret);
    let mut done = false;
    while let Some(chunk) = bytes.next().await {
        let chunk =
            chunk.map_err(|_| "Model stream was interrupted; the request was not replayed")?;
        if stream.feed(&redactor.feed(&chunk), delta)? {
            done = true;
            break;
        }
    }
    if !done {
        stream.feed(&redactor.finish(), delta)?;
    }
    stream.finish()
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
    delta: &mut dyn FnMut(&str, &str),
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
    let mut stream = Stream::new(openai_chat::Parser::default());
    while let Some(chunk) = rx.recv().await {
        if stream.feed(&chunk?, delta)? {
            break;
        }
    }
    stream.finish()
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

/// The request for `protocol`, carrying `credential` as that protocol
/// expects.
#[allow(clippy::too_many_arguments)]
fn build_request(
    client: &reqwest::Client,
    connection: &ModelConnection,
    protocol: Protocol,
    endpoint: &str,
    oauth: bool,
    credential: &Option<crate::agent::model_connections::credentials::Resolved>,
    context: &[Value],
    tool_schema: &Value,
) -> Result<reqwest::RequestBuilder, String> {
    let tool_schema = tool_schema.clone();
    Ok(match protocol {
        Protocol::OpenaiChat => {
            let mut request = client.post(format!("{endpoint}/chat/completions"));
            if let Some(credential) = &credential {
                request = request.bearer_auth(&credential.bearer);
            }
            request.json(&openai_chat::body(
                &connection.model,
                context,
                tool_schema,
                openai_chat::keeps_reasoning(connection),
            ))
        }
        Protocol::AnthropicMessages => {
            let mut request = client
                .post(format!("{endpoint}/v1/messages"))
                .header("anthropic-version", anthropic::VERSION);
            match &credential {
                Some(credential) if oauth => request = request.bearer_auth(&credential.bearer),
                Some(credential) => request = request.header("x-api-key", &credential.bearer),
                None => {}
            }
            request.json(&anthropic::body(&connection.model, context, &tool_schema))
        }
        Protocol::OpenaiResponses => {
            let mut request = client.post(format!("{endpoint}/responses"));
            if let Some(credential) = &credential {
                request = request.bearer_auth(&credential.bearer);
            }
            request.json(&responses::body(
                &connection.model,
                context,
                &tool_schema,
                false,
            ))
        }
        Protocol::CodexResponses => {
            let credential = credential.as_ref().ok_or("CREDENTIAL_REQUIRED")?;
            let account_id = credential
                .account_id
                .as_deref()
                .filter(|a| !a.is_empty())
                .ok_or("CREDENTIAL_REQUIRED")?;
            client
                .post(format!("{endpoint}/codex/responses"))
                .bearer_auth(&credential.bearer)
                .header("chatgpt-account-id", account_id)
                .header("originator", "puppyone")
                .header("OpenAI-Beta", "responses=experimental")
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .json(&responses::body(
                    &connection.model,
                    context,
                    &tool_schema,
                    true,
                ))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
            futures_util::FutureExt::now_or_never(complete_managed(&asked, body, &mut |_, _| {}))
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
        let _ =
            futures_util::FutureExt::now_or_never(complete_managed(&asked, small, &mut |_, _| {}));
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
}

#[cfg(test)]
mod redaction_tests {
    use super::*;

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
        let mut stream = Stream::new(openai_chat::Parser::default());
        let mut shown = String::new();
        let mut sink = |_: &str, text: &str| shown.push_str(text);
        assert!(stream.feed(&out, &mut sink).unwrap());
        assert_eq!(shown, "中文😀 [redacted] done");
        assert_eq!(stream.finish().unwrap().text, "中文😀 [redacted] done");
        // Without a key the stream passes through untouched.
        assert_eq!(Redactor::new(None).feed(b"abc"), b"abc");
    }
}
