//! `application/AgentClientPort.ts`: the Renderer-side port the window
//! bridge implements. Methods keep the product's names
//! (`"attachAgentSession"`, …); optional ones are named by
//! [`AgentClientPort::implements`].
use crate::agent::agent_error::AgentResult;
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::rc::Rc;

/// One port operation (`Promise<…>`).
pub type ClientFuture = LocalBoxFuture<'static, AgentResult<Value>>;
/// An unsubscribe function.
pub type Cleanup = Box<dyn FnOnce()>;

/// The Agent client port.
pub trait AgentClientPort {
    /// Whether `method` exists (`typeof bridge.method === "function"`).
    fn implements(&self, method: &str) -> bool;
    /// `bridge[method](request)`.
    fn call(&self, method: &str, request: Value) -> ClientFuture;
    /// `bridge.onAgentSessionFrame?.(listener)`.
    fn on_agent_session_frame(&self, _listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        None
    }
    /// `bridge.onAgentSessionFailure?.(listener)`.
    fn on_agent_session_failure(&self, _listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        None
    }
}

/// `AgentClientProvider`.
pub type AgentClientProvider = Rc<dyn Fn() -> Option<Rc<dyn AgentClientPort>>>;

/// `bridge === other`.
pub fn same_client(a: &Rc<dyn AgentClientPort>, b: &Rc<dyn AgentClientPort>) -> bool {
    std::ptr::addr_eq(Rc::as_ptr(a), Rc::as_ptr(b))
}

/// `requireBridge(...methods)`: the bridge, when it implements every method.
pub fn require_bridge(
    provider: &AgentClientProvider,
    methods: &[&str],
) -> AgentResult<Rc<dyn AgentClientPort>> {
    match provider() {
        Some(bridge) if methods.iter().all(|method| bridge.implements(method)) => Ok(bridge),
        _ => Err(super::agent_error::agent_known_error(
            "native-bridge-unavailable",
            None,
        )),
    }
}

/// The bytes or native path behind a Renderer `File`.
#[derive(Clone, Debug, PartialEq)]
pub enum AgentFileSource {
    /// `webUtils.getPathForFile(file)`.
    Path(String),
    /// A clipboard/browser file without a native path.
    Bytes(Rc<Vec<u8>>),
}

/// A Renderer `File` (`name`, `type`, `size`).
#[derive(Clone, Debug, PartialEq)]
pub struct AgentFile {
    pub name: String,
    /// `file.type`.
    pub mime: String,
    pub size: f64,
    pub source: AgentFileSource,
}

impl AgentFile {
    /// The file as a port request value (`files: [file]`).
    pub fn to_value(&self) -> Value {
        let mut value =
            serde_json::json!({ "name": self.name, "type": self.mime, "size": self.size });
        match &self.source {
            AgentFileSource::Path(path) => value["path"] = Value::from(path.as_str()),
            AgentFileSource::Bytes(bytes) => {
                value["bytes"] = crate::agent::contract::js::uint8array(bytes)
            }
        }
        value
    }

    /// A local URL the view can load (`URL.createObjectURL(file)`).
    pub fn preview_url(&self) -> Option<String> {
        match &self.source {
            AgentFileSource::Path(path) => Some(path.clone()),
            AgentFileSource::Bytes(_) => None,
        }
    }
}
