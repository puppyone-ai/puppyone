//! Binding a source to the Built-in Agent in one step: a discovered local
//! service, an API-key preset or a provider sign-in becomes a saved
//! connection with a default model and a context budget, without the form.
use super::catalog::{CatalogModel, list_models, project};
use super::discovery::Candidate;
use super::{Auth, Driver, ModelConnection, SourceKind};
use crate::agent::model_connections::configuration;
use crate::agent::model_connections::credentials::Credential;
use crate::agent::model_connections::oauth::{self, OauthProvider};
use crate::agent::model_connections::providers::{self, LOCAL_CONTEXT, Provider};

/// The model a new connection makes its default: the provider's
/// recommendation, else a loaded tool model, else any tool model, else the
/// first listed. Cloud models of a local service are never chosen for it.
pub fn choose_default(provider: Option<&Provider>, models: &[CatalogModel]) -> Option<String> {
    let usable: Vec<&CatalogModel> = models
        .iter()
        .filter(|m| !m.remote && m.tools != Some(false))
        .collect();
    let ids = usable.iter().map(|m| m.id.as_str());
    if let Some(found) = providers::pick_default(provider, ids.clone(), |_| false) {
        return Some(found);
    }
    usable
        .iter()
        .find(|m| m.loaded == Some(true) && m.tools == Some(true))
        .or_else(|| usable.iter().find(|m| m.tools == Some(true)))
        .or_else(|| usable.first())
        .map(|m| m.id.clone())
}

/// The context budget for `model`: what the service reports, else the
/// provider's default.
fn budget(provider: Option<&Provider>, models: &[CatalogModel], model: &str) -> u64 {
    models
        .iter()
        .find(|m| m.id == model)
        .and_then(|m| m.context.or(m.max_context))
        .unwrap_or(provider.map(|p| p.context).unwrap_or(LOCAL_CONTEXT))
        .clamp(1024, 10_000_000)
}

fn client() -> Result<reqwest::Client, String> {
    crate::platform::proxy::system(
        reqwest::Client::builder().user_agent(crate::agent::model_connections::USER_AGENT),
    )
    .redirect_policy(reqwest::redirect::Policy::none())
    .timeout(std::time::Duration::from_secs(15))
    .build()
    .map_err(|e| e.to_string())
}

/// Fill `connection`'s default model and budget from its catalog (read with
/// `key`, which is not stored yet). A connection whose catalog names no
/// usable model is still saved: the user picks one in its details.
pub async fn complete_binding(
    connection: &mut ModelConnection,
    key: Option<&str>,
) -> Result<(), String> {
    let provider = connection.provider();
    let models = match list_models(&client()?, connection, key).await {
        Ok(models) => models,
        // The service is up but lists nothing usable; a manual model serves.
        Err(e) if connection.manual_model_id.is_some() => {
            let _ = e;
            project(connection, vec![])
        }
        Err(e) => return Err(e),
    };
    if connection.default_model_id.is_none() {
        connection.default_model_id = choose_default(provider, &models);
    }
    if connection.manual_context_window.is_none()
        && let Some(model) = connection.default_model_id.as_deref()
    {
        connection.manual_context_window = Some(budget(provider, &models, model));
    }
    if connection.default_model_id.is_none() {
        return Err("NO_USABLE_MODEL".into());
    }
    Ok(())
}

/// The connection a discovered local service becomes.
pub fn local_connection(candidate: &Candidate) -> ModelConnection {
    let provider = providers::local_for(candidate.driver);
    ModelConnection {
        id: uuid::Uuid::new_v4().to_string(),
        name: candidate.name.clone(),
        endpoint: candidate.endpoint.clone(),
        source_kind: SourceKind::Local,
        driver: candidate.driver,
        auth: Auth::None,
        provider: provider
            .filter(|p| p.driver != Driver::OpenaiCompatible)
            .map(|p| p.id.to_owned()),
        ..Default::default()
    }
}

