pub mod model_connection_binding;
pub mod model_connection_verifier;
pub mod native_kernel;
pub mod native_model_connections;
pub mod puppyone_agent_adapter;
pub mod puppyone_agent_approval;
pub mod puppyone_agent_discovery;
pub mod puppyone_agent_environment;
pub mod puppyone_agent_history_source;
pub mod puppyone_agent_identity;
pub mod puppyone_agent_kernel;
pub mod puppyone_agent_public_identity;
pub mod puppyone_agent_runtime_definition;
#[cfg(test)]
mod tests;
pub use crate::agent::model_connections::configuration;
mod model_client;
mod tools;

/// `verifyConnectionModel`: a two-step tool round trip — the model must call
/// `puppyone_connection_check` with the exact token, then answer the tool's
/// result with text. It may incur charges; nothing else is touched.
pub async fn verify(
    connection: &configuration::ModelConnection,
    account: &dyn crate::agent::model_connections::ComputeAccount,
) -> Result<(), String> {
    use serde_json::json;
    const TOKEN: &str = "puppyone-model-check";
    let tool = json!([{"type": "function", "function": {
        "name": "puppyone_connection_check",
        "description": "Return the supplied check token; no files or commands are used.",
        "parameters": {"type": "object", "properties": {"token": {"type": "string"}},
                       "required": ["token"], "additionalProperties": false}}}]);
    let mut context = vec![
        json!({"role": "system", "content": "This is a connection compatibility test. Call puppyone_connection_check with the exact token supplied by the user. Do not use any other tool."}),
        json!({"role": "user", "content": TOKEN}),
    ];
    let first =
        model_client::complete(connection, account, &context, tool.clone(), |_, _| {}).await?;
    let call = first
        .calls
        .iter()
        .find(|c| {
            c["function"]["name"] == "puppyone_connection_check"
                && serde_json::from_str::<serde_json::Value>(
                    c["function"]["arguments"].as_str().unwrap_or("{}"),
                )
                .is_ok_and(|a| a["token"] == TOKEN)
        })
        .cloned()
        .ok_or("VERIFICATION_FAILED")?;
    context[0] = json!({"role": "system", "content": "The connection check has completed. Reply with a short confirmation; do not call further tools."});
    context.push(first.message());
    context.push(
        json!({"role": "tool", "tool_call_id": call["id"], "content": "Connection check passed."}),
    );
    let second = model_client::complete(connection, account, &context, tool, |_, _| {}).await?;
    if second.text.trim().is_empty() {
        return Err("VERIFICATION_FAILED".into());
    }
    Ok(())
}

#[cfg(test)]
mod verify_tests {
    use super::*;
    use std::io::{Read, Write};

    /// Serve one streamed chat reply per request, returning the request bodies.
    fn serve(replies: Vec<&'static str>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let (base, server) = serve_raw(replies.into_iter().map(|r| (200, r)).collect());
        let server = std::thread::spawn(move || {
            server
                .join()
                .unwrap()
                .into_iter()
                .map(|r| r.split_once("\r\n\r\n").unwrap().1.to_owned())
                .collect()
        });
        (format!("{base}/v1"), server)
    }

