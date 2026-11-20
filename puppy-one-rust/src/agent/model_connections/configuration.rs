//! Native model connections (`connection-service.mjs` over
//! `shared/model-connections/schema.mjs`). A saved connection is a service —
//! its driver, base URL, authentication and optional model and context
//! overrides; the Agent serves the models it names ([`ModelConnection::members`]).
//! Credentials live in the OS keychain, never JSON or command arguments.
use super::credentials::Credential;
use super::schema;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};
/// `MODEL_CONNECTION_DRIVERS`: the service a connection calls. Each local
/// service has its own driver (its catalog and discovery differ); remote
/// providers are told apart by the protocol they speak.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Driver {
    Ollama,
    LmStudio,
    Unsloth,
    Mlx,
    LlamaCpp,
    Vllm,
    Jan,
    LocalAi,
    #[default]
    OpenaiCompatible,
    /// Anthropic Messages (Anthropic, Kimi Code).
    Anthropic,
    /// OpenAI Responses (xAI sign-in).
    OpenaiResponses,
    /// ChatGPT's Codex backend (ChatGPT sign-in).
    Chatgpt,
}
impl Driver {
    /// Every local service, in the local form's order (the form offers all
    /// but `OpenaiCompatible`, which `Bring your API` adds).
    pub const ALL: [Driver; 9] = [
        Driver::Ollama,
        Driver::LmStudio,
        Driver::Mlx,
        Driver::LlamaCpp,
        Driver::Vllm,
        Driver::Jan,
        Driver::LocalAi,
        Driver::Unsloth,
        Driver::OpenaiCompatible,
    ];
    /// `DRIVERS` in `ModelConnectionSetup.tsx`: the service's name and its
    /// default base URL.
    pub fn defaults(self) -> (&'static str, &'static str) {
        match self {
            Self::OpenaiCompatible => ("API", ""),
            Self::Anthropic => ("Anthropic", "https://api.anthropic.com"),
            Self::OpenaiResponses => ("xAI", "https://api.x.ai/v1"),
            Self::Chatgpt => ("ChatGPT", "https://chatgpt.com/backend-api"),
            local => super::providers::local_for(local)
                .map(|p| (p.name, p.base_url))
                .unwrap_or(("API", "")),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::LmStudio => "lm-studio",
            Self::Unsloth => "unsloth",
            Self::Mlx => "mlx",
            Self::LlamaCpp => "llama-cpp",
            Self::Vllm => "vllm",
            Self::Jan => "jan",
            Self::LocalAi => "local-ai",
            Self::OpenaiCompatible => "openai-compatible",
            Self::Anthropic => "anthropic",
            Self::OpenaiResponses => "openai-responses",
            Self::Chatgpt => "chatgpt",
        }
    }
    /// The authentication a new connection of this service starts with.
    pub fn default_auth(self) -> Auth {
        match self {
            Self::Unsloth | Self::OpenaiCompatible | Self::Anthropic | Self::OpenaiResponses => {
                Auth::Bearer
            }
            Self::Chatgpt => Auth::Oauth,
            Self::Ollama
            | Self::LmStudio
            | Self::Mlx
            | Self::LlamaCpp
            | Self::Vllm
            | Self::Jan
            | Self::LocalAi => Auth::None,
        }
    }
    /// The protocol the Built-in Agent speaks to this service.
    pub fn protocol(self) -> super::providers::Protocol {
        use super::providers::Protocol;
        match self {
            Self::Anthropic => Protocol::AnthropicMessages,
            Self::OpenaiResponses => Protocol::OpenaiResponses,
            Self::Chatgpt => Protocol::CodexResponses,
            _ => Protocol::OpenaiChat,
        }
    }
    /// The endpoint is used as written: the protocol appends its own path
    /// (`/v1/messages`, `/codex/responses`), so no `/v1` is added.
    pub fn exact_endpoint(self) -> bool {
        matches!(self, Self::Anthropic | Self::Chatgpt)
    }
}
/// The user-facing category (`sourceKind`), not proof of where inference runs.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceKind {
    #[default]
    Api,
    Local,
}
impl SourceKind {
    pub fn key(self) -> &'static str {
        match self {
            Self::Api => "api",
            Self::Local => "local",
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Auth {
    #[default]
    None,
    Bearer,
    /// A provider sign-in: the Keychain item holds its OAuth credential.
    Oauth,
}
impl Auth {
    pub fn key(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Bearer => "bearer",
            Self::Oauth => "oauth",
        }
    }
}
/// The context a connection saved before context budgets were configurable
/// was served with.
pub const LEGACY_CONTEXT_WINDOW: u64 = 128_000;
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ModelConnection {
    pub id: String,
    pub name: String,
    /// `baseUrl`, as [`normalize_base_url`] writes it.
    pub endpoint: String,
    pub source_kind: SourceKind,
    pub driver: Driver,
    pub auth: Auth,
    /// The Keychain item of the key; only `bearer` connections have one.
    #[serde(default)]
    pub credential_id: Option<String>,
    pub generation: String,
    #[serde(default)]
    pub default_model_id: Option<String>,
    /// A model the service may not list (`manualModelId`).
    #[serde(default)]
    pub manual_model_id: Option<String>,
    /// The context budget used when the service reports none.
    #[serde(default)]
    pub manual_context_window: Option<u64>,
    /// Unsloth only: the user started it with `--disable-tools`.
    #[serde(default)]
    pub server_tools_disabled: bool,
    /// The registered provider (`providers::get`), when the connection was
    /// made from a preset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// The sign-in an `Auth::Oauth` connection was made with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth_provider: Option<super::oauth::OauthProvider>,
    /// The model one Agent member of this connection serves; never stored.
    #[serde(skip)]
    pub model: String,
    /// PuppyOne compute (`sourceKind: "managed"`): read-only, inferred
    /// through the signed-in account, never a stored credential.
    #[serde(default, skip_serializing)]
    pub managed: bool,
}
/// `isLoopbackHost`.
pub fn is_loopback_host(host: &str) -> bool {
    host == "localhost"
        || host == "[::1]"
        || host.strip_prefix("127.").is_some_and(|rest| {
            let parts: Vec<&str> = rest.split('.').collect();
            parts.len() == 3
                && parts
                    .iter()
                    .all(|p| (1..=3).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()))
        })
}
/// `normalizeModelBaseUrl`: http(s) without credentials, query or fragment;
/// HTTP only on loopback; `localhost` pinned to `127.0.0.1`; one `/v1`
/// suffix and no trailing slash.
pub fn normalize_base_url(value: &str) -> Result<String, String> {
    normalize_endpoint(value, Driver::OpenaiCompatible)
}
/// [`normalize_base_url`] for `driver`: a path that already ends in an API
/// version (`/v4`, `/v1beta/openai`) keeps it, and drivers that append their
/// own path ([`Driver::exact_endpoint`]) keep the URL as written.
pub fn normalize_endpoint(value: &str, driver: Driver) -> Result<String, String> {
    let invalid = || crate::localization::t("native.modelConnections.invalidUrl").to_owned();
    if value.len() > 2048 || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(invalid());
    }
    let mut url = url::Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some_and(|q| !q.is_empty())
        || url.fragment().is_some_and(|f| !f.is_empty())
    {
        return Err(invalid());
    }
    let host = url.host_str().unwrap_or_default().to_owned();
    if url.scheme() != "https" && !is_loopback_host(&host) {
        return Err(crate::localization::t("native.modelConnections.insecureUrl").into());
    }
    if host == "localhost" {
        url.set_host(Some("127.0.0.1")).map_err(|_| invalid())?;
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_owned();
    let last = path.rsplit('/').next().unwrap_or_default();
    let versioned = last == "openai"
        || last.strip_prefix('v').is_some_and(|rest| {
            rest.starts_with(|c: char| c.is_ascii_digit())
                && rest.chars().all(|c| c.is_ascii_alphanumeric())
        });
    url.set_path(&if driver.exact_endpoint() || versioned {
        path
    } else {
        format!("{path}/v1")
    });
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
/// `text(value, 300, true)`: an optional model ID, trimmed.
fn model_id(value: Option<&str>) -> Result<Option<String>, String> {
    match value {
        None | Some("") => Ok(None),
        Some(id) => schema::text(id, 300)
            .map(Some)
            .map_err(|_| "INVALID_CONFIGURATION".to_owned()),
    }
}
impl ModelConnection {
    /// `parseConnectionCommand("save")`'s configuration checks. A stored
    /// connection is valid exactly when it could have been saved.
    pub fn validate(&self) -> Result<(), String> {
        uuid::Uuid::parse_str(&self.id)
            .map_err(|_| crate::localization::t("native.modelConnections.invalidIdentity"))?;
        schema::text(&self.name, 120).map_err(|_| "INVALID_CONFIGURATION".to_owned())?;
        normalize_endpoint(&self.endpoint, self.driver)?;
        if (self.auth == Auth::Oauth) != self.oauth_provider.is_some() {
            return Err("INVALID_CONFIGURATION".into());
        }
        model_id(self.default_model_id.as_deref())?;
        model_id(self.manual_model_id.as_deref())?;
        if self
            .manual_context_window
            .is_some_and(|c| !(1024..=10_000_000).contains(&c))
        {
            return Err("INVALID_CONTEXT".into());
        }
        Ok(())
    }
    pub fn route(&self) -> String {
        format!("{}/{}", self.id, self.model)
    }
    /// The models the Agent may use through this connection, one member
    /// each: the default and manual model IDs (`connectionModels`). An
    /// Unsloth server keeping its own tools (`SERVER_TOOLS_MUST_BE_DISABLED`)
    /// or a connection without a context budget (`CONTEXT_REQUIRED`) serves
    /// none.
    pub fn members(&self) -> Vec<ModelConnection> {
        if (self.driver == Driver::Unsloth && !self.server_tools_disabled)
            || self.manual_context_window.is_none()
        {
            return vec![];
        }
        let mut ids: Vec<&String> = vec![];
        for id in [&self.default_model_id, &self.manual_model_id]
            .into_iter()
            .flatten()
        {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids.into_iter()
            .map(|id| ModelConnection {
                model: id.clone(),
                ..self.clone()
            })
            .collect()
    }
    /// The credential this connection's requests carry (`None` without
    /// authentication), an OAuth token refreshed first when it is about to
    /// expire.
    pub async fn resolve_credential(&self) -> Result<Option<super::credentials::Resolved>, String> {
        if self.auth == Auth::None {
            return Ok(None);
        }
        let Some(reference) = self.credential_id.as_deref() else {
            return Err("CREDENTIAL_REQUIRED".into());
        };
        super::credentials::resolve(reference, self.oauth_provider)
            .await
            .map(Some)
    }
    /// The bearer token, without refreshing (catalog reads).
    pub fn credential(&self) -> Result<Option<String>, String> {
        if self.auth == Auth::None {
            return Ok(None);
        }
        let Some(reference) = self.credential_id.as_deref() else {
            return Err("CREDENTIAL_REQUIRED".into());
        };
        super::credentials::read(reference).map(|c| Some(c.bearer().to_owned()))
    }
    /// The signed-in account's label (OAuth), for Settings.
    pub fn account_label(&self) -> Option<String> {
        if self.auth != Auth::Oauth {
            return None;
        }
        super::credentials::read(self.credential_id.as_deref()?)
            .ok()?
            .label()
            .map(str::to_owned)
    }
    /// The provider this connection was made from, if registered.
    pub fn provider(&self) -> Option<&'static super::providers::Provider> {
        super::providers::of(self.provider.as_deref(), self.oauth_provider, self.driver)
    }
}
/// The managed connection (`withManagedConnection`): one PuppyOne entry per
/// catalog model while Payments is on, the account is signed in and the
/// wallet has credit. The directory is reused for a minute.
pub fn managed(account: &dyn super::ComputeAccount) -> Vec<ModelConnection> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    /// Account key, read time, catalog models and whether credit remains.
    type Directory = (String, Instant, Vec<(String, String)>, bool);
    static CACHE: Mutex<Option<Directory>> = Mutex::new(None);
    let Some((broker, binding)) = account.current() else {
        return vec![];
    };
    let key = format!(
        "{}\n{}\n{}",
        binding.user,
        binding.epoch,
        binding.environment.api()
    );
    let fresh = CACHE
        .lock()
        .ok()
        .and_then(|c| c.clone())
        .filter(|(k, at, _, _)| *k == key && at.elapsed() < Duration::from_secs(60));
    let (models, available) = match fresh {
        Some((_, _, models, available)) => (models, available),
        None => {
            let get = |path: &str| {
                broker
                    .request(
                        &binding,
                        &crate::cloud::auth::model::ApiRequest {
                            idempotency_key: None,
                            method: reqwest::Method::GET,
                            path: path.into(),
                            query: vec![],
                            body: None,
                        },
                    )
                    .ok()
                    .map(|v| {
                        if v.get("code").is_some() && v.get("data").is_some() {
                            v["data"].clone()
                        } else {
                            v
                        }
                    })
            };
            let models: Vec<(String, String)> = get("/ai/catalog")
                .and_then(|c| c["models"].as_array().cloned())
                .unwrap_or_default()
                .iter()
                .filter_map(|m| {
                    Some((
                        m["id"].as_str()?.to_owned(),
                        m["name"].as_str().unwrap_or_default().to_owned(),
                    ))
                })
                .collect();
            let available = get("/ai/balance")
                .and_then(|b| b["available_micro_usd"].as_i64())
                .is_some_and(|a| a > 0);
            if let Ok(mut cache) = CACHE.lock() {
                *cache = Some((key.clone(), Instant::now(), models.clone(), available));
            }
            (models, available)
        }
    };
    if !available {
        return vec![];
    }
    // A stable identity per account and service (`mc_…` in the product).
    let id = {
        use sha2::Digest as _;
        let digest = sha2::Sha256::digest(
            format!(
                "puppyone-managed:{}:{}",
                binding.environment.api(),
                binding.user
            )
            .as_bytes(),
        );
        let mut bytes = [0u8; 16];
        bytes.copy_from_slice(&digest[..16]);
        uuid::Builder::from_random_bytes(bytes)
            .into_uuid()
            .to_string()
    };
    models
        .into_iter()
        .map(|(model, _)| ModelConnection {
            id: id.clone(),
            name: "PuppyOne".into(),
            endpoint: format!("{}/ai", binding.environment.api()),
            model,
            generation: format!("managed-{}", binding.epoch),
            server_tools_disabled: true,
            managed: true,
            ..Default::default()
        })
        .collect()
}
pub fn data_dir() -> PathBuf {
    std::env::var_os("PUPPYONE_RUST_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Library/Application Support/PuppyOne GPUI")
        })
}
pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> Result<T, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = vec![];
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(crate::localization::t("native.modelConnections.readLimit").into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or(crate::localization::t(
        "native.modelConnections.missingStorage",
    ))?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        serde_json::to_writer(&mut file, value)?;
        file.flush()?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })()
    .map_err(|e| e.to_string());
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}
/// A connection saved before connections named their service: the driver
/// its port implies (as its catalog was read), the category
/// `parseConnectionCommand` infers, its one model as both the default and a
/// manual model ID, the context it was served with, and its Keychain item,
/// which was keyed by the connection ID. The endpoint is kept as it was.
fn migrate(mut value: serde_json::Value) -> serde_json::Value {
    use serde_json::{Value, json};
    let Some(entry) = value.as_object_mut() else {
        return value;
    };
    if entry.contains_key("driver") {
        return value;
    }
    let url = entry
        .get("endpoint")
        .and_then(Value::as_str)
        .and_then(|e| url::Url::parse(e).ok());
    let driver = match url.as_ref().and_then(url::Url::port) {
        Some(11434) => Driver::Ollama,
        Some(1234) => Driver::LmStudio,
        _ => Driver::OpenaiCompatible,
    };
    let loopback = url
        .as_ref()
        .and_then(|u| u.host_str().map(is_loopback_host))
        .unwrap_or(false);
    let source = if driver != Driver::OpenaiCompatible || loopback {
        SourceKind::Local
    } else {
        SourceKind::Api
    };
    let authenticated = entry.remove("authenticated") == Some(Value::Bool(true));
    entry.remove("images");
    let model = entry
        .remove("model")
        .filter(|m| m.as_str().is_some_and(|m| !m.is_empty()));
    entry.insert("driver".into(), json!(driver));
    entry.insert("source_kind".into(), json!(source));
    entry.insert(
        "auth".into(),
        json!(if authenticated {
            Auth::Bearer
        } else {
            Auth::None
        }),
    );
    if authenticated && entry.get("credential_id").is_none_or(Value::is_null) {
        let id = entry.get("id").cloned().unwrap_or(Value::Null);
        entry.insert("credential_id".into(), id);
    }
    if let Some(model) = model {
        entry.insert("default_model_id".into(), model.clone());
        entry.insert("manual_model_id".into(), model);
    }
    entry.insert("manual_context_window".into(), json!(LEGACY_CONTEXT_WINDOW));
    value
}
/// The last parse of `model-connections.json`, keyed by its path, length and
/// modification time: every turn resolves its connection, and an unchanged
/// file is not read and validated again.
type Snapshot = (
    PathBuf,
    u64,
    Option<std::time::SystemTime>,
    Vec<ModelConnection>,
);
static SNAPSHOT: std::sync::Mutex<Option<Snapshot>> = std::sync::Mutex::new(None);
/// Forget the cached parse (after this process writes the file).
pub fn invalidate_snapshot() {
    if let Ok(mut snapshot) = SNAPSHOT.lock() {
        *snapshot = None;
    }
}
pub fn load() -> Result<Vec<ModelConnection>, String> {
    let path = data_dir().join("model-connections.json");
    let Ok(meta) = std::fs::metadata(&path) else {
        return Ok(vec![]);
    };
    let (len, modified) = (meta.len(), meta.modified().ok());
    if let Some(hit) = SNAPSHOT.lock().ok().and_then(|s| {
        s.as_ref()
            .filter(|(p, l, m, _)| *p == path && *l == len && *m == modified && modified.is_some())
            .map(|(.., c)| c.clone())
    }) {
        return Ok(hit);
    }
    let connections = load_from(&path)?;
    if let Ok(mut snapshot) = SNAPSHOT.lock() {
        *snapshot = Some((path, len, modified, connections.clone()));
    }
    Ok(connections)
}
fn load_from(path: &Path) -> Result<Vec<ModelConnection>, String> {
    let stored: Vec<serde_json::Value> = read_json(path, 256 * 1024)?;
    if stored.len() > 32 {
        return Err(crate::localization::t("native.modelConnections.tooMany").into());
    }
    let connections = stored
        .into_iter()
        .map(|entry| serde_json::from_value::<ModelConnection>(migrate(entry)))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut identities = std::collections::HashSet::new();
    for c in &connections {
        c.validate()?;
        if !identities.insert(&c.id) {
            return Err(crate::localization::t("native.modelConnections.duplicate").into());
        }
    }
    Ok(connections)
}
/// The connections the Agent may use: every saved connection's members and
/// PuppyOne compute's.
pub fn agent_connections(
    account: &dyn super::ComputeAccount,
) -> Result<Vec<ModelConnection>, String> {
    let mut connections: Vec<ModelConnection> =
        load()?.iter().flat_map(ModelConnection::members).collect();
    connections.extend(managed(account));
    Ok(connections)
}
static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn check_generation(existing: Option<&ModelConnection>, generation: &str) -> Result<(), String> {
    match existing {
        Some(existing) if existing.generation != generation => {
            Err(crate::localization::t("native.modelConnections.editedElsewhere").into())
        }
        None if !generation.is_empty() => {
            Err(crate::localization::t("native.modelConnections.removedElsewhere").into())
        }
        _ => Ok(()),
    }
}
/// `parseConnectionCommand("save")` and `save`'s key rules over `previous`:
/// the configuration as it is stored, and the credential to secure, if any.
fn parse_save(
    mut connection: ModelConnection,
    secret: Option<Credential>,
    previous: Option<&ModelConnection>,
) -> Result<(ModelConnection, Option<Credential>), String> {
    match (&secret, connection.auth) {
        (Some(Credential::ApiKey { key }), Auth::Bearer) => super::credentials::validate_key(key)?,
        (Some(Credential::Oauth { .. }), Auth::Bearer) => {
            return Err("INVALID_CONFIGURATION".into());
        }
        _ => {}
    }
    connection.name =
        schema::text(&connection.name, 120).map_err(|_| "INVALID_CONFIGURATION".to_owned())?;
    connection.endpoint = normalize_endpoint(&connection.endpoint, connection.driver)?;
    connection.default_model_id = model_id(connection.default_model_id.as_deref())?;
    connection.manual_model_id = model_id(connection.manual_model_id.as_deref())?;
    if connection.auth != Auth::Oauth {
        connection.oauth_provider = None;
    }
    connection.validate()?;
    if connection.auth != Auth::None
        && secret.is_none()
        && previous.is_some_and(|p| {
            p.credential_id.is_some()
                && (p.endpoint != connection.endpoint || p.auth != connection.auth)
        })
    {
        return Err("KEY_CONFIRMATION_REQUIRED".into());
    }
    if connection.auth == Auth::Oauth
        && secret.is_none()
        && previous.is_none_or(|p| p.credential_id.is_none())
    {
        return Err("CREDENTIAL_REQUIRED".into());
    }
    // The caller cannot select an arbitrary Keychain item. Keep only the persisted
    // reference, or allocate a fresh one when a credential is entered.
    connection.credential_id = match connection.auth {
        Auth::None => None,
        Auth::Bearer | Auth::Oauth => previous.and_then(|p| p.credential_id.clone()),
    };
    connection.model = String::new();
    connection.managed = false;
    let secret = secret.filter(|_| connection.auth != Auth::None);
    Ok((connection, secret))
}
fn retired_credential<'a>(
    previous: Option<&'a ModelConnection>,
    connections: &[ModelConnection],
) -> Option<&'a str> {
    let reference = previous?.credential_id.as_deref()?;
    (!connections
        .iter()
        .any(|c| c.credential_id.as_deref() == Some(reference)))
    .then_some(reference)
}
fn delete_credential(id: &str) {
    super::credentials::delete(id);
}
/// Save `connection` with an API key typed into Settings (`None` keeps the
/// stored one).
pub fn save(connection: ModelConnection, secret: Option<String>) -> Result<(), String> {
    save_credential(connection, secret.map(|key| Credential::ApiKey { key }))
}
/// Save `connection` with a new credential (an API key or an OAuth sign-in).
pub fn save_credential(
    connection: ModelConnection,
    secret: Option<Credential>,
) -> Result<(), String> {
    let _guard = WRITES
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    let mut connections = load()?;
    let previous = connections.iter().find(|c| c.id == connection.id).cloned();
    check_generation(previous.as_ref(), &connection.generation)?;
    if previous.is_none() && connections.len() >= 32 {
        return Err(crate::localization::t("native.modelConnections.limitReached").into());
    }
    let (mut connection, secret) = parse_save(connection, secret, previous.as_ref())?;
    let mut staged_credential: Option<String> = None;
    if let Some(secret) = secret {
        let credential_id = uuid::Uuid::new_v4().to_string();
        super::credentials::write(&credential_id, &secret)?;
        connection.credential_id = Some(credential_id.clone());
        staged_credential = Some(credential_id);
    }
    connection.generation = uuid::Uuid::new_v4().to_string();
    connections.retain(|c| c.id != connection.id);
    connections.push(connection);
    let result = write_json(&data_dir().join("model-connections.json"), &connections);
    invalidate_snapshot();
    if result.is_err() {
        if let Some(id) = staged_credential {
            delete_credential(&id);
        }
    } else if let Some(id) = retired_credential(previous.as_ref(), &connections) {
        // Retire only after publishing the new configuration, never before it.
        delete_credential(id);
    }
    result
}
pub fn remove(id: &str, generation: &str) -> Result<(), String> {
    let _guard = WRITES
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    let mut connections = load()?;
    let index = connections
        .iter()
        .position(|c| c.id == id)
        .ok_or(crate::localization::t("native.modelConnections.missing"))?;
    if connections[index].generation != generation {
        return Err(crate::localization::t("native.modelConnections.changedBeforeRemove").into());
    }
    let connection = connections.remove(index);
    let written = write_json(&data_dir().join("model-connections.json"), &connections);
    invalidate_snapshot();
    written?;
    if let Some(id) = retired_credential(Some(&connection), &connections) {
        delete_credential(id);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn key_of(key: &str) -> Credential {
        Credential::ApiKey { key: key.into() }
    }
    fn local() -> ModelConnection {
        ModelConnection {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Test local".into(),
            endpoint: "http://localhost:11434".into(),
            manual_context_window: Some(4096),
            ..Default::default()
        }
    }
    #[test]
    fn concurrent_edit_and_delete_do_not_resurrect_or_retire_active_credentials() {
        let old = ModelConnection {
            auth: Auth::Bearer,
            credential_id: Some("old-key".into()),
            generation: "revision-1".into(),
            ..local()
        };
        assert!(check_generation(Some(&old), "revision-1").is_ok());
        assert!(check_generation(Some(&old), "revision-0").is_err());
        assert!(check_generation(None, "revision-1").is_err());
        assert!(check_generation(None, "").is_ok());
        assert_eq!(
            retired_credential(Some(&old), std::slice::from_ref(&old)),
            None
        );
        let mut replacement = old.clone();
        replacement.credential_id = Some("new-key".into());
        assert_eq!(
            retired_credential(Some(&old), &[replacement]),
            Some("old-key")
        );
        assert_eq!(retired_credential(Some(&old), &[]), Some("old-key"));
        let keyless = ModelConnection {
            credential_id: None,
            ..old
        };
        assert_eq!(retired_credential(Some(&keyless), &[]), None);
    }
    /// `connectionService.test.mjs`: "canonicalizes loopback and
    /// reverse-proxy prefixes without duplicate v1" and "rejects unsafe
    /// endpoint".
    #[test]
    fn base_urls_are_canonical_and_unsafe_endpoints_are_rejected() {
        assert_eq!(
            normalize_base_url("http://localhost:1234/v1/").unwrap(),
            "http://127.0.0.1:1234/v1"
        );
        assert_eq!(
            normalize_base_url("https://example.com/proxy/v1").unwrap(),
            "https://example.com/proxy/v1"
        );
        assert_eq!(
            normalize_base_url("http://127.0.0.1:11434").unwrap(),
            "http://127.0.0.1:11434/v1"
        );
        assert_eq!(
            normalize_base_url("http://[::1]:8000/").unwrap(),
            "http://[::1]:8000/v1"
        );
        for url in [
            "http://example.com",
            "https://user:password@example.com",
            "file:///tmp/model",
            "https://example.com?key=secret",
            "https://example.com#key",
            "https://example.com/a b",
            "http://127.0.0.1.example.com",
        ] {
            assert!(normalize_base_url(url).is_err(), "{url}");
        }
    }
    /// "does not accept … invalid contexts as configuration", "requires Key
    /// confirmation when the endpoint changes" and the `auth: none` path.
    #[test]
    fn saving_checks_the_configuration_and_keeps_keys_write_only() {
        let (saved, key) = parse_save(local(), None, None).unwrap();
        assert_eq!(saved.endpoint, "http://127.0.0.1:11434/v1");
        assert_eq!(key, None);
        for context in [1023, 10_000_001] {
            let invalid = ModelConnection {
                manual_context_window: Some(context),
                ..local()
            };
            assert_eq!(
                parse_save(invalid, None, None).unwrap_err(),
                "INVALID_CONTEXT"
            );
        }
        let blank = ModelConnection {
            name: "  ".into(),
            ..local()
        };
        assert!(parse_save(blank, None, None).is_err());
        let models = ModelConnection {
            default_model_id: Some(" qwen3 ".into()),
            manual_model_id: Some(String::new()),
            ..local()
        };
        let (models, _) = parse_save(models, None, None).unwrap();
        assert_eq!(
            (models.default_model_id.as_deref(), models.manual_model_id),
            (Some("qwen3"), None)
        );
        // A Key beginning with ! is opaque data; short or multi-line keys are not keys.
        let bearer = ModelConnection {
            auth: Auth::Bearer,
            ..local()
        };
        let (_, key) =
            parse_save(bearer.clone(), Some(key_of("!echo-not-executed")), None).unwrap();
        assert_eq!(key, Some(key_of("!echo-not-executed")));
        for key in ["short", "line\nbreak-key"] {
            assert!(parse_save(bearer.clone(), Some(key_of(key)), None).is_err());
        }
        // An edit keeps the stored key; another endpoint needs it again.
        let previous = ModelConnection {
            endpoint: "http://127.0.0.1:11434/v1".into(),
            credential_id: Some("stored-key".into()),
            ..bearer.clone()
        };
        let (kept, _) = parse_save(bearer.clone(), None, Some(&previous)).unwrap();
        assert_eq!(kept.credential_id.as_deref(), Some("stored-key"));
        let moved = ModelConnection {
            endpoint: "https://example.com/v1".into(),
            ..bearer.clone()
        };
        assert_eq!(
            parse_save(moved.clone(), None, Some(&previous)).unwrap_err(),
            "KEY_CONFIRMATION_REQUIRED"
        );
        assert!(parse_save(moved, Some(key_of("private-test-key")), Some(&previous)).is_ok());
        // No authentication drops the stored key and any key entered with it.
        let (none, key) =
            parse_save(local(), Some(key_of("private-test-key")), Some(&previous)).unwrap();
        assert_eq!((none.credential_id, key), (None, None));
    }
    #[test]
    fn a_connection_serves_its_named_models_when_the_agent_may_use_them() {
        let connection = ModelConnection {
            default_model_id: Some("qwen3".into()),
            manual_model_id: Some("custom".into()),
            ..local()
        };
        let models =
            |c: &ModelConnection| c.members().into_iter().map(|m| m.model).collect::<Vec<_>>();
        assert_eq!(models(&connection), ["qwen3", "custom"]);
        let same = ModelConnection {
            manual_model_id: Some("qwen3".into()),
            ..connection.clone()
        };
        assert_eq!(models(&same), ["qwen3"]);
        let no_context = ModelConnection {
            manual_context_window: None,
            ..connection.clone()
        };
        assert!(models(&no_context).is_empty());
        let unsloth = ModelConnection {
            driver: Driver::Unsloth,
            ..connection
        };
        assert!(models(&unsloth).is_empty());
        let disabled = ModelConnection {
            server_tools_disabled: true,
            ..unsloth
        };
        assert_eq!(models(&disabled), ["qwen3", "custom"]);
    }
    /// "migrates legacy categories" and "loads a pre-category configuration
    /// without changing its route".
    #[test]
    fn connections_saved_before_drivers_keep_their_model_route_and_key() {
        let id = uuid::Uuid::new_v4().to_string();
        let legacy = serde_json::json!({
            "id": id, "name": "Local", "endpoint": "http://localhost:11434/v1",
            "model": "qwen3", "images": false, "authenticated": true, "generation": "g"
        });
        let connection: ModelConnection = serde_json::from_value(migrate(legacy)).unwrap();
        assert_eq!(
            (connection.driver, connection.source_kind, connection.auth),
            (Driver::Ollama, SourceKind::Local, Auth::Bearer)
        );
        assert_eq!(connection.credential_id.as_deref(), Some(id.as_str()));
        assert_eq!(connection.endpoint, "http://localhost:11434/v1");
        assert_eq!(
            connection.manual_context_window,
            Some(LEGACY_CONTEXT_WINDOW)
        );
        let members = connection.members();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].route(), format!("{id}/qwen3"));
        let remote = serde_json::json!({
            "id": id, "name": "API", "endpoint": "https://example.com/v1",
            "model": "gpt", "authenticated": false, "credential_id": null, "generation": "g"
        });
        let remote: ModelConnection = serde_json::from_value(migrate(remote)).unwrap();
        assert_eq!(
            (
                remote.driver,
                remote.source_kind,
                remote.auth,
                remote.credential_id.clone()
            ),
            (Driver::OpenaiCompatible, SourceKind::Api, Auth::None, None)
        );
        // Stored connections are never migrated again.
        let stored = serde_json::to_value(&remote).unwrap();
        assert_eq!(migrate(stored.clone()), stored);
        assert!(stored.get("model").is_none());
    }
}
