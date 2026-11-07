//! `protocols/acp/acp-client.mjs`: a provider-neutral Agent Client
//! Protocol connection. The transport owns process framing and limits; this
//! owns ACP method negotiation, capabilities, callbacks and method-name
//! compatibility only.
use super::acp_methods::{
    ACP_PROTOCOL_VERSION, MethodOverrides, SESSION_UPDATE_ALIASES, acp_method_candidates,
    request_aliases,
};
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::agent_events::redact_secret_text;
use crate::agent::contract::js::{self, Obj};
use crate::agent::transports::jsonl_rpc_connection::{
    ConnectionEvent, RequestOptions, rpc_error_code,
};
use crate::agent::transports::rpc_connection::RpcConnection;
use futures_util::future::LocalBoxFuture;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use tokio::task::spawn_local;

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;

/// An async callback answering one native request.
pub type RequestHandler = Rc<dyn Fn(Value) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// `handleNotification(method, params)`.
pub type NotificationHandler = Rc<dyn Fn(&str, Value) -> AgentResult<()>>;

/// `canHandleRequest(method)`.
pub type MethodFilter = Rc<dyn Fn(&str) -> bool>;

/// `handleRequest(method, params)`.
pub type ExtensionHandler =
    Rc<dyn Fn(String, Value) -> LocalBoxFuture<'static, AgentResult<Value>>>;

/// `onSessionUpdate(params)`.
pub type SessionUpdateHandler = Rc<dyn Fn(Value) -> AgentResult<()>>;

/// `delegate`: the client's callbacks.
#[derive(Clone, Default)]
pub struct AcpDelegate {
    pub read_text_file: Option<RequestHandler>,
    pub write_text_file: Option<RequestHandler>,
    pub request_permission: Option<RequestHandler>,
    /// `onSessionUpdate(params)`, run in arrival order.
    pub on_session_update: Option<SessionUpdateHandler>,
    /// `handleNotification(method, params)`.
    pub handle_notification: Option<NotificationHandler>,
    /// `canHandleRequest(method)`.
    pub can_handle_request: Option<MethodFilter>,
    /// `handleRequest(method, params)`.
    pub handle_request: Option<ExtensionHandler>,
}

struct Inner {
    connection: Rc<dyn RpcConnection>,
    client_info: Value,
    delegate: AcpDelegate,
    method_overrides: MethodOverrides,
    method_cache: RefCell<HashMap<String, String>>,
    agent_info: RefCell<Option<Value>>,
    agent_capabilities: RefCell<Option<Value>>,
    protocol_version: Cell<Option<i64>>,
    auth_methods: RefCell<Vec<Value>>,
    disposed: Cell<bool>,
    listener: Cell<Option<u64>>,
}

/// `new AcpClient({ connection, clientInfo, delegate, methodOverrides })`.
#[derive(Clone)]
pub struct AcpClient(Rc<Inner>);

impl AcpClient {
    pub fn new(
        connection: Rc<dyn RpcConnection>,
        client_info: Option<Value>,
        delegate: AcpDelegate,
        method_overrides: MethodOverrides,
    ) -> Self {
        let client = Self(Rc::new(Inner {
            connection: connection.clone(),
            client_info: client_info
                .unwrap_or_else(|| json!({ "name": "puppyone-desktop", "version": "0.0.0" })),
            delegate,
            method_overrides,
            method_cache: RefCell::default(),
            agent_info: RefCell::default(),
            agent_capabilities: RefCell::default(),
            protocol_version: Cell::new(None),
            auth_methods: RefCell::default(),
            disposed: Cell::new(false),
            listener: Cell::new(None),
        }));
        let weak = Rc::downgrade(&client.0);
        let id = connection.on(Rc::new(move |event| {
            let Some(inner) = weak.upgrade() else { return };
            match event {
                ConnectionEvent::Notification(message) => {
                    if let Err(error) = handle_notification(&inner, &message) {
                        handle_callback_failure(&inner, &error);
                    }
                }
                ConnectionEvent::Request(message) => handle_request(Rc::downgrade(&inner), message),
                _ => {}
            }
        }));
        client.0.listener.set(Some(id));
        client
    }

    /// `client.agentInfo`.
    pub fn agent_info(&self) -> Option<Value> {
        self.0.agent_info.borrow().clone()
    }

    /// `client.agentCapabilities`.
    pub fn agent_capabilities(&self) -> Option<Value> {
        self.0.agent_capabilities.borrow().clone()
    }