    /// Serve one `(status, body)` reply per request, returning each whole
    /// request (head and body).
    fn serve_raw(
        replies: Vec<(u16, &'static str)>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let server = std::thread::spawn(move || {
            let mut requests = vec![];
            for (status, reply) in replies {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = vec![];
                let mut buffer = [0u8; 4096];
                loop {
                    let n = stream.read(&mut buffer).unwrap();
                    request.extend_from_slice(&buffer[..n]);
                    let text = String::from_utf8_lossy(&request).to_string();
                    if let Some(split) = text.find("\r\n\r\n") {
                        let length = text[..split]
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if request.len() >= split + 4 + length {
                            requests.push(text);
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                write!(
                    stream,
                    "HTTP/1.1 {status} X\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                    reply.len()
                )
                .unwrap();
            }
            requests
        });
        (base, server)
    }

    fn connection(endpoint: String) -> configuration::ModelConnection {
        configuration::ModelConnection {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Local".into(),
            endpoint,
            model: "qwen3".into(),
            ..Default::default()
        }
    }

    fn run(connection: &configuration::ModelConnection) -> Result<(), String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(verify(
                connection,
                &crate::agent::model_connections::NoComputeAccount,
            ))
    }

    #[test]
    fn a_model_passes_after_calling_the_check_tool_and_replying() {
        let (endpoint, server) = serve(vec![
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"puppyone_connection_check\",\"arguments\":\"{\\\"token\\\":\\\"puppyone-model-check\\\"}\"}}]}}]}\ndata: [DONE]\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Done.\"}}]}\ndata: [DONE]\n",
        ]);
        run(&connection(endpoint)).unwrap();
        let bodies = server.join().unwrap();
        assert!(bodies[0].contains("puppyone_connection_check"));
        let second: serde_json::Value = serde_json::from_str(&bodies[1]).unwrap();
        let messages = second["messages"].as_array().unwrap();
        assert_eq!(messages.last().unwrap()["role"], "tool");
        assert_eq!(messages.last().unwrap()["tool_call_id"], "c1");
    }

    #[test]
    fn a_model_that_answers_without_the_tool_fails_verification() {
        let (endpoint, server) = serve(vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"puppyone-model-check\"}}]}\ndata: [DONE]\n",
        ]);
        assert_eq!(
            run(&connection(endpoint)).unwrap_err(),
            "VERIFICATION_FAILED"
        );
        assert_eq!(server.join().unwrap().len(), 1);
    }

    use crate::agent::model_connections::{
        credentials::{self, Credential},
        oauth::OauthProvider,
    };

    const SECRET: &str = "sk-very-secret-test-key";
    const ACCESS: &str = "very-secret-access-token";
    const ACCOUNT: &str = "acct-private-123";

    /// A connection whose credential sits in the in-memory store.
    fn signed(
        endpoint: String,
        driver: configuration::Driver,
        credential: Credential,
    ) -> configuration::ModelConnection {
        let id = uuid::Uuid::new_v4().to_string();
        credentials::write(&id, &credential).unwrap();
        let oauth = matches!(credential, Credential::Oauth { .. });
        configuration::ModelConnection {
            driver,
            auth: if oauth {
                configuration::Auth::Oauth
            } else {
                configuration::Auth::Bearer
            },
            oauth_provider: oauth.then_some(OauthProvider::Chatgpt),
            credential_id: Some(id),
            ..connection(endpoint)
        }
    }

    fn api_key() -> Credential {
        Credential::ApiKey { key: SECRET.into() }
    }

    fn chatgpt() -> Credential {
        Credential::Oauth {
            access: ACCESS.into(),
            refresh: String::new(),
            expires: 0,
            account_id: Some(ACCOUNT.into()),
            label: None,
            endpoint: None,
        }
    }

