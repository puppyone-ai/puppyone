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
    match protocol {
        Protocol::OpenaiChat => read(response, openai_chat::Parser::default(), delta).await,
        Protocol::AnthropicMessages => read(response, anthropic::Parser::default(), delta).await,
        Protocol::OpenaiResponses | Protocol::CodexResponses => {
            read(response, responses::Parser::default(), delta).await
        }
    }
}

/// The provider's own reason for refusing a request (`error.message`,
/// `message`, `error_description` or `error`): one line, at most 240
/// characters. Never a credential: request headers are not echoed, and a
/// bearer-looking token in the text is masked.
async fn provider_message(response: reqwest::Response, secrets: &[String]) -> Option<String> {
    let bytes = response.bytes().await.ok()?;
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
    crate::platform::proxy::system(
        reqwest::Client::builder().user_agent(crate::agent::model_connections::USER_AGENT),
    )
    .redirect_policy(reqwest::redirect::Policy::none())
    .connect_timeout(std::time::Duration::from_secs(15))
    .timeout(std::time::Duration::from_secs(300))
    .build()
    .map_err(|_| "Cannot initialize model client".into())
}

async fn read<P: Events>(
    response: reqwest::Response,
    parser: P,
    delta: &mut dyn FnMut(&str, &str),
) -> Result<Completion, String> {
    let mut bytes = response.bytes_stream();
    let mut stream = Stream::new(parser);
    while let Some(chunk) = bytes.next().await {
        let chunk =
            chunk.map_err(|_| "Model stream was interrupted; the request was not replayed")?;
        if stream.feed(&chunk, delta)? {
            break;
        }
    }
    stream.finish()
}

/// PuppyOne compute (`openAgentStream`): the signed-in account's broker
/// sends the request once; its stream feeds the same parser. A lost
/// response is not replayed — it may already have been charged.
async fn complete_managed(
    account: &dyn crate::agent::model_connections::ComputeAccount,
    body: Value,
    delta: &mut dyn FnMut(&str, &str),
) -> Result<Completion, String> {
    let (broker, binding) = account.current().ok_or_else(|| {
        crate::localization::t("settings.account.signedOutDetailCompute").to_owned()
    })?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Result<Vec<u8>, String>>();
    let cancel = crate::cloud::auth::Cancellation::default();
    let guard = cancel.clone();
    std::thread::spawn(move || {
        let request_id = uuid::Uuid::new_v4().to_string();
        let sink_tx = tx.clone();
        let result = broker.completion(&binding, &body, &request_id, &cancel, &mut |event| {
            if let crate::cloud::auth::StreamEvent::Data(bytes) = event
                && sink_tx.send(Ok(bytes.to_vec())).is_err()
            {
                return Err(crate::cloud::auth::Error::Cancelled);
            }
            Ok(())
        });
        if let Err(error) = result {
            let _ = tx.send(Err(match error {
                crate::cloud::auth::Error::Http(402)
                | crate::cloud::auth::Error::Response(402, _, _) => {
                    crate::localization::t("agent.compute.paymentUnavailable").to_owned()
                }
                crate::cloud::auth::Error::Cancelled => "Turn stopped".to_owned(),
                _ => {
                    "PuppyOne compute did not complete the request; it was not replayed".to_owned()
                }
            }));
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