/// `Connect` on a discovered service: its key (read from the service's own
/// settings when it requires one), catalog, default model, save.
pub async fn quick_connect(candidate: Candidate, model: Option<String>) -> Result<(), String> {
    let mut connection = local_connection(&candidate);
    let driver = candidate.driver;
    let key = if candidate.needs_key {
        let key = tokio::task::spawn_blocking(move || super::discovery::local_key(driver))
            .await
            .map_err(|e| e.to_string())?
            .ok_or("LOCAL_KEY_REQUIRED")?;
        connection.auth = Auth::Bearer;
        Some(key)
    } else {
        None
    };
    connection.default_model_id = model;
    complete_binding(&mut connection, key.as_deref()).await?;
    configuration::save(connection, key)
}

/// Save an API-key connection, choosing its default model first when the
/// user left it unset.
pub async fn save_and_bind(
    mut connection: ModelConnection,
    key: Option<String>,
) -> Result<(), String> {
    if connection.default_model_id.is_none() {
        // The stored key serves an edit that did not replace it.
        let stored = match &key {
            Some(_) => None,
            None => connection.credential().ok().flatten(),
        };
        let probe = key.clone().or(stored);
        let mut probing = connection.clone();
        probing.endpoint =
            configuration::normalize_endpoint(&connection.endpoint, connection.driver)?;
        if complete_binding(&mut probing, probe.as_deref())
            .await
            .is_ok()
        {
            connection.default_model_id = probing.default_model_id;
            connection.manual_context_window = connection
                .manual_context_window
                .or(probing.manual_context_window);
        }
    }
    configuration::save(connection, key)
}

/// The connection a sign-in with `provider` becomes (the existing one when
/// the user signs in again, keeping its identity and default model).
pub fn signed_in_connection(
    provider: OauthProvider,
    existing: Option<&ModelConnection>,
) -> Result<ModelConnection, String> {
    let home = providers::for_oauth(provider).ok_or("OAUTH_UNAVAILABLE")?;
    let (_, driver, endpoint) = home.oauth.ok_or("OAUTH_UNAVAILABLE")?;
    Ok(match existing {
        Some(existing) => existing.clone(),
        None => ModelConnection {
            id: uuid::Uuid::new_v4().to_string(),
            name: home.name.to_owned(),
            endpoint: endpoint.to_owned(),
            source_kind: SourceKind::Api,
            driver,
            auth: Auth::Oauth,
            provider: Some(home.id.to_owned()),
            oauth_provider: Some(provider),
            ..Default::default()
        },
    })
}

/// Sign in with `provider` and save the connection. `progress` reaches the
/// UI; the browser opens on this side.
pub async fn sign_in(
    provider: OauthProvider,
    existing: Option<ModelConnection>,
    progress: impl Fn(oauth::Progress) + Send + Sync + 'static,
    cancel: oauth::Cancel,
) -> Result<(), String> {
    let progress = std::sync::Arc::new(progress);
    let report = progress.clone();
    let credential = oauth::login(
        provider,
        move |step| {
            match &step {
                oauth::Progress::OpenBrowser { url } => {
                    let _ = crate::platform::desktop::open_url(url);
                }
                oauth::Progress::DeviceCode {
                    verification_uri, ..
                } => {
                    let _ = crate::platform::desktop::open_url(verification_uri);
                }
                oauth::Progress::Exchanging => {}
            }
            report(step);
        },
        cancel,
    )
    .await?;
    // The provider answered: the user sees it at once, not after the save.
    progress(oauth::Progress::Exchanging);
    let mut connection = signed_in_connection(provider, existing.as_ref())?;
    // A sign-in that assigns its own endpoint (Qwen Code) is served there.
    if let Some(endpoint) = credential.endpoint() {
        connection.endpoint = endpoint.to_owned();
    }
    // Re-signing in with the same connection replaces its credential.
    let bearer = credential.bearer().to_owned();
    connection.account = credential.label().map(str::to_owned);
    // A provider's recommended model serves at once; reading its catalog
    // (which may take seconds) waits for the connection's details.
    if connection.default_model_id.is_none() {
        connection.default_model_id = connection
            .provider()
            .and_then(|p| p.recommended.first())
            .map(|m| (*m).to_owned());
    }
    if connection.default_model_id.is_none() {
        let _ = complete_binding(&mut connection, Some(&bearer)).await;
    }
    if connection.manual_context_window.is_none() {
        connection.manual_context_window = Some(
            connection
                .provider()
                .map(|p| p.context)
                .unwrap_or(LOCAL_CONTEXT),
        );
    }
    store(connection, credential).await
}

