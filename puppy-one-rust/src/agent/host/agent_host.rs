//! The Agent host: the Main-process half of the product's Agent
//! composition (`electron/main.mjs`) on its own thread, with the
//! `ipcMain.handle` bridge and per-window frame delivery the preload
//! exposes. Every Agent object lives on this thread's single-threaded
//! runtime; windows talk to it only through [`AgentHostHandle`].
use crate::agent::agent_error::{AgentError, AgentResult};
use crate::agent::application::agent_service::{AgentService, AgentServiceOptions};
use crate::agent::application::processes::agent_process_supervisor::AgentProcessSupervisor;
use crate::agent::bootstrap::create_agent_runtime_host::{
    DefaultRuntimeHostOptions, create_default_agent_runtime_host,
};
use crate::agent::cache::ephemeral_agent_session_cache::EphemeralAgentSessionCache;
use crate::agent::connections::local_agent_inventory::{
    LocalAgentInventoryOptions, create_local_agent_inventory,
};
use crate::agent::infrastructure::attachments::agent_attachment_store::{
    AgentAttachmentStore, AttachmentStoreOptions,
};
use crate::agent::ipc::agent_ipc::{AgentIpcHandlers, AuthorizeWorkspaceRoot};
use crate::agent::persistence::agent_conversation_catalog::{
    AgentConversationCatalog, CatalogOptions,
};
use crate::agent::persistence::agent_session_repository::AgentSessionRepository;
use crate::agent::runtime::agent_operation_error::agent_operation_failure;
use crate::agent::sender::Sender;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

/// Delivers one window-bound frame (`webContents.send(channel, payload)`).
pub type FrameSink = Box<dyn Fn(&str, Value) + Send>;

/// The window roots the Agent bridge may authorize.
pub type WindowRoots = Arc<Mutex<HashMap<u64, HashSet<String>>>>;

/// What the host thread composes.
pub struct AgentHostServices {
    pub handlers: AgentIpcHandlers,
    pub service: AgentService,
    pub attachment_store: Option<AgentAttachmentStore>,
}

/// Builds the services on the host thread.
pub type ServicesFactory = Box<dyn FnOnce(WindowRoots) -> AgentResult<AgentHostServices> + Send>;

enum Command {
    Invoke {
        window: u64,
        channel: String,
        request: Value,
        reply: oneshot::Sender<Value>,
    },
    OpenWindow {
        window: u64,
        sink: FrameSink,
    },
    CloseWindow {
        window: u64,
    },
    Shutdown {
        reply: oneshot::Sender<()>,
    },
}

/// A window's handle on the Agent host (the preload's `ipcRenderer`).
#[derive(Clone)]
pub struct AgentHostHandle {
    commands: tokio::sync::mpsc::UnboundedSender<Command>,
    roots: WindowRoots,
}

/// The production composition's paths and identity.
#[derive(Clone, Debug, Default)]
pub struct AgentHostOptions {
    pub user_data_path: PathBuf,
    pub app_version: String,
    pub app_path: Option<String>,
    pub executable_path: Option<String>,
}