    fn header<'a>(request: &'a str, name: &str) -> Option<&'a str> {
        request.split("\r\n\r\n").next()?.lines().find_map(|l| {
            let (key, value) = l.split_once(':')?;
            key.eq_ignore_ascii_case(name).then(|| value.trim())
        })
    }

    fn body(request: &str) -> serde_json::Value {
        serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap()
    }

    #[test]
    fn an_anthropic_connection_verifies_over_the_messages_api() {
        let _guard = credentials::TEST_STORE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        credentials::use_memory_store();
        let (base, server) = serve_raw(vec![
            (
                200,
                concat!(
                    "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n",
                    "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"puppyone_connection_check\",\"input\":{}}}\n\n",
                    "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"token\\\":\\\"puppyone-model-check\\\"}\"}}\n\n",
                    "data: {\"type\":\"message_stop\"}\n\n"
                ),
            ),
            (
                200,
                concat!(
                    "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
                    "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Done.\"}}\n\n",
                    "data: {\"type\":\"message_stop\"}\n\n"
                ),
            ),
        ]);
        let connection = signed(base, configuration::Driver::Anthropic, api_key());
        run(&connection).unwrap();
        let requests = server.join().unwrap();
        for request in &requests {
            assert!(request.starts_with("POST /v1/messages "), "{request}");
            assert_eq!(header(request, "x-api-key"), Some(SECRET));
            assert_eq!(header(request, "anthropic-version"), Some("2023-06-01"));
            assert_eq!(header(request, "authorization"), None);
        }
        let second = body(&requests[1]);
        assert_eq!(second["stream"], true);
        assert_eq!(second["tools"][0]["name"], "puppyone_connection_check");
        let messages = second["messages"].as_array().unwrap();
        assert_eq!(messages[1]["content"][0]["type"], "tool_use");
        assert_eq!(messages[1]["content"][0]["id"], "toolu_1");
        assert_eq!(messages[2]["content"][0]["type"], "tool_result");
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "toolu_1");
    }

    #[test]
    fn a_chatgpt_connection_verifies_over_the_codex_backend() {
        let _guard = credentials::TEST_STORE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        credentials::use_memory_store();
        let (base, server) = serve_raw(vec![
            (
                200,
                concat!(
                    "data: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"puppyone_connection_check\",\"arguments\":\"\"}}\n\n",
                    "data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"output_index\":0,\"delta\":\"{\\\"token\\\":\\\"puppyone-model-check\\\"}\"}\n\n",
                    "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}}\n\n"
                ),
            ),
            (
                200,
                concat!(
                    "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Done.\"}\n\n",
                    "data: {\"type\":\"response.completed\",\"response\":{}}\n\n"
                ),
            ),
        ]);
        let connection = signed(base, configuration::Driver::Chatgpt, chatgpt());
        run(&connection).unwrap();
        let requests = server.join().unwrap();
        for request in &requests {
            assert!(request.starts_with("POST /codex/responses "), "{request}");
            assert_eq!(
                header(request, "authorization"),
                Some(format!("Bearer {ACCESS}").as_str())
            );
            assert_eq!(header(request, "chatgpt-account-id"), Some(ACCOUNT));
            assert_eq!(header(request, "originator"), Some("puppyone"));
            assert_eq!(
                header(request, "openai-beta"),
                Some("responses=experimental")
            );
            let body = body(request);
            assert_eq!(body["store"], false);
            assert_eq!(body["stream"], true);
        }
        let second = body(&requests[1]);
        let input = second["input"].as_array().unwrap();
        assert_eq!(input[1]["type"], "function_call");
        assert_eq!(input[1]["call_id"], "call_1");
        assert_eq!(input[2]["type"], "function_call_output");
        assert_eq!(input[2]["call_id"], "call_1");
        // The check swaps its instructions, so each step names its own prefix.
        assert_eq!(second["prompt_cache_key"].as_str().unwrap().len(), 32);
    }

    #[test]
    fn refused_requests_never_reveal_their_credentials_or_body() {
        let _guard = credentials::TEST_STORE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        credentials::use_memory_store();
        const LEAKY: &str = "{\"error\":\"bad key sk-very-secret-test-key for acct-private-123\"}";
        let cases = [
            (configuration::Driver::Anthropic, api_key(), 401, "HTTP 401"),
            (configuration::Driver::Anthropic, api_key(), 500, "HTTP 500"),
            (
                configuration::Driver::OpenaiCompatible,
                api_key(),
                401,
                "HTTP 401",
            ),
            (
                configuration::Driver::Chatgpt,
                chatgpt(),
                401,
                "OAUTH_REAUTH_REQUIRED",
            ),
            // A refusal that is not about the token says what the provider
            // said, with the request's credential masked out.
            (
                configuration::Driver::Chatgpt,
                chatgpt(),
                403,
                "HTTP 403: bad key",
            ),
            (configuration::Driver::Chatgpt, chatgpt(), 500, "HTTP 500"),
            (
                configuration::Driver::Chatgpt,
                chatgpt(),
                429,
                "usage limit is reached",
            ),
        ];
        for (driver, credential, status, expected) in cases {
            let (base, server) = serve_raw(vec![(status, LEAKY)]);
            let error = run(&signed(base, driver, credential)).unwrap_err();
            server.join().unwrap();
            assert!(error.contains(expected), "{driver:?} {status}: {error}");
            for secret in [SECRET, ACCESS, ACCOUNT] {
                assert!(!error.contains(secret), "{error}");
            }
        }
        // A ChatGPT sign-in without its account is refused before sending.
        let connection = signed(
            "http://127.0.0.1:9".into(),
            configuration::Driver::Chatgpt,
            Credential::Oauth {
                access: ACCESS.into(),
                refresh: String::new(),
                expires: 0,
                account_id: None,
                label: None,
                endpoint: None,
            },
        );
        assert_eq!(run(&connection).unwrap_err(), "CREDENTIAL_REQUIRED");
    }
}
