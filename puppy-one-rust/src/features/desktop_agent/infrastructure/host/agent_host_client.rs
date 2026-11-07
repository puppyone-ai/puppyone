//! The window's Agent client (`getElectronAgentClient` without the
//! preload): typed requests to the [`AgentHostHandle`], whose answers and
//! session frames come back on the window's executor.
use crate::agent::agent_error::AgentError;
use crate::agent::contract::dto::SessionFrame;
use crate::agent::contract::protocol::StageFile;
use crate::agent::contract::protocol::{AgentEvent, AgentOperation, AgentRequest};
use crate::agent::host::agent_host::AgentHostHandle;
use crate::features::desktop_agent::application::agent_client_port::{
    AgentClientPort, Cleanup, ClientFuture,
};
use crate::features::desktop_agent::application::agent_error::agent_operation_error;
use crate::features::desktop_agent::application::ui_runtime::UiRuntime;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// `MAX_INLINE_ATTACHMENT_BYTES`.
const MAX_INLINE_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

type Listener = Rc<dyn Fn(SessionFrame)>;

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
    /// Opens `window`'s event channel on the host and delivers its frames
    /// on `runtime` (the window's executor).
    pub fn connect(handle: AgentHostHandle, window: u64, runtime: &Rc<dyn UiRuntime>) -> Rc<Self> {
        let (sender, mut events) = tokio::sync::mpsc::unbounded_channel::<AgentEvent>();
        handle.open_window(
            window,
            Box::new(move |event| {
                let _ = sender.send(event);
            }),
        );
        let frame_listeners: Rc<RefCell<Vec<(u64, Listener)>>> = Rc::default();
        let listeners = Rc::downgrade(&frame_listeners);
        runtime.spawn(Box::pin(async move {
            while let Some(event) = events.recv().await {
                let Some(listeners) = listeners.upgrade() else {
                    return;
                };
                let AgentEvent::SessionFrame(frame) = event;
                let current: Vec<Listener> =
                    listeners.borrow().iter().map(|(_, l)| l.clone()).collect();
                for listener in current {
                    listener(frame.clone());
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

    fn send(&self, request: AgentRequest) -> ClientFuture {
        let reply = self.handle.request(self.window, request);
        Box::pin(async move { reply.await.map_err(agent_operation_error) })
    }

    /// `stageAgentAttachments(request)`: native paths are captured before
    /// any byte read; a file without one is sent inline within the in-flight
    /// budget.
    fn stage(&self, request: crate::agent::contract::protocol::StageReferences) -> ClientFuture {
        let files = &request.files;
        if files.is_empty() || files.len() > 32 {
            return rejected("Select between 1 and 32 attachment files.");
        }
        if files.iter().all(|file| file.native_path().is_some()) {
            return self.send(AgentRequest::StageReferences(request));
        }
        let inline_files = || files.iter().filter(|file| file.native_path().is_none());
        let mut inline = 0u64;
        for file in inline_files() {
            let size = Some(file.size).filter(|size| size.fract() == 0. && *size > 0.);
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
        if inline_files().any(|file: &StageFile| {
            file.bytes.as_ref().map_or(0, |bytes| bytes.len()) as f64 != file.size
        }) {
            return rejected("The selected attachment changed while it was being read.");
        }
        self.pending_inline_bytes
            .fetch_add(inline, Ordering::SeqCst);
        let call = self.send(AgentRequest::StageReferences(request));
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

impl AgentClientPort for AgentHostClient {
    fn supports(&self, operation: AgentOperation) -> bool {
        AgentOperation::MAIN.contains(&operation)
    }

    fn delivers_frames(&self) -> bool {
        true
    }

    fn request(&self, request: AgentRequest) -> ClientFuture {
        match request {
            AgentRequest::StageReferences(stage) => self.stage(stage),
            AgentRequest::ManageExecutions | AgentRequest::TerminateExecution => {
                rejected("The Agent host does not manage this window's executions.")
            }
            request => self.send(request),
        }
    }

    fn on_agent_session_frame(&self, listener: Rc<dyn Fn(SessionFrame)>) -> Option<Cleanup> {
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
