//! Model catalogs as Settings reads them: the `po-agent` drivers
//! ([`crate::agent::model_connections::drivers`]) own the reads; their
//! acceptance tests stay here, where the product's contracts name them.
pub use crate::agent::model_connections::drivers::{CatalogModel, list_models};

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use crate::agent::model_connections::configuration::{Driver, ModelConnection};
    use crate::agent::model_connections::drivers::*;
    use serde_json::json;

    #[test]
    fn ollama_cloud_models_are_marked_remote_and_not_inspected() {
        let tags = json!({"models": [
            {"name": "qwen3:8b"},
            {"name": "gpt-oss:120b-cloud", "remote_model": "gpt-oss:120b", "remote_host": "https://ollama.com:443"}
        ]});
        let models = ollama_models(&tags, None);
        assert_eq!(
            models
                .iter()
                .map(|m| (m.id.as_str(), m.remote))
                .collect::<Vec<_>>(),
            [("qwen3:8b", false), ("gpt-oss:120b-cloud", true)]
        );
    }

    #[test]
    fn openrouter_reports_tool_support_and_windows() {
        let value = json!({"data": [
            {"id": "a/tools", "name": "A", "context_length": 200000, "supported_parameters": ["tools", "temperature"]},
            {"id": "b/plain", "context_length": 8192, "supported_parameters": ["temperature"]},
            {"id": "c/unknown"}
        ]});
        let models = openrouter_models(&value);
        assert_eq!(
            models
                .iter()
                .map(|m| (m.id.as_str(), m.tools, m.context))
                .collect::<Vec<_>>(),
            [
                ("a/tools", Some(true), Some(200000)),
                ("b/plain", Some(false), Some(8192)),
                ("c/unknown", None, None)
            ]
        );
    }

    #[test]
    fn llama_cpp_reports_its_window_in_props() {
        assert_eq!(
            llama_cpp_window(&json!({"default_generation_settings": {"n_ctx": 16384}})),
            Some(16384)
        );
        assert_eq!(llama_cpp_window(&json!({"n_ctx": 4096})), Some(4096));
        assert_eq!(llama_cpp_window(&json!({})), None);
    }

    #[test]
    fn a_signed_in_provider_without_a_catalog_serves_its_known_models() {
        let codex = ModelConnection {
            driver: Driver::Chatgpt,
            auth: crate::agent::model_connections::configuration::Auth::Oauth,
            oauth_provider: Some(crate::agent::model_connections::oauth::OauthProvider::Chatgpt),
            endpoint: "https://chatgpt.com/backend-api".into(),
            ..Default::default()
        };
        let models = list(&codex, Some("token")).unwrap();
        assert_eq!(models[0].id, "gpt-5.5");
        assert!(
            models
                .iter()
                .all(|m| m.tools == Some(true) && m.context.is_some())
        );
    }

    #[test]
    fn anthropic_catalogs_send_the_key_in_anthropic_headers() {
        let (port, server) = serve("200 OK", r#"{"data":[{"id":"claude-sonnet-4-5"}]}"#);
        let connection = ModelConnection {
            driver: Driver::Anthropic,
            auth: crate::agent::model_connections::configuration::Auth::Bearer,
            endpoint: format!("http://127.0.0.1:{port}"),
            ..Default::default()
        };
        let models = list(&connection, Some("sk-ant-test")).unwrap();
        let head = server.join().unwrap().to_ascii_lowercase();
        assert!(head.starts_with("get /v1/models?limit=100 "), "{head}");
        assert!(head.contains("x-api-key: sk-ant-test"));
        assert!(head.contains("anthropic-version: 2023-06-01"));
        assert!(!head.contains("authorization:"));
        assert_eq!(models[0].id, "claude-sonnet-4-5");
    }

    #[test]
    fn ollama_catalog_marks_loaded_models_and_their_context() {
        let tags = json!({"models": [
            {"name": "qwen3:8b"}, {"model": "llama3.2"}, {"name": ""}, {"name": "bad\u{7}id"}
        ]});
        let running = json!({"models": [{"name": "qwen3:8b", "context_length": 8192}]});
        let models = ollama_models(&tags, Some(&running));
        assert_eq!(
            models
                .iter()
                .map(|m| (m.id.as_str(), m.loaded, m.context))
                .collect::<Vec<_>>(),
            vec![
                ("qwen3:8b", Some(true), Some(8192)),
                ("llama3.2", Some(false), None)
            ]
        );
        // Without `/api/ps` the loaded state is unknown, not "not loaded".
        assert!(
            ollama_models(&tags, None)
                .iter()
                .all(|m| m.loaded.is_none())
        );
    }

    #[test]
    fn lm_studio_catalog_keeps_language_models_with_reported_capabilities() {
        let value = json!({"models": [
            {"type": "llm", "key": "qwen/qwen3-8b", "display_name": "Qwen3 8B",
             "capabilities": {"trained_for_tool_use": true, "vision": false},
             "loaded_instances": [{"config": {"context_length": 32768}}, {"config": {"context_length": 4096}}]},
            {"type": "embedding", "key": "nomic-embed"},
            {"type": "llm", "key": "gemma"}
        ]});
        let models = lm_studio_models(&value);
        assert_eq!(models.len(), 2);
        assert_eq!(
            (
                models[0].name.as_str(),
                models[0].tools,
                models[0].loaded,
                models[0].context
            ),
            ("Qwen3 8B", Some(true), Some(true), Some(4096))
        );
        assert_eq!(
            (models[1].name.as_str(), models[1].tools, models[1].loaded),
            ("gemma", None, Some(false))
        );
    }

    #[test]
    fn catalogs_keep_text_chat_models_by_what_the_service_reports() {
        // OpenAI-style lists carry no kind: the name decides.
        let value = json!({"data": [
            {"id": "gpt-5", "object": "model"},
            {"id": "text-embedding-3-small", "object": "model"},
            {"id": "whisper-1", "object": "model"},
            {"id": "gpt-4o-mini-tts", "object": "model"},
            {"id": "gpt-4o-transcribe", "object": "model"},
            {"id": "gpt-image-1", "object": "model"},
            {"id": "dall-e-3", "object": "model"},
            {"id": "omni-moderation-latest", "object": "model"},
            {"id": "sora-2", "object": "model"},
            // A reported kind wins over the name.
            {"id": "my-embedder", "model_type": "LLM"},
            {"id": "plain-name", "type": "embedding"},
            {"id": "x/rank", "task": "text-generation"},
            {"id": "y/caps", "capabilities": ["embedding"]}
        ]});
        let ids: Vec<_> = openai_models(&value).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["gpt-5", "my-embedder", "x/rank"]);
        // OpenRouter reports output modalities.
        let value = json!({"data": [
            {"id": "a/chat", "architecture": {"output_modalities": ["text"]}},
            {"id": "b/painter", "architecture": {"output_modalities": ["image", "text"]}},
            {"id": "c/modality", "architecture": {"modality": "text+image->text"}},
            {"id": "d/embedding-only", "architecture": {"modality": "text->embeddings"}}
        ]});
        let ids: Vec<_> = openrouter_models(&value)
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, ["a/chat", "c/modality"]);
        // LM Studio: `llm` and `vlm` only.
        let value = json!({"models": [
            {"type": "llm", "key": "qwen/qwen3-coder"},
            {"type": "vlm", "key": "google/gemma-3-12b"},
            {"type": "embeddings", "key": "text-embedding-nomic"},
            {"type": "tts", "key": "kokoro"}
        ]});
        let ids: Vec<_> = lm_studio_models(&value).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["qwen/qwen3-coder", "google/gemma-3-12b"]);
    }

    #[test]
    fn ollama_catalog_keeps_models_whose_capabilities_name_completion() {
        let tags = json!({"models": [
            {"name": "qwen3:8b"},
            {"name": "embeddinggemma:latest"},
            {"name": "nomic-embed-text:latest"},
            {"name": "odd-name:latest", "details": {"family": "nomic-bert"}},
            {"name": "gpt-oss:120b-cloud", "remote_host": "https://ollama.com:443"}
        ]});
        let models = ollama_models(&tags, None);
        let shown_ids: Vec<String> = [
            "qwen3:8b",
            "embeddinggemma:latest",
            "nomic-embed-text:latest",
            "odd-name:latest",
        ]
        .map(str::to_owned)
        .to_vec();
        let shown = vec![
            Some(json!({"capabilities": ["completion", "tools"]})),
            Some(json!({"capabilities": ["embedding"]})),
            // `/api/show` failed: the name decides, and the BERT family.
            None,
            None,
        ];
        let kept = ollama_chat_models(&tags, models, &shown_ids, &shown);
        assert_eq!(
            kept.iter()
                .map(|m| (m.id.as_str(), m.tools))
                .collect::<Vec<_>>(),
            [("qwen3:8b", Some(true)), ("gpt-oss:120b-cloud", None)]
        );
    }

    #[test]
    fn openai_catalog_lists_valid_ids_only() {
        let value = json!({"data": [{"id": "gpt-4.1"}, {"id": "  "}, {"id": 7}, {"id": "o3"}]});
        let ids: Vec<_> = openai_models(&value).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["gpt-4.1", "o3"]);
    }

    /// One HTTP exchange on a loopback port: the request head, answered
    /// with `status` and `body`.
    fn serve(status: &'static str, body: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let n = stream.read(&mut request).unwrap();
            let head = String::from_utf8_lossy(&request[..n]).to_string();
            write!(
                stream,
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            head
        });
        (port, server)
    }
    fn list(connection: &ModelConnection, key: Option<&str>) -> Result<Vec<CatalogModel>, String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async { list_models(&metadata_client()?, connection, key).await })
    }

    /// A sign-in whose catalog is refused shows the provider's known models
    /// in Settings, but only a catalog the service listed may replace what
    /// Chat offers.
    #[test]
    fn known_models_stand_in_for_display_but_never_for_what_chat_offers() {
        let (port, server) = serve("401 Unauthorized", "{}");
        let connection = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            provider: Some("xai".into()),
            auth: super::super::Auth::Oauth,
            ..Default::default()
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let client = metadata_client().unwrap();
        let listed = runtime.block_on(listed_models(&client, &connection, Some("token")));
        assert!(listed.is_err());
        server.join().unwrap();
        let (port, server) = serve("401 Unauthorized", "{}");
        let connection = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..connection
        };
        let shown = runtime
            .block_on(list_models(&client, &connection, Some("token")))
            .unwrap();
        assert_eq!(
            shown.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            ["grok-4", "grok-code-fast-1"]
        );
        server.join().unwrap();
    }

    /// `rejects metadata that echoes a credential`, `does not follow a
    /// metadata redirect with credentials`.
    #[test]
    fn a_catalog_echoing_the_key_or_redirecting_is_refused() {
        let connection = |port: u16| ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..Default::default()
        };
        let (port, server) = serve("200 OK", r#"{"data":[{"id":"synthetic-private-key"}]}"#);
        assert_eq!(
            list(&connection(port), Some("synthetic-private-key")),
            Err("INVALID_RESPONSE".into())
        );
        server.join().unwrap();
        // The redirect's target is never contacted.
        let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let elsewhere = target.local_addr().unwrap().port();
        let origin = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = origin.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = origin.accept().unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request).unwrap();
            write!(
                stream,
                "HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:{elsewhere}/v1/models\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
            )
            .unwrap();
        });
        assert_eq!(
            list(&connection(port), Some("synthetic-private-key")),
            Err("REDIRECT_REJECTED".into())
        );
        server.join().unwrap();
        assert_eq!(
            target.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn generic_services_are_read_over_http() {
        let (port, server) = serve("200 OK", r#"{"data":[{"id":"local-model"}]}"#);
        let connection = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..Default::default()
        };
        let models = list(&connection, Some("sk-test")).unwrap();
        let head = server.join().unwrap();
        assert!(head.starts_with("GET /v1/models "), "{head}");
        assert!(
            head.to_ascii_lowercase()
                .contains("authorization: bearer sk-test")
        );
        assert_eq!(
            models.into_iter().map(|m| m.id).collect::<Vec<_>>(),
            ["local-model"]
        );
    }

    /// `providerDrivers.test.mjs`: "supports an explicit model ID when
    /// /models is absent, without inventing capabilities".
    #[test]
    fn a_manual_model_is_served_when_the_service_lists_none() {
        let (port, server) = serve("404 Not Found", "{}");
        let connection = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/proxy/v1"),
            manual_model_id: Some("manual".into()),
            manual_context_window: Some(4096),
            ..Default::default()
        };
        let models = list(&connection, None).unwrap();
        server.join().unwrap();
        assert_eq!(
            models,
            [CatalogModel {
                context: Some(4096),
                ..CatalogModel::named("manual".into())
            }]
        );
        // Without a manual model a missing catalog is an error.
        let (port, server) = serve("404 Not Found", "{}");
        let bare = ModelConnection {
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..Default::default()
        };
        assert_eq!(list(&bare, None).unwrap_err(), "ENDPOINT_NOT_FOUND");
        server.join().unwrap();
    }

    #[test]
    fn the_context_budget_fills_unreported_windows_within_the_maximum() {
        let connection = ModelConnection {
            manual_context_window: Some(32768),
            ..Default::default()
        };
        let models = project(
            &connection,
            vec![
                CatalogModel {
                    context: Some(8192),
                    ..CatalogModel::named("loaded".into())
                },
                CatalogModel {
                    max_context: Some(4096),
                    ..CatalogModel::named("small".into())
                },
                CatalogModel::named("open".into()),
            ],
        );
        assert_eq!(
            models.iter().map(|m| m.context).collect::<Vec<_>>(),
            [Some(8192), Some(4096), Some(32768)]
        );
        let mut detail = CatalogModel::named("qwen3".into());
        ollama_detail(
            &mut detail,
            &json!({"capabilities": ["completion", "tools"], "model_info": {"qwen3.context_length": 40960}}),
        );
        assert_eq!(
            (detail.tools, detail.images, detail.max_context),
            (Some(true), Some(false), Some(40960))
        );
    }
}
