use crate::{model_connections::configuration, wake::Wake};
pub use configuration::ModelConnection;
use std::sync::mpsc::{self, Receiver};
pub fn load(wake: Wake) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let _ = tx.send(configuration::load());
        wake.notify();
    });
    rx
}
pub fn save(
    connection: ModelConnection,
    secret: Option<String>,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let result = configuration::save(connection, secret).and_then(|()| configuration::load());
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

pub fn remove(
    id: String,
    generation: String,
    wake: Wake,
) -> Receiver<Result<Vec<ModelConnection>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let result = configuration::remove(&id, &generation).and_then(|()| configuration::load());
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

/// A reachable local model service (`discovery-service.mjs` candidates).
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub name: &'static str,
    pub endpoint: &'static str,
}
/// `drivers/{ollama,lm-studio}.mjs` candidates and their probes.
const CANDIDATES: [(Candidate, &str); 2] = [
    (
        Candidate {
            name: "Ollama",
            endpoint: "http://127.0.0.1:11434/v1",
        },
        "http://127.0.0.1:11434/api/version",
    ),
    (
        Candidate {
            name: "LM Studio",
            endpoint: "http://127.0.0.1:1234/v1",
        },
        "http://127.0.0.1:1234/api/v1/models",
    ),
];
/// Probe the known local services; only loopback is ever contacted.
pub fn discover(wake: Wake) -> Receiver<Vec<Candidate>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let found = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map(|runtime| {
                runtime.block_on(async {
                    let Ok(client) = reqwest::Client::builder()
                        .redirect_policy(reqwest::redirect::Policy::none())
                        .timeout(std::time::Duration::from_millis(1500))
                        .build()
                    else {
                        return vec![];
                    };
                    let mut found = vec![];
                    for (candidate, probe) in CANDIDATES {
                        let Ok(response) = client.get(probe).send().await else {
                            continue;
                        };
                        let Ok(value) = response.json::<serde_json::Value>().await else {
                            continue;
                        };
                        let reachable = if candidate.name == "Ollama" {
                            value["version"].is_string()
                        } else {
                            value["models"].as_array().is_some_and(|models| {
                                models
                                    .iter()
                                    .all(|m| m["key"].is_string() && m["type"].is_string())
                            })
                        };
                        if reachable {
                            found.push(candidate);
                        }
                    }
                    found
                })
            })
            .unwrap_or_default();
        let _ = tx.send(found);
        wake.notify();
    });
    rx
}

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
}
fn positive(value: &serde_json::Value) -> Option<u64> {
    value.as_u64().filter(|v| *v > 0 && *v <= 10_000_000)
}
fn model_id(value: &serde_json::Value) -> Option<String> {
    let id = value.as_str()?;
    (!id.trim().is_empty() && id.len() <= 300 && !id.chars().any(char::is_control))
        .then(|| id.to_owned())
}
/// `drivers/*.list`: Ollama (tags, ps, show for the first 16), LM Studio
/// (`/api/v1/models`, else the OpenAI catalog) or any OpenAI-compatible
/// `/models`. At most 500 models.
pub async fn list_models(
    client: &reqwest::Client,
    endpoint: &str,
    key: Option<&str>,
) -> Result<Vec<CatalogModel>, String> {
    let native = endpoint
        .trim_end_matches('/')
        .trim_end_matches("/v1")
        .to_owned();
    let get = |url: String| {
        let mut request = client.get(url);
        if let Some(key) = key {
            request = request.bearer_auth(key);
        }
        async move {
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
    };
    let mut models = vec![];
    if endpoint.contains(":11434") {
        let tags = get(format!("{native}/api/tags")).await?;
        let running = get(format!("{native}/api/ps")).await.ok();
        models = ollama_models(&tags, running.as_ref());
        for model in models.iter_mut().take(16) {
            let detail = client
                .post(format!("{native}/api/show"))
                .json(&serde_json::json!({"model": model.id}))
                .send()
                .await
                .ok();
            if let Some(detail) = detail
                && let Ok(value) = detail.json::<serde_json::Value>().await
                && let Some(caps) = value["capabilities"].as_array()
            {
                let has = |name: &str| caps.iter().any(|c| c == name);
                model.tools = Some(has("tools"));
                model.images = Some(has("vision"));
            }
        }
        return Ok(models);
    }
    if endpoint.contains(":1234") {
        match get(format!("{native}/api/v1/models")).await {
            Ok(value) => return Ok(lm_studio_models(&value)),
            Err(e) if e != "ENDPOINT_NOT_FOUND" => return Err(e),
            Err(_) => {}
        }
    }
    let value = get(format!("{}/models", endpoint.trim_end_matches('/'))).await?;
    Ok(openai_models(&value))
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
        models.push(CatalogModel {
            name: id.clone(),
            loaded: running.map(|_| instance.is_some()),
            context: instance
                .as_ref()
                .and_then(|i| positive(&i["context_length"])),
            id,
            tools: None,
            images: None,
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
        .map(|id| CatalogModel {
            name: id.clone(),
            id,
            loaded: None,
            tools: None,
            images: None,
            context: None,
        })
        .collect()
}
/// The catalog of `connection`, read on a worker.
pub fn catalog(
    connection: ModelConnection,
    wake: Wake,
) -> Receiver<Result<Vec<CatalogModel>, String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
            .and_then(|runtime| {
                runtime.block_on(async {
                    let client = reqwest::Client::builder()
                        .redirect_policy(reqwest::redirect::Policy::none())
                        .timeout(std::time::Duration::from_secs(15))
                        .build()
                        .map_err(|e| e.to_string())?;
                    let key = connection.credential().ok().flatten();
                    list_models(&client, &connection.endpoint, key.as_deref()).await
                })
            });
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}
/// `verify`: the Agent tool round trip for the connection's model.
pub fn verify(connection: ModelConnection, wake: Wake) -> Receiver<Result<(), String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
            .and_then(|runtime| {
                runtime.block_on(async {
                    tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        crate::agent::runtimes::puppyone_agent::verify(&connection),
                    )
                    .await
                    .map_err(|_| "TIMEOUT".to_owned())?
                })
            });
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use serde_json::json;

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

    #[test]
    fn generic_services_are_read_over_http() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 2048];
            let n = stream.read(&mut request).unwrap();
            let head = String::from_utf8_lossy(&request[..n]).to_string();
            let body = r#"{"data":[{"id":"local-model"}]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            head
        });
        let models = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let client = reqwest::Client::new();
                list_models(
                    &client,
                    &format!("http://127.0.0.1:{port}/v1"),
                    Some("sk-test"),
                )
                .await
            })
            .unwrap();
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
}
