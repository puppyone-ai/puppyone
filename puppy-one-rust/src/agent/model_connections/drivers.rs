//! Local model service discovery and provider catalog drivers
//! (`discovery-service.mjs` + `drivers/{ollama,lm-studio,openai-compatible}.mjs`).
//! Pure Rust, zero UI dependency: owned by `po-agent` so both the Agent host
//! and Settings read the exact same catalog evidence.
use super::configuration::{Driver, ModelConnection};
use serde_json::Value;

/// A reachable local model service (`discovery-service.mjs` candidates).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub driver: Driver,
    pub name: &'static str,
    pub endpoint: &'static str,
}

/// `drivers/{ollama,lm-studio}.mjs` candidates and their probes.
const CANDIDATES: [(Candidate, &str); 2] = [
    (
        Candidate {
            driver: Driver::Ollama,
            name: "Ollama",
            endpoint: "http://127.0.0.1:11434/v1",
        },
        "http://127.0.0.1:11434/api/version",
    ),
    (
        Candidate {
            driver: Driver::LmStudio,
            name: "LM Studio",
            endpoint: "http://127.0.0.1:1234/v1",
        },
        "http://127.0.0.1:1234/api/v1/models",
    ),
];

/// Probe the known local services; only loopback is ever contacted.
pub async fn discover_local() -> Vec<Candidate> {
    let Ok(client) = crate::platform::proxy::system(reqwest::Client::builder())
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
        let Ok(value) = response.json::<Value>().await else {
            continue;
        };
        let reachable = if candidate.driver == Driver::Ollama {
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
}

/// What a model service reports about one model (`modelEntry`).
#[derive(Clone, Debug, PartialEq, Eq)]
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
        }
    }
}

fn positive(value: &Value) -> Option<u64> {
    value.as_u64().filter(|v| *v > 0 && *v <= 10_000_000)
}

fn model_id(value: &Value) -> Option<String> {
    let id = value.as_str()?;
    (!id.trim().is_empty() && id.len() <= 300 && !id.chars().any(char::is_control))
        .then(|| id.to_owned())
}

/// The client catalogs are read with: no redirect, bounded in time.
pub fn metadata_client() -> Result<reqwest::Client, String> {
    crate::platform::proxy::system(reqwest::Client::builder())
        .redirect_policy(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// One metadata request (`createModelMetadataClient`): JSON, the key as a
/// bearer token, a missing endpoint told apart.
async fn get_json(
    client: &reqwest::Client,
    url: String,
    key: Option<&str>,
) -> Result<Value, String> {
    let mut request = client.get(url);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "ENDPOINT_UNAVAILABLE".to_owned())?;
    if response.status().as_u16() == 404 {
        return Err("ENDPOINT_NOT_FOUND".to_owned());
    }
    // A redirect is never followed with the key (`REDIRECT_REJECTED`).
    if response.status().is_redirection() {
        return Err("REDIRECT_REJECTED".to_owned());
    }
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        return Err("AUTHENTICATION_FAILED".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!("HTTP_{}", response.status().as_u16()));
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| "INVALID_RESPONSE".to_owned())?;
    // A catalog that echoes the key would show or keep it.
    if let Some(key) = key.filter(|k| !k.is_empty())
        && body.windows(key.len()).any(|w| w == key.as_bytes())
    {
        return Err("INVALID_RESPONSE".to_owned());
    }
    serde_json::from_slice(&body).map_err(|_| "INVALID_RESPONSE".to_owned())
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
/// Unsloth and OpenAI-compatible (`/models`); then `projectModelCatalog`.
/// At most 500 models.
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
    let models = match connection.driver {
        Driver::Ollama => {
            let tags = get_json(client, format!("{native}/api/tags"), key).await?;
            let running = get_json(client, format!("{native}/api/ps"), key).await.ok();
            let mut models = ollama_models(&tags, running.as_ref());
            for model in models.iter_mut().take(16) {
                let detail = client
                    .post(format!("{native}/api/show"))
                    .json(&serde_json::json!({"model": model.id}))
                    .send()
                    .await
                    .ok();
                if let Some(detail) = detail
                    && let Ok(value) = detail.json::<Value>().await
                {
                    ollama_detail(model, &value);
                }
            }
            models
        }
        Driver::LmStudio => match get_json(client, format!("{native}/api/v1/models"), key).await {
            Ok(value) => lm_studio_models(&value),
            Err(e) if e != "ENDPOINT_NOT_FOUND" => return Err(e),
            Err(_) => openai_catalog(client, connection, key).await?,
        },
        Driver::Unsloth | Driver::OpenaiCompatible => {
            openai_catalog(client, connection, key).await?
        }
    };
    Ok(project(connection, models))
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
pub fn ollama_detail(model: &mut CatalogModel, detail: &Value) {
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
pub fn ollama_models(tags: &Value, running: Option<&Value>) -> Vec<CatalogModel> {
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
pub fn lm_studio_models(value: &Value) -> Vec<CatalogModel> {
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
        });
    }
    models
}

/// An OpenAI-compatible `/models` list.
pub fn openai_models(value: &Value) -> Vec<CatalogModel> {
    value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .take(500)
        .filter_map(|entry| model_id(&entry["id"]))
        .map(CatalogModel::named)
        .collect()
}
