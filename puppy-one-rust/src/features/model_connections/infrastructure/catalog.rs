//! Model catalogs: what each service reports about the models it serves
//! (`drivers/*.list` and `projectModelCatalog`), read with the connection's
//! credential, never written anywhere.
use super::{Driver, ModelConnection};
use crate::agent::model_connections::providers;

/// What a model service reports about one model (`modelEntry`).
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    pub loaded: Option<bool>,
    /// `Some(true)` supported, `Some(false)` unsupported, `None` unknown.
    pub tools: Option<bool>,
    pub images: Option<bool>,
    pub context: Option<u64>,
    /// The largest window the model supports, when the service says.
    pub max_context: Option<u64>,
    /// Served by a remote host through a local service (Ollama cloud
    /// models): not offline, not free.
    pub remote: bool,
}
impl CatalogModel {
    /// A model known by its ID alone.
    pub fn named(id: String) -> Self {
        Self {
            name: id.clone(),
            id,
            loaded: None,
            tools: None,
            images: None,
            context: None,
            max_context: None,
            remote: false,
        }
    }
}
fn positive(value: &serde_json::Value) -> Option<u64> {
    value.as_u64().filter(|v| *v > 0 && *v <= 10_000_000)
}
fn model_id(value: &serde_json::Value) -> Option<String> {
    let id = value.as_str()?;
    (!id.trim().is_empty() && id.len() <= 300 && !id.chars().any(char::is_control))
        .then(|| id.to_owned())
}
/// How a catalog request authenticates.
#[derive(Clone, Copy)]
enum KeyHeader {
    Bearer,
    /// Anthropic: `x-api-key` and the API version.
    Anthropic,
}
/// One metadata request (`createModelMetadataClient`): JSON, the key as a
/// bearer token (or Anthropic's header), a missing endpoint told apart.
async fn get_json(
    client: &reqwest::Client,
    url: String,
    key: Option<&str>,
) -> Result<serde_json::Value, String> {
    get_json_as(client, url, key, KeyHeader::Bearer).await
}
async fn get_json_as(
    client: &reqwest::Client,
    url: String,
    key: Option<&str>,
    header: KeyHeader,
) -> Result<serde_json::Value, String> {
    let mut request = client.get(url);
    match (key, header) {
        (Some(key), KeyHeader::Bearer) => request = request.bearer_auth(key),
        (Some(key), KeyHeader::Anthropic) => {
            request = request
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01");
        }
        (None, _) => {}
    }
    let response = request
        .send()
        .await
        .map_err(|_| "ENDPOINT_UNAVAILABLE".to_owned())?;
    if response.status().as_u16() == 404 {
        return Err("ENDPOINT_NOT_FOUND".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!("HTTP_{}", response.status().as_u16()));
    }
    response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "INVALID_RESPONSE".to_owned())
}
/// `openaiCompatibleDriver.list`: `/models`; a service without one still
/// serves an explicitly configured model.
async fn openai_catalog(
    client: &reqwest::Client,
    connection: &ModelConnection,
    key: Option<&str>,
) -> Result<Vec<CatalogModel>, String> {
    let url = format!("{}/models", connection.endpoint.trim_end_matches('/'));
    match get_json(client, url, key).await {
        Ok(value) => Ok(openai_models(&value)),
        Err(e) if e == "ENDPOINT_NOT_FOUND" && connection.manual_model_id.is_some() => Ok(vec![]),
        Err(e) => Err(e),
    }
}
/// `drivers/*.list` by the connection's driver: Ollama (tags, ps, show for
/// the first 16), LM Studio (`/api/v1/models`, else the OpenAI catalog),
/// llama.cpp (`/models` with the server's `/props` window), Anthropic
/// (`/v1/models`), the other services (`/models`); a provider whose
/// catalog cannot be read with this credential serves its known models.
/// Then `projectModelCatalog`. At most 500 models.
pub async fn list_models(
    client: &reqwest::Client,
    connection: &ModelConnection,
    key: Option<&str>,
) -> Result<Vec<CatalogModel>, String> {
    let native = connection
        .endpoint
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_owned();
    let provider = connection.provider();
    let listed = match connection.driver {
        Driver::Ollama => {
            let tags = get_json(client, format!("{native}/api/tags"), key).await?;
            let running = get_json(client, format!("{native}/api/ps"), key).await.ok();
            let mut models = ollama_models(&tags, running.as_ref());
            for model in models.iter_mut().filter(|m| !m.remote).take(16) {
                let detail = client
                    .post(format!("{native}/api/show"))
                    .json(&serde_json::json!({"model": model.id}))
                    .send()
                    .await
                    .ok();
                if let Some(detail) = detail
                    && let Ok(value) = detail.json::<serde_json::Value>().await
                {
                    ollama_detail(model, &value);
                }
            }
            Ok(models)
        }
        Driver::LmStudio => match get_json(client, format!("{native}/api/v1/models"), key).await {
            Ok(value) => Ok(lm_studio_models(&value)),
            Err(e) if e != "ENDPOINT_NOT_FOUND" => Err(e),
            Err(_) => openai_catalog(client, connection, key).await,
        },
        Driver::LlamaCpp => {
            let mut models = openai_catalog(client, connection, key).await?;
            if let Ok(props) = get_json(client, format!("{native}/props"), key).await
                && let Some(window) = llama_cpp_window(&props)
            {
                for model in &mut models {
                    model.context = Some(window);
                }
            }
            Ok(models)
        }
        Driver::Anthropic => {
            let header = if connection.auth == super::Auth::Oauth {
                KeyHeader::Bearer
            } else {
                KeyHeader::Anthropic
            };
            get_json_as(
                client,
                format!(
                    "{}/v1/models?limit=100",
                    connection.endpoint.trim_end_matches('/')
                ),
                key,
                header,
            )
            .await
            .map(|value| openai_models(&value))
        }
        // The Codex backend has no public catalog: its known models serve.
        Driver::Chatgpt => Ok(vec![]),
        Driver::OpenaiCompatible if provider.is_some_and(|p| p.id == "openrouter") => {
            let url = format!("{}/models", connection.endpoint.trim_end_matches('/'));
            get_json(client, url, key)
                .await
                .map(|v| openrouter_models(&v))
        }
        Driver::Unsloth
        | Driver::Mlx
        | Driver::Omlx
        | Driver::Vllm
        | Driver::Jan
        | Driver::LocalAi
        | Driver::OpenaiCompatible
        | Driver::OpenaiResponses => openai_catalog(client, connection, key).await,
    };
    let known = provider.map(|p| p.known).unwrap_or_default();
    let models = match listed {
        Ok(models) if !models.is_empty() || known.is_empty() => models,
        Ok(_) => known_models(known),
        // A sign-in credential may not read the catalog (xAI, Kimi): the
        // provider's known models stand in. Any other failure is reported.
        Err(_) if !known.is_empty() && connection.auth == super::Auth::Oauth => known_models(known),
        Err(e) => return Err(e),
    };
    Ok(project(connection, models))
}
fn known_models(known: &[providers::KnownModel]) -> Vec<CatalogModel> {
    known
        .iter()
        .map(|k| CatalogModel {
            tools: Some(true),
            context: Some(k.context),
            ..CatalogModel::named(k.id.to_owned())
        })
        .collect()
}
/// llama.cpp `/props`: the server's context window (`n_ctx`).
pub fn llama_cpp_window(props: &serde_json::Value) -> Option<u64> {
    positive(&props["default_generation_settings"]["n_ctx"]).or_else(|| positive(&props["n_ctx"]))
}
/// OpenRouter `/models`: each model's window and whether it accepts tools.
pub fn openrouter_models(value: &serde_json::Value) -> Vec<CatalogModel> {
    value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .take(500)
        .filter_map(|entry| {
            let id = model_id(&entry["id"])?;
            let parameters = entry["supported_parameters"].as_array();
            Some(CatalogModel {
                name: entry["name"]
                    .as_str()
                    .map(|n| n.chars().take(300).collect())
                    .unwrap_or_else(|| id.clone()),
                tools: parameters.map(|p| p.iter().any(|v| v == "tools")),
                images: entry["architecture"]["input_modalities"]
                    .as_array()
                    .map(|m| m.iter().any(|v| v == "image")),
                context: positive(&entry["context_length"]),
                ..CatalogModel::named(id)
            })
        })
        .collect()
}
/// `projectModelCatalog`: the manual model joins a catalog that does not
/// list it, and the context budget stands in for a window the service did
/// not report, within the model's maximum.
pub fn project(connection: &ModelConnection, mut models: Vec<CatalogModel>) -> Vec<CatalogModel> {
    if let Some(id) = &connection.manual_model_id
        && !models.iter().any(|m| &m.id == id)
    {
        models.push(CatalogModel::named(id.clone()));
    }
    if let Some(budget) = connection.manual_context_window {
        for model in models.iter_mut().filter(|m| m.context.is_none()) {
            model.context = Some(budget.min(model.max_context.unwrap_or(budget)));
        }
    }
    models
}
/// Ollama `/api/show`: tool and image support from its capabilities, and
/// the model's maximum window from `model_info`.
fn ollama_detail(model: &mut CatalogModel, detail: &serde_json::Value) {
    if let Some(caps) = detail["capabilities"].as_array() {
        let has = |name: &str| caps.iter().any(|c| c == name);
        model.tools = Some(has("tools"));
        model.images = Some(has("vision"));
    }
    model.max_context = detail["model_info"].as_object().and_then(|info| {
        info.iter()
            .find(|(key, _)| key.ends_with(".context_length"))
            .and_then(|(_, value)| positive(value))
    });
}
/// Ollama `/api/tags`, with `/api/ps` (when it answered) for loaded state
/// and the loaded context length.
pub fn ollama_models(
    tags: &serde_json::Value,
    running: Option<&serde_json::Value>,
) -> Vec<CatalogModel> {
    let mut models = vec![];
    for entry in tags["models"].as_array().into_iter().flatten().take(500) {
        let Some(id) = model_id(&entry["name"]).or_else(|| model_id(&entry["model"])) else {
            continue;
        };
        let instance = running.and_then(|r| {
            r["models"]
                .as_array()?
                .iter()
                .find(|m| m["name"] == id.as_str() || m["model"] == id.as_str())
                .cloned()
        });
        let remote = entry["remote_host"].is_string() || entry["remote_model"].is_string();
        models.push(CatalogModel {
            remote,
            loaded: running.map(|_| instance.is_some()),
            context: instance
                .as_ref()
                .and_then(|i| positive(&i["context_length"])),
            ..CatalogModel::named(id)
        });
    }
    models
}
/// LM Studio `/api/v1/models`: language models only.
pub fn lm_studio_models(value: &serde_json::Value) -> Vec<CatalogModel> {
    let mut models = vec![];
    for entry in value["models"].as_array().into_iter().flatten().take(500) {
        if entry["type"] != "llm" {
            continue;
        }
        let Some(id) = model_id(&entry["key"]) else {
            continue;
        };
        let instances = entry["loaded_instances"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        models.push(CatalogModel {
            name: entry["display_name"]
                .as_str()
                .map(|n| n.chars().take(300).collect())
                .unwrap_or_else(|| id.clone()),
            id,
            loaded: Some(!instances.is_empty()),
            tools: entry["capabilities"]["trained_for_tool_use"].as_bool(),
            images: entry["capabilities"]["vision"].as_bool(),
            context: instances
                .iter()
                .filter_map(|i| positive(&i["config"]["context_length"]))
                .min(),
            max_context: positive(&entry["max_context_length"]),
            remote: false,
        });
    }
    models
}
/// An OpenAI-compatible `/models` list.
pub fn openai_models(value: &serde_json::Value) -> Vec<CatalogModel> {
    value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .take(500)
        .filter_map(|entry| model_id(&entry["id"]))
        .map(CatalogModel::named)
        .collect()
}
#[cfg(test)]
mod catalog_tests {
    use super::*;
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
            .block_on(async { list_models(&reqwest::Client::new(), connection, key).await })
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
