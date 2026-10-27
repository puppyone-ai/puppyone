//! Bounded, redirect-free transport. All diagnostics are fixed codes; never log bodies/URLs.
use super::model::*;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

pub(super) trait Remote: Send + Sync {
    fn providers(&self, env: &Environment, fence: &Fence) -> Result<()>;
    fn exchange(
        &self,
        env: &Environment,
        code: &Secret,
        verifier: &Secret,
        fence: &Fence,
    ) -> Result<Session>;
    fn refresh(&self, credential: &Credential, fence: &Fence) -> Result<Session>;
    fn logout(
        &self,
        credential: &Credential,
        session: Option<&Session>,
        fence: &Fence,
    ) -> Result<()>;
    fn initialize(&self, session: &Session, fence: &Fence) -> Result<()>;
    fn request(&self, session: &Session, request: &ApiRequest, fence: &Fence) -> Result<Value>;
}
#[derive(Clone)]
struct Config {
    origin: String,
    key: String,
}
pub(super) struct Http {
    client: reqwest::Client,
    loopback: reqwest::Client,
    configs: Mutex<Vec<(Environment, Config)>>,
}
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("auth HTTP runtime")
    })
}
impl Http {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder()
                .redirect_policy(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .build()
                .map_err(|_| Error::Unavailable)?,
            loopback: reqwest::Client::builder()
                .no_proxy()
                .redirect_policy(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(15))
                .build()
                .map_err(|_| Error::Unavailable)?,
            configs: Mutex::new(Vec::new()),
        })
    }
    fn client(&self, url: &url::Url) -> &reqwest::Client {
        // A configured proxy must never receive local-development credentials.
        if matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) {
            &self.loopback
        } else {
            &self.client
        }
    }
    fn send(&self, request: reqwest::RequestBuilder, limit: usize, fence: &Fence) -> Result<Value> {
        runtime().block_on(async {
            let mut cancelled = fence.control.changes.subscribe();
            fence.check()?;
            let remaining = fence.deadline.map(|d| d.saturating_duration_since(Instant::now())).unwrap_or(Duration::from_secs(15)).min(Duration::from_secs(15));
            let operation = async {
                let response = request.header("Cache-Control", "no-store").send().await.map_err(|_| Error::Unavailable)?;
                let status = response.status().as_u16();
                if response.content_length().is_some_and(|n| n > limit as u64) { return Err(Error::InvalidResponse); }
                let mut body = zeroize::Zeroizing::new(Vec::new());
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk.map_err(|_| Error::Unavailable)?;
                    if body.len().saturating_add(chunk.len()) > limit { return Err(Error::InvalidResponse); }
                    body.extend_from_slice(&chunk);
                }
                fence.check()?;
                let value: Value = if status == 204 { Value::Null } else { serde_json::from_slice(&body).unwrap_or(Value::Null) };
                if !(200..300).contains(&status) {
                    let code = value.get("error_code").and_then(Value::as_str).unwrap_or_default();
                    return Err(if status == 401 || (status == 400 && matches!(code, "refresh_token_not_found" | "refresh_token_already_used" | "invalid_grant" | "session_not_found")) { Error::InvalidCredentials }
                        else if status >= 500 || status == 429 { Error::Unavailable } else { Error::Http(status) });
                }
                if status != 204 && value.is_null() { return Err(Error::InvalidResponse); }
                Ok(value)
            };
            tokio::select! {
                _ = cancelled.changed() => Err(Error::SessionChanged),
                result = tokio::time::timeout(remaining, operation) => result.unwrap_or_else(|_| Err(fence.check().err().unwrap_or(Error::Unavailable))),
            }
        })
    }
    fn configuration(&self, env: &Environment, fence: &Fence) -> Result<Config> {
        fence.check()?;
        if let Some((_, c)) = self.configs.lock().unwrap().iter().find(|(e, _)| e == env) {
            return Ok(c.clone());
        }
        let config_url = env.api_url("/auth/config", &[])?;
        let value = self.send(self.client(&config_url).get(config_url), 64 * 1024, fence)?;
        let url = endpoint(
            value["supabase_url"]
                .as_str()
                .ok_or(Error::InvalidResponse)?,
            false,
        )?;
        if url.path() != "/" {
            return Err(Error::InvalidResponse);
        }
        let key = value["supabase_anon_key"]
            .as_str()
            .ok_or(Error::InvalidResponse)?;
        let anon = key
            .split('.')
            .nth(1)
            .and_then(|v| URL_SAFE_NO_PAD.decode(v).ok())
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .is_some_and(|v| v["role"] == "anon");
        if key.len() > 8192 || !(key.starts_with("sb_publishable_") || anon) {
            return Err(Error::InvalidResponse);
        }
        let config = Config {
            origin: url.origin().ascii_serialization(),
            key: key.into(),
        };
        let mut cache = self.configs.lock().unwrap();
        if cache.len() >= 4 {
            cache.clear();
        }
        cache.push((env.clone(), config.clone()));
        Ok(config)
    }
    fn auth(
        &self,
        env: &Environment,
        path: &str,
        body: Option<Value>,
        token: Option<&Secret>,
        fence: &Fence,
    ) -> Result<Value> {
        let config = self.configuration(env, fence)?;
        let method = if body.is_some() || token.is_some() {
            reqwest::Method::POST
        } else {
            reqwest::Method::GET
        };
        let url = url::Url::parse(&format!("{}/auth/v1{path}", config.origin))
            .map_err(|_| Error::Configuration)?;
        let mut request = self
            .client(&url)
            .request(method, url)
            .header("apikey", config.key);
        if let Some(body) = body {
            request = request.json(&body);
        }
        if let Some(token) = token {
            request = request.bearer_auth(&token.0);
        }
        self.send(request, 64 * 1024, fence)
    }
    fn session(env: &Environment, mut value: Value) -> Result<Session> {
        // Move token strings into the redacted, zeroizing owner rather than copying them.
        let reply = serde_json::from_value::<AuthReply>(value.take())
            .map_err(|_| Error::InvalidResponse)?;
        Session::from_reply(env.clone(), reply)
    }
}
impl Remote for Http {
    fn providers(&self, env: &Environment, fence: &Fence) -> Result<()> {
        let value = self.auth(env, "/settings", None, None, fence)?;
        if ["email", "google", "github"]
            .iter()
            .any(|k| value["external"][k] == true)
        {
            Ok(())
        } else {
            Err(Error::NoProviders)
        }
    }
    fn exchange(
        &self,
        env: &Environment,
        code: &Secret,
        verifier: &Secret,
        fence: &Fence,
    ) -> Result<Session> {
        Self::session(
            env,
            self.auth(
                env,
                "/token?grant_type=pkce",
                Some(json!({"auth_code": code.0, "code_verifier": verifier.0})),
                None,
                fence,
            )?,
        )
    }
    fn refresh(&self, credential: &Credential, fence: &Fence) -> Result<Session> {
        Self::session(
            &credential.environment,
            self.auth(
                &credential.environment,
                "/token?grant_type=refresh_token",
                Some(json!({"refresh_token": credential.refresh.0})),
                None,
                fence,
            )?,
        )
    }
    fn logout(
        &self,
        credential: &Credential,
        session: Option<&Session>,
        fence: &Fence,
    ) -> Result<()> {
        let refreshed;
        let session = if let Some(session) = session.filter(|s| s.fresh()) {
            session
        } else {
            refreshed = match self.refresh(credential, fence) {
                Ok(value) => value,
                Err(Error::InvalidCredentials) => return Ok(()),
                Err(error) => return Err(error),
            };
            &refreshed
        };
        self.auth(
            &credential.environment,
            "/logout?scope=local",
            None,
            Some(&session.access),
            fence,
        )
        .map(|_| ())
    }
    fn initialize(&self, session: &Session, fence: &Fence) -> Result<()> {
        let url = session
            .credential
            .environment
            .api_url("/auth/initialize", &[])?;
        self.send(
            self.client(&url).post(url).bearer_auth(&session.access.0),
            64 * 1024,
            fence,
        )
        .map(|_| ())
    }
    fn request(&self, session: &Session, request: &ApiRequest, fence: &Fence) -> Result<Value> {
        let url = session
            .credential
            .environment
            .api_url(&request.path, &request.query)?;
        let mut http = self
            .client(&url)
            .request(request.method.clone(), url)
            .bearer_auth(&session.access.0);
        if let Some(body) = &request.body {
            http = http.json(body);
        }
        self.send(http, 12 * 1024 * 1024, fence)
    }
}