impl AgentHostHandle {
    /// Starts the host thread with `factory`'s services.
    pub fn start(factory: ServicesFactory) -> AgentResult<Self> {
        let (commands, mut queue) = tokio::sync::mpsc::unbounded_channel::<Command>();
        let roots: WindowRoots = Arc::default();
        let thread_roots = roots.clone();
        let (ready, started) = std::sync::mpsc::channel::<AgentResult<()>>();
        std::thread::Builder::new()
            .name("puppyone-agent-host".into())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = ready.send(Err(AgentError::new(error.to_string())));
                        return;
                    }
                };
                let local = tokio::task::LocalSet::new();
                local.block_on(&runtime, async move {
                    let services = match factory(thread_roots) {
                        Ok(services) => Rc::new(services),
                        Err(error) => {
                            let _ = ready.send(Err(error));
                            return;
                        }
                    };
                    let _ = ready.send(Ok(()));
                    let windows: Rc<RefCell<HashMap<u64, Sender>>> = Rc::default();
                    while let Some(command) = queue.recv().await {
                        match command {
                            Command::Invoke {
                                window,
                                channel,
                                request,
                                reply,
                            } => {
                                let sender = windows.borrow().get(&window).cloned();
                                let services = services.clone();
                                tokio::task::spawn_local(async move {
                                    let response = match sender {
                                        Some(sender) => {
                                            services.handlers.handle(&sender, &channel, &request).await
                                        }
                                        None => agent_operation_failure(AgentError::new(
                                            "This window is not connected to the Agent host.",
                                        )),
                                    };
                                    let _ = reply.send(response);
                                });
                            }
                            Command::OpenWindow { window, sink } => {
                                let sender = Sender::new(window, Rc::new(move |channel, payload| sink(channel, payload)));
                                if let Some(previous) = windows.borrow_mut().insert(window, sender) {
                                    previous.destroy();
                                }
                            }
                            Command::CloseWindow { window } => {
                                let sender = windows.borrow_mut().remove(&window);
                                if let Some(sender) = sender {
                                    sender.destroy();
                                }
                                if let Some(store) = services.attachment_store.as_ref() {
                                    store.revoke_owner(window as i64);
                                }
                            }
                            Command::Shutdown { reply } => {
                                let closed = services.service.close_all().await;
                                if let Some(store) = services.attachment_store.as_ref() {
                                    store.close().await;
                                }
                                if let Err(error) = closed {
                                    eprintln!("puppyone failed to drain Agent sessions during quit: {error}");
                                }
                                let _ = reply.send(());
                                return;
                            }
                        }
                    }
                });
            })
            .map_err(|error| AgentError::new(error.to_string()))?;
        started
            .recv()
            .map_err(|_| AgentError::new("The Agent host did not start."))??;
        Ok(Self { commands, roots })
    }

    /// Starts the production composition.
    pub fn start_production(options: AgentHostOptions) -> AgentResult<Self> {
        Self::start(Box::new(move |roots| production_services(options, roots)))
    }

    /// The window's frame channel opens (`webContents` creation).
    pub fn open_window(&self, window: u64, sink: FrameSink) {
        let _ = self.commands.send(Command::OpenWindow { window, sink });
    }

    /// The window may use `roots` (its open projects).
    pub fn authorize_roots(&self, window: u64, roots: impl IntoIterator<Item = String>) {
        let canonical: HashSet<String> = roots
            .into_iter()
            .map(|root| {
                std::fs::canonicalize(&root)
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or(root)
            })
            .collect();
        if let Ok(mut windows) = self.roots.lock() {
            windows.insert(window, canonical);
        }
    }

    /// The window closed: its sessions and staged attachments are released.
    pub fn close_window(&self, window: u64) {
        if let Ok(mut windows) = self.roots.lock() {
            windows.remove(&window);
        }
        let _ = self.commands.send(Command::CloseWindow { window });
    }

    /// `ipcRenderer.invoke(channel, request)`: the response or the
    /// operation-failure envelope.
    pub fn invoke(
        &self,
        window: u64,
        channel: &str,
        request: Value,
    ) -> impl std::future::Future<Output = Value> + Send + 'static {
        let (reply, response) = oneshot::channel();
        let sent = self.commands.send(Command::Invoke {
            window,
            channel: channel.to_string(),
            request,
            reply,
        });
        async move {
            if sent.is_err() {
                return agent_operation_failure(AgentError::new("The Agent host has stopped."));
            }
            response.await.unwrap_or_else(|_| {
                agent_operation_failure(AgentError::new("The Agent host has stopped."))
            })
        }
    }

    /// Drains every Agent session and process before quitting.
    pub fn shutdown(&self) -> impl std::future::Future<Output = ()> + Send + 'static {
        let (reply, done) = oneshot::channel();
        let sent = self.commands.send(Command::Shutdown { reply });
        async move {
            if sent.is_ok() {
                let _ = done.await;
            }
        }
    }
}

