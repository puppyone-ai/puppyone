//! The window's Agent client: the preload's `agent:*` bridge
//! (`electron/preload.cjs`) and `getElectronAgentClient`, over
//! [`AgentHostHandle`]. Requests run on the Agent host thread; its
//! window-bound frames come back through the window's frame sink.
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::contract::js;
use crate::agent::contract::operation_error::read_agent_operation_failure;
use crate::agent::host::agent_host::AgentHostHandle;
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, Cleanup, ClientFuture,
};
use crate::features::desktop_agent::application::agent_error::agent_operation_error;
use crate::features::desktop_agent::application::ui_runtime::UiRuntime;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// `MAX_INLINE_ATTACHMENT_BYTES`.
const MAX_INLINE_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

/// The port method's IPC channel and, for commands, its dispatch kind.
fn channel_for(method: &str) -> Option<(&'static str, Option<&'static str>)> {
    Some(match method {
        // `agent:providers-discover` is the stable IPC compatibility name. The
        // feature-facing port uses product-accurate runtime vocabulary.
        "discoverAgentRuntimes" | "discoverAgentProviders" => ("agent:providers-discover", None),
        "discoverLocalAgentConnections" => ("agent:local-connections-discover", None),
        "listAgentModels" => ("agent:models-list", None),
        "readAgentAccount" => ("agent:account-read", None),
        "createAgentSession" => ("agent:session-create", None),
        "resumeAgentSession" => ("agent:session-resume", None),
        "openAgentSession" => ("agent:session-open", None),
        "replayAgentSession" => ("agent:session-replay", None),
        "attachAgentSession" => ("agent:session-attach", None),
        "acknowledgeAgentSession" => ("agent:session-feed-ack", None),
        "readAgentSessionWatermark" => ("agent:session-feed-watermark", None),
        "detachAgentSession" => ("agent:session-detach", None),
        "listAgentSessions" => ("agent:sessions-list", None),
        "forkAgentSession" => ("agent:session-fork", None),
        "archiveAgentSession" => ("agent:session-archive", None),
        "deleteAgentSession" => ("agent:session-delete", None),
        "closeAgentSession" => ("agent:session-close", None),
        "stageAgentAttachments" => ("agent:reference-stage", None),
        "revokeAgentAttachments" => ("agent:reference-revoke", None),
        "resolveAgentWorkspaceReferences" => ("agent:reference-resolve-workspace", None),
        "pickAgentWorkspaceReferences" => ("agent:reference-pick-workspace", None),
        "startAgentTurn" => ("agent:command-dispatch", Some("start")),
        "steerAgentTurn" => ("agent:command-dispatch", Some("steer")),
        "interruptAgentTurn" => ("agent:command-dispatch", Some("interrupt")),
        "compactAgentSession" => ("agent:session-compact", None),
        "resolveAgentApproval" => ("agent:command-dispatch", Some("approval")),
        "resolveAgentQuestion" => ("agent:command-dispatch", Some("question")),
        _ => return None,
    })
}

type Listener = Rc<dyn Fn(Value)>;

/// One window's Agent client.
pub struct AgentHostClient {
    handle: AgentHostHandle,
    window: u64,
    frame_listeners: Rc<RefCell<Vec<(u64, Listener)>>>,
    next_listener: Cell<u64>,
    /// `pendingInlineAttachmentBytes`.
    pending_inline_bytes: Arc<AtomicU64>,
}

impl AgentHostClient {
    /// Opens `window`'s frame channel on the host and delivers its frames
    /// on `runtime` (the window's executor).
    pub fn connect(handle: AgentHostHandle, window: u64, runtime: &Rc<dyn UiRuntime>) -> Rc<Self> {
        let (sender, mut frames) = tokio::sync::mpsc::unbounded_channel::<(String, Value)>();
        handle.open_window(
            window,
            Box::new(move |channel, payload| {
                let _ = sender.send((channel.to_string(), payload));
            }),
        );
        let frame_listeners: Rc<RefCell<Vec<(u64, Listener)>>> = Rc::default();
        let listeners = Rc::downgrade(&frame_listeners);
        runtime.spawn(Box::pin(async move {
            while let Some((channel, payload)) = frames.recv().await {
                let Some(listeners) = listeners.upgrade() else {
                    return;
                };
                if channel != "agent:session-frame" {
                    continue;
                }
                let current: Vec<Listener> =
                    listeners.borrow().iter().map(|(_, l)| l.clone()).collect();
                for listener in current {
                    listener(payload.clone());
                }
            }
        }));
        Rc::new(Self {
            handle,
            window,
            frame_listeners,
            next_listener: Cell::new(0),
            pending_inline_bytes: Arc::default(),
        })
    }

