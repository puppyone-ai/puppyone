//! Model-connection credentials: the Keychain items behind `credential_id`
//! and what they hold. An API key is stored as the key itself (as every
//! earlier release wrote it); an OAuth sign-in as a typed JSON envelope with
//! its refresh token. Values live only here and in the Keychain: never in
//! `model-connections.json`, URLs, logs, errors or a worker's arguments.
use super::oauth::{self, OauthProvider};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// The Keychain service every model-connection item is filed under.
/// The longest API key accepted (`MODEL_CONNECTION_LIMITS.keyBytes`).
pub const KEY_LIMIT: usize = 8192;
/// The largest stored OAuth envelope.
const OAUTH_LIMIT: usize = 32 * 1024;
/// Access tokens are refreshed this long before they expire.
pub const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;

/// What a Keychain item holds.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Credential {
    /// A key the user pasted, or one an OAuth exchange issued (OpenRouter).
    ApiKey { key: String },
    /// An OAuth token set.
    Oauth {
        access: String,
        #[serde(default)]
        refresh: String,
        /// Unix milliseconds; `0` when the provider gave no expiry.
        #[serde(default)]
        expires: i64,
        /// The provider's account (ChatGPT's `chatgpt_account_id`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        account_id: Option<String>,
        /// The signed-in account's label shown in Settings (an email).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
        /// The API endpoint the sign-in assigned (Qwen's `resource_url`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
    },
}

/// Never print a credential, even in a debug build or a panic message.
impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ApiKey { .. } => f.write_str("Credential::ApiKey(<redacted>)"),
            Self::Oauth { expires, .. } => {
                write!(f, "Credential::Oauth(<redacted>, expires: {expires})")
            }
        }
    }
}

impl Credential {
    /// Reads an item's bytes: a JSON envelope, else (any earlier release) a
    /// bare key.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let text = std::str::from_utf8(bytes)
            .map_err(|_| crate::localization::t("native.modelConnections.credentialInvalid"))?;
        if text.starts_with('{')
            && let Ok(credential) = serde_json::from_str::<Credential>(text)
        {
            return Ok(credential);
        }
        Ok(Self::ApiKey {
            key: text.to_owned(),
        })
    }
    /// The bytes the item stores: a key as itself, OAuth as JSON.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        match self {
            Self::ApiKey { key } => Ok(key.as_bytes().to_vec()),
            Self::Oauth { .. } => {
                let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
                if bytes.len() > OAUTH_LIMIT {
                    return Err("CREDENTIAL_TOO_LARGE".into());
                }
                Ok(bytes)
            }
        }
    }
    /// The bearer token requests carry.
    pub fn bearer(&self) -> &str {
        match self {
            Self::ApiKey { key } => key,
            Self::Oauth { access, .. } => access,
        }
    }
    pub fn account_id(&self) -> Option<&str> {
        match self {
            Self::Oauth { account_id, .. } => account_id.as_deref(),
            Self::ApiKey { .. } => None,
        }
    }
    pub fn label(&self) -> Option<&str> {
        match self {
            Self::Oauth { label, .. } => label.as_deref(),
            Self::ApiKey { .. } => None,
        }
    }
    /// The API endpoint the sign-in assigned, if any.
    pub fn endpoint(&self) -> Option<&str> {
        match self {
            Self::Oauth { endpoint, .. } => endpoint.as_deref(),
            Self::ApiKey { .. } => None,
        }
    }
    /// An OAuth access token due for refresh at `now` (Unix ms).
    pub fn needs_refresh(&self, now: i64) -> bool {
        match self {
            Self::Oauth {
                expires, refresh, ..
            } => *expires > 0 && !refresh.is_empty() && now + REFRESH_MARGIN_MS >= *expires,
            Self::ApiKey { .. } => false,
        }
    }
}

/// `parseConnectionCommand`'s key check: `8..=8192` UTF-16 units on one line.
pub fn validate_key(key: &str) -> Result<(), String> {
    if !(8..=KEY_LIMIT).contains(&crate::text::len16(key)) || key.contains(['\r', '\n', '\0']) {
        return Err(crate::localization::t("native.modelConnections.invalidKey").into());
    }
    Ok(())
}

/// Where items are kept. The app uses the macOS Keychain; tests swap in
/// memory with [`use_memory_store`].
trait Store: Send + Sync {
    fn get(&self, id: &str) -> Result<Vec<u8>, String>;
    fn set(&self, id: &str, value: &[u8]) -> Result<(), String>;
    fn delete(&self, id: &str);
}