    /// `client.protocolVersion`.
    pub fn protocol_version(&self) -> Option<i64> {
        self.0.protocol_version.get()
    }

    /// `client.authMethods`.
    pub fn auth_methods(&self) -> Vec<Value> {
        self.0.auth_methods.borrow().clone()
    }

    /// `client.initialize(options)`.
    pub async fn initialize(
        &self,
        client_capabilities: Option<Value>,
        client_info: Option<Value>,
    ) -> AgentResult<Value> {
        let delegate = &self.0.delegate;
        let base = client_capabilities.unwrap_or_else(|| json!({}));
        let mut capabilities = Obj::from(&base);
        if delegate.read_text_file.is_some() || delegate.write_text_file.is_some() {
            let fs = Obj::from(base.get("fs").unwrap_or(&Value::Null))
                .opt(
                    "readTextFile",
                    delegate.read_text_file.is_some().then_some(true),
                )
                .opt(
                    "writeTextFile",
                    delegate.write_text_file.is_some().then_some(true),
                )
                .build();
            capabilities.insert("fs", fs);
        }
        let capabilities = capabilities.build();
        let has_capabilities = capabilities.as_object().is_some_and(|c| !c.is_empty());
        let response = self
            .request(
                "initialize",
                Obj::new()
                    .set("protocolVersion", ACP_PROTOCOL_VERSION)
                    .set(
                        "clientInfo",
                        client_info.unwrap_or_else(|| self.0.client_info.clone()),
                    )
                    .opt(
                        "clientCapabilities",
                        has_capabilities.then_some(capabilities),
                    )
                    .build(),
                None,
            )
            .await?;
        let record = |key: &str| response.get(key).filter(|v| v.is_object()).cloned();
        *self.0.agent_info.borrow_mut() = record("agentInfo");
        *self.0.agent_capabilities.borrow_mut() = record("agentCapabilities");
        self.0.protocol_version.set(Some(
            response
                .get("protocolVersion")
                .and_then(js::safe_integer)
                .unwrap_or(ACP_PROTOCOL_VERSION),
        ));
        *self.0.auth_methods.borrow_mut() = response
            .get("authMethods")
            .and_then(Value::as_array)
            .map(|methods| methods.iter().take(32).cloned().collect())
            .unwrap_or_default();
        Ok(response)
    }

    pub async fn authenticate(&self, params: Value) -> AgentResult<Value> {
        self.request("authenticate", params, None).await
    }

    /// `client.requestExtension(method, params, { timeoutMs })`.
    pub async fn request_extension(
        &self,
        method: &str,
        params: Value,
        timeout_ms: Option<u64>,
    ) -> AgentResult<Value> {
        if self.0.disposed.get() {
            return Err(AgentError::new("ACP client is closed."));
        }
        if method.trim().is_empty() {
            return Err(AgentError::new("ACP extension method is required.").with_name("TypeError"));
        }
        self.0
            .connection
            .request(
                method,
                params,
                RequestOptions {
                    timeout_ms: Some(timeout_ms.unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS)),
                    ..Default::default()
                },
            )
            .await
    }

    pub async fn new_session(&self, params: Value) -> AgentResult<Value> {
        self.request("newSession", params, None).await
    }
    pub async fn load_session(&self, params: Value) -> AgentResult<Value> {
        self.request("loadSession", params, None).await
    }
    pub async fn resume_session(&self, params: Value) -> AgentResult<Value> {
        self.request("resumeSession", params, None).await
    }
    pub async fn list_sessions(&self, params: Value) -> AgentResult<Value> {
        self.request("listSessions", params, None).await
    }
    pub async fn fork_session(&self, params: Value) -> AgentResult<Value> {
        self.request("forkSession", params, None).await
    }
    pub async fn delete_session(&self, params: Value) -> AgentResult<Value> {
        self.request("deleteSession", params, None).await
    }
    pub async fn set_model(&self, params: Value) -> AgentResult<Value> {
        self.request("setModel", params, None).await
    }
    pub async fn set_mode(&self, params: Value) -> AgentResult<Value> {
        self.request("setMode", params, None).await
    }
    pub async fn set_config_option(&self, params: Value) -> AgentResult<Value> {
        self.request("setConfigOption", params, None).await
    }

    /// `client.prompt(params)`: a prompt is a long-running turn. Progress
    /// arrives through session/update, so an arbitrary request timeout would
    /// turn a healthy long task into an ambiguous mutation and could cause an
    /// unsafe duplicate retry.
    pub async fn prompt(&self, params: Value) -> AgentResult<Value> {
        self.request("prompt", params, Some(0)).await
    }

    /// `client.cancel(params)`.
    pub fn cancel(&self, params: Value) {
        let cached = self.0.method_cache.borrow().get("cancel").cloned();
        let candidates = match cached {
            Some(method) => vec![method],
            None => acp_method_candidates("cancel", &self.0.method_overrides).unwrap_or_default(),
        };
        let mut sent: Vec<String> = Vec::new();
        for method in candidates {
            if sent.contains(&method) {
                continue;
            }
            let _ = self.0.connection.notify(&method, Some(params.clone()));
            sent.push(method);
        }
    }

    /// `client.dispose()`.
    pub fn dispose(&self) {
        if self.0.disposed.replace(true) {
            return;
        }
        if let Some(id) = self.0.listener.take() {
            self.0.connection.off(id);
        }
    }

    async fn request(
        &self,
        logical_method: &str,
        params: Value,
        timeout_ms: Option<u64>,
    ) -> AgentResult<Value> {
        if self.0.disposed.get() {
            return Err(AgentError::new("ACP client is closed."));
        }
        let options = || RequestOptions {
            timeout_ms: Some(timeout_ms.unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS)),
            ..Default::default()
        };
        let cached = self.0.method_cache.borrow().get(logical_method).cloned();
        if let Some(method) = cached {
            return self.0.connection.request(&method, params, options()).await;
        }
        let mut last_method_not_found: Option<AgentError> = None;
        for method in acp_method_candidates(logical_method, &self.0.method_overrides)? {
            match self
                .0
                .connection
                .request(&method, params.clone(), options())
                .await
            {
                Ok(result) => {
                    self.0
                        .method_cache
                        .borrow_mut()
                        .insert(logical_method.to_string(), method);
                    return Ok(result);
                }
                Err(error) if rpc_error_code(&error) == Some(-32601) => {
                    last_method_not_found = Some(error)
                }
                Err(error) => return Err(error),
            }
        }
        Err(last_method_not_found.unwrap_or_else(|| {
            AgentError::new(format!("No ACP method is configured for {logical_method}."))
        }))
    }
}

