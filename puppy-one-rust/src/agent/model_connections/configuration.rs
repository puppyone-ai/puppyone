//! Native model connections (`connection-service.mjs` over
//! `shared/model-connections/schema.mjs`). A saved connection is a service —
//! its driver, base URL, authentication and optional model and context
//! overrides; the Agent serves the models it names ([`ModelConnection::members`]).
//! Credentials live in the OS keychain, never JSON or command arguments.
use super::schema;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};
/// `MODEL_CONNECTION_DRIVERS`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Driver {
    Ollama,
    LmStudio,
    Unsloth,
    #[default]
    OpenaiCompatible,
}
impl Driver {
    pub const ALL: [Driver; 4] = [
        Driver::Ollama,
        Driver::LmStudio,
        Driver::Unsloth,
        Driver::OpenaiCompatible,
    ];
    /// `DRIVERS` in `ModelConnectionSetup.tsx`: the service's name and its
    /// default base URL.
    pub fn defaults(self) -> (&'static str, &'static str) {
        match self {
            Self::Ollama => ("Ollama", "http://127.0.0.1:11434/v1"),
            Self::LmStudio => ("LM Studio", "http://127.0.0.1:1234/v1"),
            Self::Unsloth => ("Unsloth", "http://127.0.0.1:8000/v1"),
            Self::OpenaiCompatible => ("API", ""),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Ollama => "ollama",
            Self::LmStudio => "lm-studio",
            Self::Unsloth => "unsloth",
            Self::OpenaiCompatible => "openai-compatible",
        }
    }
    /// The authentication a new connection of this service starts with.
    pub fn default_auth(self) -> Auth {
        match self {
            Self::Unsloth | Self::OpenaiCompatible => Auth::Bearer,
            Self::Ollama | Self::LmStudio => Auth::None,
        }
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
}
impl Auth {
    pub fn key(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Bearer => "bearer",
        }
    }
}
/// `MODEL_CONNECTION_LIMITS.keyBytes`.
const KEY_LIMIT: usize = 8192;
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
    /// The model one Agent member of this connection serves; never stored.
    #[serde(skip)]
    pub model: String,
    /// PuppyOne compute (`sourceKind: "managed"`): read-only, inferred
    /// through the signed-in account, never a stored credential.
    #[serde(default, skip_serializing)]
    pub managed: bool,
    /// Security generation: rotates only when endpoint, driver, auth,
    /// server_tools_disabled, manual overrides or credentials change, so
    /// renaming a connection or changing its default model does not revoke
    /// active session leases.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security_generation: Option<String>,
    /// Verified model IDs mapped to the `security_generation` at which the
    /// synthetic tool round-trip succeeded.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub verifications: std::collections::BTreeMap<String, String>,
    /// Reported vision capability from the probed catalog; never stored.
    #[serde(skip)]
    pub images: Option<bool>,
    /// Set in memory when upgraded from pre-driver JSON so legacy routes stay
    /// usable until the user edits the connection.
    #[serde(skip)]
    pub legacy_migrated: bool,
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
    url.set_path(&if path.ends_with("/v1") {
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
        normalize_base_url(&self.endpoint)?;
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
    /// The security generation governing active session leases and durable
    /// model verifications (falls back to `generation` for legacy entries).
    pub fn security_gen(&self) -> &str {
        self.security_generation
            .as_deref()
            .filter(|g| !g.is_empty())
            .unwrap_or(&self.generation)
    }
    /// Whether `model_id` passed tool round-trip verification at this
    /// connection's current security generation.
    pub fn is_verified(&self, model_id: &str) -> bool {
        let current = self.security_gen();
        !current.is_empty()
            && self
                .verifications
                .get(model_id)
                .is_some_and(|generation| generation == current)
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
    pub fn credential(&self) -> Result<Option<String>, String> {
        if self.auth == Auth::None {
            return Ok(None);
        }
        let Some(reference) = self.credential_id.as_deref() else {
            return Err("CREDENTIAL_REQUIRED".into());
        };
        let store = crate::platform::credentials::system();
        let value = match store.get(
            crate::platform::credentials::Namespace::ModelConnection,
            reference,
        ) {
            Ok(Some(bytes)) => bytes,
            Ok(None) => {
                return Err(crate::localization::t(
                    "native.modelConnections.credentialUnavailable",
                )
                .into());
            }
            Err(crate::platform::credentials::Error::Unavailable(_)) => {
                return Err(
                    crate::localization::t("native.modelConnections.noCredentialStorage").into(),
                );
            }
            Err(_) => {
                return Err(crate::localization::t(
                    "native.modelConnections.credentialUnavailable",
                )
                .into());
            }
        };
        String::from_utf8(value)
            .map(Some)
            .map_err(|_| crate::localization::t("native.modelConnections.credentialInvalid").into())
    }
}
/// Stable per-account, per-environment UUID for the read-only PuppyOne
/// managed compute connection (`mc_…` in the product).
pub fn managed_connection_id(binding: &crate::cloud::auth::model::Binding) -> String {
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
}

/// Projects the authoritative managed catalog & availability into read-only
/// [`ModelConnection`] entries, preserving each catalog model's real
/// `context_window` instead of falling back to a hardcoded constant.
pub fn managed_connections_for(
    binding: &crate::cloud::auth::model::Binding,
    catalog: &super::wallet::Catalog,
    available: bool,
) -> Vec<ModelConnection> {
    if !available {
        return vec![];
    }
    let id = managed_connection_id(binding);
    let generation = format!("managed-{}", binding.epoch);
    catalog
        .models
        .iter()
        .map(|entry| ModelConnection {
            id: id.clone(),
            name: "PuppyOne".into(),
            endpoint: format!("{}/ai", binding.environment.api()),
            model: entry.id.clone(),
            generation: generation.clone(),
            security_generation: Some(generation.clone()),
            manual_context_window: entry.context_window.or(Some(LEGACY_CONTEXT_WINDOW)),
            server_tools_disabled: true,
            managed: true,
            images: Some(false),
            ..Default::default()
        })
        .collect()
}

/// Live fallback read of managed connections when no [`super::service::ModelConnectionService`]
/// is mounted (never poisons a process-wide cache with failed responses).
pub fn managed(account: &dyn super::ComputeAccount) -> Vec<ModelConnection> {
    let Some((broker, binding)) = account.current() else {
        return vec![];
    };
    let catalog = broker
        .public("/ai/catalog")
        .ok()
        .map(super::wallet::data)
        .and_then(|v| super::wallet::parse_catalog(&v));
    let Some(catalog) = catalog else {
        return vec![];
    };
    let balance = broker
        .request(
            &binding,
            &crate::cloud::auth::model::ApiRequest {
                idempotency_key: None,
                method: reqwest::Method::GET,
                path: "/ai/balance".into(),
                query: vec![],
                body: None,
            },
        )
        .ok()
        .map(super::wallet::data)
        .and_then(|v| super::wallet::parse_balance(&v));
    let available = balance.is_some_and(|b| b.available_micro_usd > 0);
    managed_connections_for(&binding, &catalog, available)
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
        let mut file = crate::platform::fs::open_private_create_new(&temp)?;
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
pub fn load() -> Result<Vec<ModelConnection>, String> {
    load_at(&data_dir())
}
pub fn load_at(dir: &Path) -> Result<Vec<ModelConnection>, String> {
    let path = dir.join("model-connections.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let stored: Vec<serde_json::Value> = read_json(&path, 256 * 1024)?;
    if stored.len() > 32 {
        return Err(crate::localization::t("native.modelConnections.tooMany").into());
    }
    let connections = stored
        .into_iter()
        .map(|entry| {
            let legacy = entry
                .as_object()
                .is_some_and(|o| !o.contains_key("driver"));
            let mut conn = serde_json::from_value::<ModelConnection>(migrate(entry))?;
            conn.legacy_migrated = legacy;
            Ok::<_, serde_json::Error>(conn)
        })
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
/// the configuration as it is stored, and the key to secure, if any.
fn parse_save(
    mut connection: ModelConnection,
    secret: Option<String>,
    previous: Option<&ModelConnection>,
) -> Result<(ModelConnection, Option<String>), String> {
    if secret.as_deref().is_some_and(|key| {
        !(8..=KEY_LIMIT).contains(&crate::text::len16(key)) || key.contains(['\r', '\n', '\0'])
    }) {
        return Err(crate::localization::t("native.modelConnections.invalidKey").into());
    }
    connection.name =
        schema::text(&connection.name, 120).map_err(|_| "INVALID_CONFIGURATION".to_owned())?;
    connection.endpoint = normalize_base_url(&connection.endpoint)?;
    connection.default_model_id = model_id(connection.default_model_id.as_deref())?;
    connection.manual_model_id = model_id(connection.manual_model_id.as_deref())?;
    connection.validate()?;
    if connection.auth == Auth::Bearer
        && secret.is_none()
        && previous.is_some_and(|p| p.credential_id.is_some() && p.endpoint != connection.endpoint)
    {
        return Err("KEY_CONFIRMATION_REQUIRED".into());
    }
    // The caller cannot select an arbitrary Keychain item. Keep only the persisted
    // reference, or allocate a fresh one when a key is entered.
    connection.credential_id = match connection.auth {
        Auth::None => None,
        Auth::Bearer => previous.and_then(|p| p.credential_id.clone()),
    };
    connection.model = String::new();
    connection.managed = false;
    let secret = secret.filter(|_| connection.auth == Auth::Bearer);
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
    let _ = crate::platform::credentials::system()
        .delete(crate::platform::credentials::Namespace::ModelConnection, id);
}
pub fn save(connection: ModelConnection, secret: Option<String>) -> Result<(), String> {
    save_at(&data_dir(), connection, secret).map(|_| ())
}
/// Saves `connection` under `dir`, returning `(saved_connection, security_changed)`.
/// Renaming or changing `default_model_id` rotates only `generation`, keeping
/// `security_generation`, active leases and durable model verifications intact.
pub fn save_at(
    dir: &Path,
    connection: ModelConnection,
    secret: Option<String>,
) -> Result<(ModelConnection, bool), String> {
    let _guard = WRITES
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    let mut connections = load_at(dir)?;
    let previous = connections.iter().find(|c| c.id == connection.id).cloned();
    check_generation(previous.as_ref(), &connection.generation)?;
    if previous.is_none() && connections.len() >= 32 {
        return Err(crate::localization::t("native.modelConnections.limitReached").into());
    }
    let (mut connection, secret) = parse_save(connection, secret, previous.as_ref())?;
    let security_changed = previous.as_ref().is_none_or(|p| {
        p.endpoint != connection.endpoint
            || p.driver != connection.driver
            || p.auth != connection.auth
            || p.server_tools_disabled != connection.server_tools_disabled
            || p.manual_model_id != connection.manual_model_id
            || p.manual_context_window != connection.manual_context_window
            || secret.is_some()
    });
    let mut staged_credential: Option<String> = None;
    if let Some(secret) = secret {
        let credential_id = uuid::Uuid::new_v4().to_string();
        let store = crate::platform::credentials::system();
        store
            .set(
                crate::platform::credentials::Namespace::ModelConnection,
                &credential_id,
                secret.as_bytes(),
            )
            .map_err(|err| match err {
                crate::platform::credentials::Error::Unavailable(_) => {
                    crate::localization::t("native.modelConnections.noCredentialStorage")
                }
                _ => crate::localization::t("native.modelConnections.keychainSaveFailed"),
            })?;
        connection.credential_id = Some(credential_id.clone());
        staged_credential = Some(credential_id);
    }
    let next_generation = uuid::Uuid::new_v4().to_string();
    connection.generation = next_generation.clone();
    if security_changed {
        connection.security_generation = Some(next_generation);
        connection.verifications.clear();
    } else if let Some(prev) = previous.as_ref() {
        connection.security_generation = Some(prev.security_gen().to_owned());
        connection.verifications = prev.verifications.clone();
    }
    let saved = connection.clone();
    connections.retain(|c| c.id != connection.id);
    connections.push(connection);
    let result = write_json(&dir.join("model-connections.json"), &connections);
    if result.is_err() {
        if let Some(id) = staged_credential {
            delete_credential(&id);
        }
        return Err(result.unwrap_err());
    }
    if let Some(id) = retired_credential(previous.as_ref(), &connections) {
        // Retire only after publishing the new configuration, never before it.
        delete_credential(id);
    }
    Ok((saved, security_changed))
}
pub fn remove(id: &str, generation: &str) -> Result<(), String> {
    remove_at(&data_dir(), id, generation)
}
pub fn remove_at(dir: &Path, id: &str, generation: &str) -> Result<(), String> {
    let _guard = WRITES
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    let mut connections = load_at(dir)?;
    let index = connections
        .iter()
        .position(|c| c.id == id)
        .ok_or(crate::localization::t("native.modelConnections.missing"))?;
    if connections[index].generation != generation {
        return Err(crate::localization::t("native.modelConnections.changedBeforeRemove").into());
    }
    let connection = connections.remove(index);
    write_json(&dir.join("model-connections.json"), &connections)?;
    if let Some(id) = retired_credential(Some(&connection), &connections) {
        delete_credential(id);
    }
    Ok(())
}
/// Persists a verified tool round-trip for `(id, model_id)` if the connection
/// is still at `expected_security_generation`.
pub fn record_verification_at(
    dir: &Path,
    id: &str,
    model_id: &str,
    expected_security_generation: &str,
) -> Result<ModelConnection, String> {
    let _guard = WRITES
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    let mut connections = load_at(dir)?;
    let Some(entry) = connections.iter_mut().find(|c| c.id == id) else {
        return Err("CONNECTION_NOT_FOUND".into());
    };
    if entry.security_gen() != expected_security_generation {
        return Err("CONFIGURATION_CONFLICT".into());
    }
    entry
        .verifications
        .insert(model_id.to_owned(), expected_security_generation.to_owned());
    let updated = entry.clone();
    write_json(&dir.join("model-connections.json"), &connections)?;
    Ok(updated)
}
#[cfg(test)]
mod tests {
    use super::*;
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
        let (_, key) = parse_save(bearer.clone(), Some("!echo-not-executed".into()), None).unwrap();
        assert_eq!(key.as_deref(), Some("!echo-not-executed"));
        for key in ["short", "line\nbreak-key"] {
            assert!(parse_save(bearer.clone(), Some(key.into()), None).is_err());
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
        assert!(parse_save(moved, Some("private-test-key".into()), Some(&previous)).is_ok());
        // No authentication drops the stored key and any key entered with it.
        let (none, key) =
            parse_save(local(), Some("private-test-key".into()), Some(&previous)).unwrap();
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
