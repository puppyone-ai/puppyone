pub mod adapter;
pub use crate::model_connections::configuration;
mod model_client;
mod session_store;
mod tools;

/// `verifyConnectionModel`: a two-step tool round trip — the model must call
/// `puppyone_connection_check` with the exact token, then answer the tool's
/// result with text. It may incur charges; nothing else is touched.
pub async fn verify(connection: &configuration::ModelConnection) -> Result<(), String> {
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
    let first = model_client::complete(connection, &context, tool.clone(), |_, _| {}).await?;
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
    let second = model_client::complete(connection, &context, tool, |_, _| {}).await?;
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
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!(
            "http://127.0.0.1:{}/v1",
            listener.local_addr().unwrap().port()
        );
        let server = std::thread::spawn(move || {
            let mut bodies = vec![];
            for reply in replies {
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
                            bodies.push(text[split + 4..].to_owned());
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                    reply.len()
                )
                .unwrap();
            }
            bodies
        });
        (endpoint, server)
    }

    fn connection(endpoint: String) -> configuration::ModelConnection {
        configuration::ModelConnection {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Local".into(),
            endpoint,
            model: "qwen3".into(),
            images: false,
            authenticated: false,
            credential_id: None,
            generation: String::new(),
            managed: false,
        }
    }

    fn run(connection: &configuration::ModelConnection) -> Result<(), String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(verify(connection))
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
}