/// The system credential store (`platform::credentials`): the macOS
/// Keychain, Windows Credential Manager or the Secret Service, under the
/// same service name as before.
struct Keychain;
impl Store for Keychain {
    fn get(&self, id: &str) -> Result<Vec<u8>, String> {
        use crate::platform::credentials::{Error, Namespace, system};
        match system().get(Namespace::ModelConnection, id) {
            Ok(Some(bytes)) => Ok(bytes),
            Err(Error::Unavailable(_)) => {
                Err(crate::localization::t("native.modelConnections.noCredentialStorage").into())
            }
            Ok(None) | Err(_) => {
                Err(crate::localization::t("native.modelConnections.credentialUnavailable").into())
            }
        }
    }
    fn set(&self, id: &str, value: &[u8]) -> Result<(), String> {
        use crate::platform::credentials::{Error, Namespace, system};
        system()
            .set(Namespace::ModelConnection, id, value)
            .map_err(|err| match err {
                Error::Unavailable(_) => {
                    crate::localization::t("native.modelConnections.noCredentialStorage").into()
                }
                _ => crate::localization::t("native.modelConnections.keychainSaveFailed").into(),
            })
    }
    fn delete(&self, id: &str) {
        use crate::platform::credentials::{Namespace, system};
        let _ = system().delete(Namespace::ModelConnection, id);
    }
}

#[derive(Default)]
struct Memory(Mutex<HashMap<String, Vec<u8>>>);
impl Store for Memory {
    fn get(&self, id: &str) -> Result<Vec<u8>, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| "CREDENTIAL_UNAVAILABLE".into())
    }
    fn set(&self, id: &str, value: &[u8]) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.into(), value.to_vec());
        Ok(())
    }
    fn delete(&self, id: &str) {
        if let Ok(mut items) = self.0.lock() {
            items.remove(id);
        }
    }
}

static STORE: LazyLock<Mutex<Box<dyn Store>>> = LazyLock::new(|| Mutex::new(Box::new(Keychain)));
/// Decoded items by `credential_id`, so a turn does not read the Keychain
/// again; every write and delete updates it.
static CACHE: LazyLock<Mutex<HashMap<String, Credential>>> = LazyLock::new(Default::default);

/// Tests only: keep items in memory instead of the Keychain.
pub fn use_memory_store() {
    if let Ok(mut store) = STORE.lock() {
        *store = Box::new(Memory::default());
    }
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
}

fn with_store<T>(f: impl FnOnce(&dyn Store) -> T) -> Result<T, String> {
    let store = STORE
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    Ok(f(store.as_ref()))
}

/// The credential stored as `id`.
pub fn read(id: &str) -> Result<Credential, String> {
    if let Some(hit) = CACHE.lock().ok().and_then(|c| c.get(id).cloned()) {
        return Ok(hit);
    }
    let credential = Credential::parse(&with_store(|s| s.get(id))??)?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(id.to_owned(), credential.clone());
    }
    Ok(credential)
}

/// Store `credential` as `id`.
pub fn write(id: &str, credential: &Credential) -> Result<(), String> {
    let bytes = credential.encode()?;
    with_store(|s| s.set(id, &bytes))??;
    if let Ok(mut cache) = CACHE.lock() {
        cache.insert(id.to_owned(), credential.clone());
    }
    Ok(())
}