    /// The window's id on the host.
    pub fn window(&self) -> u64 {
        self.window
    }

    fn invoke(&self, channel: &'static str, request: Value) -> ClientFuture {
        let reply = self.handle.invoke(self.window, channel, request);
        Box::pin(async move { unwrap_operation(reply.await) })
    }

    /// `stageAgentAttachments(request)`: native paths are captured before
    /// any byte read; a file without one is sent inline within the in-flight
    /// budget.
    fn stage(&self, request: Value) -> ClientFuture {
        let files = request["files"].as_array().cloned().unwrap_or_default();
        if files.is_empty() || files.len() > 32 {
            return rejected("Select between 1 and 32 attachment files.");
        }
        let mut context = json!({ "rootPath": request["rootPath"], "epoch": request["epoch"] });
        if let Some(project) = request.get("projectContext") {
            context["projectContext"] = project.clone();
        }
        let paths: Vec<Option<String>> = files
            .iter()
            .map(|file| {
                file["path"]
                    .as_str()
                    .filter(|p| !js::trim(p).is_empty())
                    .map(str::to_string)
            })
            .collect();
        if paths.iter().all(Option::is_some) {
            context["sourcePaths"] = json!(paths);
            return self.invoke("agent:reference-stage", context);
        }
        let mut inline = 0u64;
        for (file, path) in files.iter().zip(&paths) {
            if path.is_some() {
                continue;
            }
            let size = js::safe_integer(&file["size"]).filter(|size| *size > 0);
            let Some(size) = size else {
                return rejected("The selected attachment is empty or invalid.");
            };
            inline += size as u64;
        }
        let pending = self.pending_inline_bytes.load(Ordering::SeqCst);
        if inline > MAX_INLINE_ATTACHMENT_BYTES || pending + inline > MAX_INLINE_ATTACHMENT_BYTES {
            return rejected(
                "Attachments exceed the 25 MB in-flight safety limit. Try fewer files at a time.",
            );
        }
        self.pending_inline_bytes
            .fetch_add(inline, Ordering::SeqCst);
        let mut sources = Vec::new();
        for (file, path) in files.iter().zip(&paths) {
            if let Some(path) = path {
                sources.push(json!({ "path": path }));
                continue;
            }
            let bytes = js::as_uint8array(&file["bytes"]).unwrap_or_default();
            if js::safe_integer(&file["size"]) != Some(bytes.len() as i64) {
                self.pending_inline_bytes
                    .fetch_sub(inline, Ordering::SeqCst);
                return rejected("The selected attachment changed while it was being read.");
            }
            sources.push(json!({ "name": file["name"], "bytes": file["bytes"] }));
        }
        context["sources"] = Value::Array(sources);
        let call = self.invoke("agent:reference-stage", context);
        let pending = self.pending_inline_bytes.clone();
        Box::pin(async move {
            let result = call.await;
            pending.fetch_sub(inline, Ordering::SeqCst);
            result
        })
    }
}

fn rejected(message: &str) -> ClientFuture {
    let error = AgentError::new(message);
    Box::pin(async move { Err(error) })
}

/// The bridge wrapper: a structured failure envelope becomes an
/// `AgentOperationError`.
pub fn unwrap_operation(value: Value) -> AgentResult<Value> {
    match read_agent_operation_failure(&value)? {
        Some(failure) => Err(agent_operation_error(failure)),
        None => Ok(value),
    }
}

impl AgentClientPort for AgentHostClient {
    fn implements(&self, method: &str) -> bool {
        method == "onAgentSessionFrame" || channel_for(method).is_some()
    }

    fn call(&self, method: &str, request: Value) -> ClientFuture {
        let Some((channel, kind)) = channel_for(method) else {
            return rejected(&format!("bridge.{method} is not a function"));
        };
        if method == "stageAgentAttachments" {
            return self.stage(request);
        }
        let request = match kind {
            Some(kind) => {
                let mut request = if request.is_object() {
                    request
                } else {
                    json!({})
                };
                request["kind"] = Value::from(kind);
                request
            }
            None => request,
        };
        self.invoke(channel, request)
    }

    fn on_agent_session_frame(&self, listener: Rc<dyn Fn(Value)>) -> Option<Cleanup> {
        let id = self.next_listener.get() + 1;
        self.next_listener.set(id);
        self.frame_listeners.borrow_mut().push((id, listener));
        let listeners = Rc::downgrade(&self.frame_listeners);
        Some(Box::new(move || {
            if let Some(listeners) = listeners.upgrade() {
                listeners
                    .borrow_mut()
                    .retain(|(listener, _)| *listener != id);
            }
        }))
    }
}

impl Drop for AgentHostClient {
    fn drop(&mut self) {
        self.handle.close_window(self.window);
    }
}
