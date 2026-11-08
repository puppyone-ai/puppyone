//! Bounded, redirect-free transport. All diagnostics are fixed codes; never log bodies/URLs.
use super::{
    model::*,
    transport::{StreamEvent, StreamSink, refresh_error, response_error},
};
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
    /// `requestPublic`: a GET the service answers without an account.
    fn public(&self, _env: &Environment, _path: &str, _fence: &Fence) -> Result<Value> {
        Err(Error::Unsupported)
    }
    fn stream(
        &self,
        _session: &Session,
        _request: &ApiRequest,
        _fence: &Fence,
        _sink: &mut StreamSink<'_>,
    ) -> Result<()> {
        Err(Error::Unsupported)
    }
    /// `requestTemplateDownload`: the template store's download POST, as
    /// the account, at the store's fixed origin.
    fn template_download(
        &self,
        _session: &Session,
        _url: &url::Url,
        _body: &Value,
        _fence: &Fence,
    ) -> Result<Value> {
        Err(Error::Unsupported)
    }
    /// `openHostTunnelSocket`: the WebSocket of a folder's byte tunnel, the
    /// access token offered as a subprotocol the server never echoes.
    fn host_tunnel(
        &self,
        _session: &Session,
        _url: &url::Url,
        _fence: &Fence,
    ) -> Result<super::HostTunnel> {
        Err(Error::Unsupported)
    }
    /// `openAgentStream`: one managed inference POST, streamed back.
    fn completion(
        &self,
        _session: &Session,
        _body: &Value,
        _request_id: &str,
        _fence: &Fence,
        _sink: &mut StreamSink<'_>,
    ) -> Result<()> {
        Err(Error::Unsupported)
    }
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
        self.send_with_timeout(request, limit, fence, Duration::from_secs(15))
    }
    fn send_with_timeout(
        &self,
        request: reqwest::RequestBuilder,
        limit: usize,
        fence: &Fence,
        timeout: Duration,
    ) -> Result<Value> {
        self.send_mapped(request, limit, fence, timeout, response_error)
    }
    fn send_mapped(
        &self,
        request: reqwest::RequestBuilder,
        limit: usize,
        fence: &Fence,
        timeout: Duration,
        refused: fn(u16, &Value) -> Error,
    ) -> Result<Value> {
        runtime().block_on(async {
            let mut cancelled = fence.control.changes.subscribe();
            fence.check()?;
            let remaining = fence.deadline.map(|d| d.saturating_duration_since(Instant::now())).unwrap_or(timeout).min(timeout);
            let operation = async {
                let response = request.header("Cache-Control", "no-store").send().await.map_err(|_| Error::Unavailable)?;
                let status = response.status().as_u16();
                let request_id = response.headers().get("x-request-id").and_then(|v| v.to_str().ok()).map(str::to_owned);
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
                    return Err(match refused(status, &value) {
                        Error::Response(status, reason, _) => Error::Response(status, reason, crate::cloud::auth::model::Diagnostic::read(&value, request_id.as_deref())),
                        other => other,
                    });
                }
                if status != 204 && value.is_null() { return Err(Error::InvalidResponse); }
                Ok(value)
            };
            tokio::select! {
                _ = cancelled.changed() => Err(Error::SessionChanged),
                _ = async { if let Some(cancel) = &fence.cancel { cancel.cancelled().await; } else { std::future::pending::<()>().await; } } => Err(Error::Cancelled),
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
        let request = self.auth_request(env, path, body, token, fence)?;
        self.send(request, 64 * 1024, fence)
    }
    fn auth_request(
        &self,
        env: &Environment,
        path: &str,
        body: Option<Value>,
        token: Option<&Secret>,
        fence: &Fence,
    ) -> Result<reqwest::RequestBuilder> {
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
        Ok(request)
    }
    fn session(env: &Environment, mut value: Value) -> Result<Session> {
        // Move token strings into the redacted, zeroizing owner rather than copying them.
        let reply = serde_json::from_value::<AuthReply>(value.take())
            .map_err(|_| Error::InvalidResponse)?;
        Session::from_reply(env.clone(), reply)
    }
    /// A refresh's reply, completed from the credential it renewed.
    fn refreshed(credential: &Credential, mut value: Value) -> Result<Session> {
        let reply = serde_json::from_value::<AuthReply>(value.take())
            .map_err(|_| Error::InvalidResponse)?;
        Session::from_reply_or(credential.environment.clone(), reply, Some(credential))
    }
}
impl Remote for Http {
    fn public(&self, env: &Environment, path: &str, fence: &Fence) -> Result<Value> {
        let url = env.api_url(path, &[])?;
        let request = self.client(&url).get(url);
        self.send(request, 1024 * 1024, fence)
    }
    fn template_download(
        &self,
        session: &Session,
        url: &url::Url,
        body: &Value,
        fence: &Fence,
    ) -> Result<Value> {
        let request = self
            .client(url)
            .post(url.clone())
            .bearer_auth(&session.access.0)
            .json(body);
        // A refusal is the account's (401) or the store's; never its prose.
        fn refused(status: u16, _: &Value) -> Error {
            if status == 401 {
                Error::InvalidCredentials
            } else {
                Error::Http(status)
            }
        }
        self.send_mapped(request, 16 * 1024, fence, Duration::from_secs(20), refused)
    }
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
        let request = self.auth_request(
            &credential.environment,
            "/token?grant_type=refresh_token",
            Some(json!({"refresh_token": credential.refresh.0})),
            None,
            fence,
        )?;
        let value = self.send_mapped(
            request,
            64 * 1024,
            fence,
            Duration::from_secs(15),
            refresh_error,
        )?;
        Self::refreshed(credential, value)
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
            .bearer_auth(&session.access.0)
            .header("X-PuppyOne-Repository-Contract", "2")
            .timeout(request.timeout());
        if let Some(body) = &request.body {
            http = http.json(body);
        }
        if let Some(key) = request.idempotency_key.as_deref() {
            // The product's keys include `desktop:<scope>:<uuid>`; the server
            // takes any non-blank key of at most 255 characters.
            if !idempotency_key_is_valid(key) {
                return Err(Error::Unsupported);
            }
            http = http.header("Idempotency-Key", key);
        }
        self.send_with_timeout(http, 12 * 1024 * 1024, fence, request.timeout())
    }
    fn host_tunnel(
        &self,
        session: &Session,
        url: &url::Url,
        fence: &Fence,
    ) -> Result<super::HostTunnel> {
        use tokio_tungstenite::tungstenite::{
            Error as Socket, client::IntoClientRequest, http::HeaderValue,
        };
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|_| Error::Configuration)?;
        let protocols =
            HeaderValue::from_str(&format!("version.v1, version.bearer.{}", session.access.0))
                .map_err(|_| Error::InvalidCredentials)?;
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", protocols);
        runtime().block_on(async {
            fence.check()?;
            let connected = tokio::time::timeout(
                Duration::from_secs(20),
                tokio_tungstenite::connect_async(request),
            )
            .await
            .map_err(|_| Error::Unavailable)?;
            fence.check()?;
            match connected {
                Ok((socket, _)) => Ok(socket),
                Err(Socket::Http(response)) => {
                    let body = response
                        .body()
                        .as_deref()
                        .and_then(|b| serde_json::from_slice(b).ok())
                        .unwrap_or(Value::Null);
                    Err(response_error(response.status().as_u16(), &body))
                }
                Err(_) => Err(Error::Unavailable),
            }
        })
    }
    fn completion(
        &self,
        session: &Session,
        body: &Value,
        request_id: &str,
        fence: &Fence,
        sink: &mut StreamSink<'_>,
    ) -> Result<()> {
        let url = session
            .credential
            .environment
            .api_url("/ai/chat/completions", &[])?;
        let http = self
            .client(&url)
            .post(url)
            .bearer_auth(&session.access.0)
            .header("Idempotency-Key", request_id)
            .header("X-Request-Id", request_id)
            .json(body)
            .timeout(Duration::from_secs(210));
        runtime().block_on(async {
            let mut changed = fence.control.changes.subscribe(); fence.check()?;
            let operation = async {
                let response = tokio::time::timeout(Duration::from_secs(30), http.send()).await.map_err(|_| Error::OutcomeUnknown)?.map_err(|_| Error::Unavailable)?;
                let status = response.status().as_u16();
                if status != 200 { return Err(response_error(status, &Value::Null)); }
                fence.check()?; sink(StreamEvent::Connected)?;
                let mut body = response.bytes_stream();
                while let Some(part) = tokio::time::timeout(Duration::from_secs(120), body.next()).await.map_err(|_| Error::OutcomeUnknown)? {
                    let part = part.map_err(|_| Error::OutcomeUnknown)?;
                    fence.check()?; sink(StreamEvent::Data(&part))?;
                }
                Ok(())
            };
            tokio::select! {
                _ = changed.changed() => Err(Error::SessionChanged),
                _ = async { if let Some(cancel) = &fence.cancel { cancel.cancelled().await; } else { std::future::pending::<()>().await; } } => Err(Error::Cancelled),
                result = operation => result,
            }
        })
    }
    fn stream(
        &self,
        session: &Session,
        request: &ApiRequest,
        fence: &Fence,
        sink: &mut StreamSink<'_>,
    ) -> Result<()> {
        let url = session
            .credential
            .environment
            .api_url(&request.path, &request.query)?;
        // Reconnect with fresh credentials before expiry. This GET cannot wake
        // compute, and dropping the operation releases the response/socket.
        let lifetime = session
            .until
            .saturating_duration_since(Instant::now())
            .saturating_sub(Duration::from_secs(60))
            .clamp(Duration::from_secs(1), Duration::from_secs(3600));
        let http = self
            .client(&url)
            .get(url)
            .bearer_auth(&session.access.0)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-store")
            .timeout(lifetime + Duration::from_secs(1));
        runtime().block_on(async {
            let mut changed = fence.control.changes.subscribe(); fence.check()?;
            let operation = async {
                let response = tokio::time::timeout(Duration::from_secs(15), http.send()).await.map_err(|_| Error::Unavailable)?.map_err(|_| Error::Unavailable)?;
                let status = response.status().as_u16();
                if status != 200 { return Err(response_error(status, &Value::Null)); }
                if !response.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(';').next().unwrap_or_default().trim().eq_ignore_ascii_case("text/event-stream")) { return Err(Error::InvalidResponse); }
                fence.check()?; sink(StreamEvent::Connected)?;
                let mut body = response.bytes_stream();
                // The events route sends a keepalive every 10 s, so 30 s
                // without a byte is a dead connection, never a quiet one.
                loop {
                    let part = tokio::time::timeout(Duration::from_secs(30), body.next()).await.map_err(|_| Error::Unavailable)?.ok_or(Error::Unavailable)?.map_err(|_| Error::Unavailable)?;
                    fence.check()?; sink(StreamEvent::Data(&part))?;
                }
            };
            tokio::select! {
                _ = changed.changed() => Err(Error::SessionChanged),
                _ = async { if let Some(cancel) = &fence.cancel { cancel.cancelled().await; } else { std::future::pending::<()>().await; } } => Err(Error::Cancelled),
                result = tokio::time::timeout(lifetime, operation) => result.unwrap_or(Err(Error::Expired)),
            }
        })
    }
}

/// A key the product would send and the server accepts: visible ASCII,
/// non-blank, at most 255 characters (`billing/router.py` `_idempotency_key`).
pub(crate) fn idempotency_key_is_valid(key: &str) -> bool {
    !key.is_empty() && key.len() <= 255 && key.bytes().all(|b| b.is_ascii_graphic())
}