/// Remove item `id`.
pub fn delete(id: &str) {
    let _ = with_store(|s| s.delete(id));
    if let Ok(mut cache) = CACHE.lock() {
        cache.remove(id);
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// What a request authenticates with.
#[derive(Clone)]
pub struct Resolved {
    pub bearer: String,
    pub account_id: Option<String>,
}

/// The credential a connection's requests carry, refreshed first when an
/// OAuth access token is about to expire. A refresh the provider refuses is
/// `OAUTH_REAUTH_REQUIRED`: the user signs in again; nothing falls back to
/// another route.
pub async fn resolve(id: &str, provider: Option<OauthProvider>) -> Result<Resolved, String> {
    resolve_with(id, provider, false).await
}

/// [`resolve`], refreshing the OAuth token whatever its expiry says: the
/// provider just refused it (401), so it was revoked or rotated early.
/// `None` when there is no refresh token to try.
pub async fn resolve_fresh(
    id: &str,
    provider: Option<OauthProvider>,
) -> Result<Option<Resolved>, String> {
    match read(id)? {
        Credential::Oauth { refresh, .. } if !refresh.is_empty() && provider.is_some() => {
            resolve_with(id, provider, true).await.map(Some)
        }
        _ => Ok(None),
    }
}

/// One refresh per credential at a time: a provider that rotates its
/// refresh token (ChatGPT) refuses the second of two refreshes made with
/// the same one.
fn refresh_lock(id: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCKS: LazyLock<Mutex<HashMap<String, std::sync::Arc<tokio::sync::Mutex<()>>>>> =
        LazyLock::new(Default::default);
    let mut locks = LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, lock| std::sync::Arc::strong_count(lock) > 1);
    locks.entry(id.to_owned()).or_default().clone()
}

async fn resolve_with(
    id: &str,
    provider: Option<OauthProvider>,
    force: bool,
) -> Result<Resolved, String> {
    let credential = read(id)?;
    let refreshable =
        |c: &Credential| matches!(c, Credential::Oauth { refresh, .. } if !refresh.is_empty());
    let stale = credential.needs_refresh(now_ms()) || (force && refreshable(&credential));
    let credential = match (provider, stale) {
        (Some(provider), true) => {
            let lock = refresh_lock(id);
            let _refreshing = lock.lock().await;
            // Another request may have refreshed it while this one waited:
            // its token serves, and the rotated refresh token is not spent
            // twice.
            let current = read(id)?;
            if current.bearer() != credential.bearer() || !current.needs_refresh(now_ms()) && !force
            {
                return Ok(Resolved {
                    bearer: current.bearer().to_owned(),
                    account_id: current.account_id().map(str::to_owned),
                });
            }
            let credential = current;
            let Credential::Oauth {
                refresh,
                account_id,
                label,
                endpoint,
                ..
            } = &credential
            else {
                unreachable!("only OAuth credentials need a refresh")
            };
            // Only a refusal asks the user to sign in again; a network or
            // gateway failure is reported as what it is.
            let fresh = oauth::refresh(provider, refresh, account_id.as_deref())
                .await
                .map_err(|e| match e.as_str() {
                    "OAUTH_UNREACHABLE" | "OAUTH_UNAVAILABLE" | "OAUTH_TIMEOUT" => e,
                    _ => "OAUTH_REAUTH_REQUIRED".to_owned(),
                })?;
            // A provider that does not rotate the refresh token, or omits
            // the account, keeps the ones it issued at sign-in.
            let fresh = match fresh {
                Credential::Oauth {
                    access,
                    refresh: next,
                    expires,
                    account_id: next_account,
                    label: next_label,
                    endpoint: next_endpoint,
                } => Credential::Oauth {
                    access,
                    refresh: if next.is_empty() {
                        refresh.clone()
                    } else {
                        next
                    },
                    expires,
                    account_id: next_account.or_else(|| account_id.clone()),
                    label: next_label.or_else(|| label.clone()),
                    endpoint: next_endpoint.or_else(|| endpoint.clone()),
                },
                other => other,
            };
            // A credential retired while the refresh was in flight (the
            // user signed in again) is not written back.
            if !super::configuration::keep_credential(id, || write(id, &fresh))? {
                return Err("OAUTH_REAUTH_REQUIRED".into());
            }
            fresh
        }
        _ => credential,
    };
    Ok(Resolved {
        bearer: credential.bearer().to_owned(),
        account_id: credential.account_id().map(str::to_owned),
    })
}

#[cfg(test)]
pub(crate) static TEST_STORE: Mutex<()> = Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_from_earlier_releases_read_as_api_keys_and_oauth_round_trips() {
        assert_eq!(
            Credential::parse(b"sk-legacy-key").unwrap(),
            Credential::ApiKey {
                key: "sk-legacy-key".into()
            }
        );
        // A key that happens to start with `{` but is no envelope stays a key.
        assert_eq!(
            Credential::parse(b"{not-json-key").unwrap().bearer(),
            "{not-json-key"
        );
        let oauth = Credential::Oauth {
            access: "access-token".into(),
            refresh: "refresh-token".into(),
            expires: 10,
            account_id: Some("acct".into()),
            label: Some("me@example.test".into()),
            endpoint: None,
        };
        let bytes = oauth.encode().unwrap();
        assert_eq!(Credential::parse(&bytes).unwrap(), oauth);
        // A pasted key is stored exactly as typed, as before.
        assert_eq!(
            Credential::ApiKey { key: "k".repeat(9) }.encode().unwrap(),
            b"kkkkkkkkk"
        );
    }

    #[test]
    fn credentials_never_print_their_secrets() {
        let oauth = Credential::Oauth {
            access: "secret-access".into(),
            refresh: "secret-refresh".into(),
            expires: 1,
            account_id: None,
            label: None,
            endpoint: None,
        };
        let key = Credential::ApiKey {
            key: "sk-secret-value".into(),
        };
        for printed in [format!("{oauth:?}"), format!("{key:?}")] {
            assert!(!printed.contains("secret"), "{printed}");
        }
    }

    #[test]
    fn access_tokens_refresh_shortly_before_they_expire() {
        let token = |expires, refresh: &str| Credential::Oauth {
            access: "a".into(),
            refresh: refresh.into(),
            expires,
            account_id: None,
            label: None,
            endpoint: None,
        };
        let now = 1_000_000;
        assert!(token(now + REFRESH_MARGIN_MS - 1, "r").needs_refresh(now));
        assert!(!token(now + REFRESH_MARGIN_MS + 1, "r").needs_refresh(now));
        // No expiry or no refresh token: used until the provider rejects it.
        assert!(!token(0, "r").needs_refresh(now));
        assert!(!token(1, "").needs_refresh(now));
        assert!(!Credential::ApiKey { key: "k".into() }.needs_refresh(now));
    }

    #[test]
    fn the_store_round_trips_and_forgets_deleted_items() {
        let _guard = TEST_STORE.lock().unwrap_or_else(|e| e.into_inner());
        use_memory_store();
        let id = uuid::Uuid::new_v4().to_string();
        let key = Credential::ApiKey {
            key: "private-test-key".into(),
        };
        write(&id, &key).unwrap();
        assert_eq!(read(&id).unwrap(), key);
        delete(&id);
        assert!(read(&id).is_err());
        assert!(validate_key("short").is_err());
        assert!(validate_key("line\nbreak-key").is_err());
        assert!(validate_key("!echo-not-executed").is_ok());
    }
}