fn handle_notification(inner: &Inner, message: &Value) -> AgentResult<()> {
    if inner.disposed.get() {
        return Ok(());
    }
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    if SESSION_UPDATE_ALIASES.contains(&method) {
        if let Some(on_session_update) = inner.delegate.on_session_update.as_ref() {
            on_session_update(params)?;
        }
        return Ok(());
    }
    if let Some(handle) = inner.delegate.handle_notification.as_ref() {
        handle(method, params)?;
    }
    Ok(())
}

fn server_request_handler(inner: &Inner, method: &str) -> Option<RequestHandler> {
    let delegate = &inner.delegate;
    if request_aliases::REQUEST_PERMISSION.contains(&method)
        && let Some(handler) = delegate.request_permission.clone()
    {
        return Some(handler);
    }
    if request_aliases::READ_TEXT_FILE.contains(&method)
        && let Some(handler) = delegate.read_text_file.clone()
    {
        return Some(handler);
    }
    if request_aliases::WRITE_TEXT_FILE.contains(&method)
        && let Some(handler) = delegate.write_text_file.clone()
    {
        return Some(handler);
    }
    if let Some(handle) = delegate.handle_request.clone()
        && delegate
            .can_handle_request
            .as_ref()
            .is_none_or(|can| can(method))
    {
        let method = method.to_string();
        return Some(Rc::new(move |params| handle(method.clone(), params)));
    }
    None
}

fn handle_request(weak: Weak<Inner>, message: Value) {
    let Some(inner) = weak.upgrade() else { return };
    if inner.disposed.get() {
        return;
    }
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let Some(handler) = server_request_handler(&inner, &method) else {
        if let Err(error) =
            inner
                .connection
                .respond_error(id, -32601, "ACP client method is not supported.")
        {
            handle_callback_failure(&inner, &error);
        }
        return;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let connection = inner.connection.clone();
    drop(inner);
    spawn_local(async move {
        let outcome = match handler(params).await {
            Ok(result) => connection.respond(id, result),
            Err(error) => connection.respond_error(id, -32603, &redact_secret_text(&error.message)),
        };
        if let Err(error) = outcome
            && let Some(inner) = weak.upgrade()
        {
            handle_callback_failure(&inner, &error);
        }
    });
}

fn handle_callback_failure(inner: &Inner, error: &AgentError) {
    let message = redact_secret_text(&error.message);
    inner
        .connection
        .dispose(&format!("ACP client callback failed: {message}"), false);
}