/// `authorizeWorkspaceRoot(event, requested)`: a root the window opened.
pub fn window_root_authorizer(roots: WindowRoots) -> AuthorizeWorkspaceRoot {
    Rc::new(move |sender: &Sender, requested: String| {
        let canonical = std::fs::canonicalize(&requested)
            .map(|path| path.to_string_lossy().into_owned())
            .ok();
        let allowed = canonical.as_ref().is_some_and(|canonical| {
            roots
                .lock()
                .ok()
                .and_then(|windows| {
                    windows
                        .get(&sender.id())
                        .map(|roots| roots.contains(canonical))
                })
                .unwrap_or(false)
        });
        Box::pin(async move {
            match canonical.filter(|_| allowed) {
                Some(root) => Ok(root),
                None => Err(AgentError::new(
                    "Requested workspace root does not match an open project.",
                )),
            }
        })
    })
}

/// The product composition (`electron/main.mjs`'s Agent services).
fn production_services(
    options: AgentHostOptions,
    roots: WindowRoots,
) -> AgentResult<AgentHostServices> {
    let runtime_data = options.user_data_path.join("agent-runtime");
    let event_cache = EphemeralAgentSessionCache::new(Some(&options.user_data_path), None, None);
    let catalog = AgentConversationCatalog::new(CatalogOptions {
        file_path: runtime_data.join("conversations.json"),
        ..Default::default()
    })?;
    let repository = AgentSessionRepository::new(event_cache, catalog.clone());
    // The Built-in Agent runs its kernel in process: the native harness
    // serves the bundled worker's protocol, and its leases come from this
    // app's model connections.
    use crate::agent::runtimes::puppyone_agent::{native_kernel, native_model_connections};
    let user_data = options.user_data_path.to_string_lossy().into_owned();
    let registry = create_default_agent_runtime_host(DefaultRuntimeHostOptions {
        app_version: Some(options.app_version.clone()),
        app_path: options.app_path.clone(),
        user_data_path: Some(user_data.clone()),
        executable_path: options.executable_path.clone(),
        puppyone_agent: Some(Rc::new(native_kernel::create_native_kernel_discovery(
            user_data,
            options.executable_path.clone().unwrap_or_default(),
        ))),
        model_connection_port: Some(Rc::new(
            native_model_connections::NativeModelConnectionPort::new(
                native_model_connections::configured_connections(),
            ),
        )),
        puppyone_agent_spawner: Some(native_kernel::native_kernel_spawner(
            native_kernel::configured_complete(),
        )),
        ..Default::default()
    })?;
    let attachment_store = AgentAttachmentStore::new(AttachmentStoreOptions {
        root_path: runtime_data.join("attachments"),
        ..Default::default()
    })?;
    {
        let store = attachment_store.clone();
        crate::agent::event_loop::spawn(async move {
            if let Err(error) = store.initialize().await {
                eprintln!("puppyone failed to initialize Agent attachment staging: {error}");
            }
        });
    }
    let service = AgentService::new(AgentServiceOptions {
        runtime_registry: registry,
        session_cache: Rc::new(repository),
        conversation_catalog: Some(Rc::new(catalog)),
        logger: None,
        attachment_store: Some(Rc::new(attachment_store.clone())),
        process_supervisor: Some(AgentProcessSupervisor::new(Some(2))),
    });
    let inventory = create_local_agent_inventory(LocalAgentInventoryOptions {
        app_version: Some(options.app_version),
        cache_file_path: Some(options.user_data_path.join("agent-runtime-inventory.json")),
        ..Default::default()
    })?;
    Ok(AgentHostServices {
        handlers: AgentIpcHandlers {
            agent_service: Rc::new(service.clone()),
            local_agent_inventory: Some(inventory),
            authorize_workspace_root: window_root_authorizer(roots),
            resolve_workspace_resource: None,
            attachment_store: Some(attachment_store.clone()),
            pick_workspace_paths: None,
        },
        service,
        attachment_store: Some(attachment_store),
    })
}