async fn store(connection: ModelConnection, credential: Credential) -> Result<(), String> {
    configuration::save_credential(connection, Some(credential))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str, tools: Option<bool>, loaded: Option<bool>) -> CatalogModel {
        CatalogModel {
            tools,
            loaded,
            context: Some(8192),
            ..CatalogModel::named(id.into())
        }
    }

    #[test]
    fn the_default_model_prefers_loaded_tool_models_and_skips_cloud_ones() {
        let cloud = CatalogModel {
            remote: true,
            ..model("gpt-oss:120b-cloud", Some(true), Some(true))
        };
        let models = vec![
            cloud,
            model("embed", Some(false), Some(true)),
            model("qwen3:8b", Some(true), Some(false)),
            model("llama3.2", Some(true), Some(true)),
        ];
        assert_eq!(choose_default(None, &models).as_deref(), Some("llama3.2"));
        let unloaded = vec![model("a", None, None), model("b", Some(true), Some(false))];
        assert_eq!(choose_default(None, &unloaded).as_deref(), Some("b"));
        // A provider's recommendation wins when listed.
        let openai = providers::get("openai");
        let listed = vec![model("gpt-4o", None, None), model("gpt-5.4", None, None)];
        assert_eq!(choose_default(openai, &listed).as_deref(), Some("gpt-5.4"));
        assert_eq!(choose_default(None, &[]), None);
    }

    #[test]
    fn a_discovered_service_binds_with_its_reported_window() {
        let candidate = Candidate {
            driver: Driver::Ollama,
            name: "Ollama".into(),
            endpoint: "http://127.0.0.1:11434/v1".into(),
            ..Default::default()
        };
        let connection = local_connection(&candidate);
        assert_eq!(
            (
                connection.provider.as_deref(),
                connection.auth,
                connection.source_kind
            ),
            (Some("ollama"), Auth::None, SourceKind::Local)
        );
        let models = vec![CatalogModel {
            context: None,
            max_context: Some(40960),
            ..model("qwen3", Some(true), None)
        }];
        assert_eq!(budget(connection.provider(), &models, "qwen3"), 40960);
        assert_eq!(budget(connection.provider(), &[], "other"), LOCAL_CONTEXT);
    }

    #[test]
    fn a_sign_in_makes_or_keeps_one_connection_per_provider() {
        let fresh = signed_in_connection(OauthProvider::Chatgpt, None).unwrap();
        assert_eq!(
            (
                fresh.driver,
                fresh.auth,
                fresh.oauth_provider,
                fresh.endpoint.as_str()
            ),
            (
                Driver::Chatgpt,
                Auth::Oauth,
                Some(OauthProvider::Chatgpt),
                "https://chatgpt.com/backend-api"
            )
        );
        assert!(fresh.validate().is_ok());
        let kept = ModelConnection {
            default_model_id: Some("gpt-5.4".into()),
            ..fresh.clone()
        };
        let again = signed_in_connection(OauthProvider::Chatgpt, Some(&kept)).unwrap();
        assert_eq!(
            (again.id, again.default_model_id),
            (fresh.id, Some("gpt-5.4".into()))
        );
        let kimi = signed_in_connection(OauthProvider::KimiCode, None).unwrap();
        assert_eq!(
            (kimi.driver, kimi.endpoint.as_str()),
            (Driver::OpenaiCompatible, "https://api.kimi.com/coding/v1")
        );
        let xai = signed_in_connection(OauthProvider::Xai, None).unwrap();
        assert_eq!(xai.driver, Driver::OpenaiResponses);
    }

    #[test]
    fn quick_connect_reads_the_catalog_before_saving() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(1) {
                let mut stream = stream.unwrap();
                let mut buffer = [0u8; 2048];
                let _ = stream.read(&mut buffer);
                let body = r#"{"data":[{"id":"local-model"}]}"#;
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        let mut connection = local_connection(&Candidate {
            driver: Driver::Vllm,
            name: "vLLM".into(),
            endpoint: format!("http://127.0.0.1:{port}/v1"),
            ..Default::default()
        });
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(complete_binding(&mut connection, None))
            .unwrap();
        assert_eq!(connection.default_model_id.as_deref(), Some("local-model"));
        assert_eq!(connection.manual_context_window, Some(LOCAL_CONTEXT));
        assert_eq!(connection.members().len(), 1);
    }
}
