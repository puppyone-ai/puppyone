//! The Model Connections page's workers: every call runs off the UI thread
//! and answers once on a capacity-1 channel, then wakes the view. Storage,
//! Keychain and network access stay behind this module; the view only sees
//! connections (never a credential) and results.
mod binding;
mod catalog;
mod discovery;

pub use crate::agent::model_connections::oauth::{Cancel, OauthProvider, Progress};
use crate::{agent::model_connections::configuration, wake::Wake};
pub use catalog::{CatalogModel, list_models};
pub use configuration::{Auth, Driver, ModelConnection, SourceKind};
pub use discovery::{Candidate, Installed};
use std::sync::mpsc::{self, Receiver};

/// Saved connections after a change.
pub type Connections = Result<Vec<ModelConnection>, String>;

/// Run `job` on its own current-thread runtime and answer once.
fn run<T: Send + 'static>(
    wake: Wake,
    job: impl std::future::Future<Output = T> + Send + 'static,
    fallback: impl FnOnce(String) -> T + Send + 'static,
) -> Receiver<T> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime.block_on(job),
            Err(e) => fallback(e.to_string()),
        };
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

/// A change, then the saved connections.
fn change(
    wake: Wake,
    job: impl std::future::Future<Output = Result<(), String>> + Send + 'static,
) -> Receiver<Connections> {
    run(
        wake,
        async move {
            job.await?;
            tokio::task::spawn_blocking(configuration::load)
                .await
                .map_err(|e| e.to_string())?
        },
        Err,
    )
}

pub fn load(wake: Wake) -> Receiver<Connections> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let _ = tx.send(configuration::load());
        wake.notify();
    });
    rx
}

/// Save from the form; an unset default model is chosen from the catalog.
pub fn save(
    connection: ModelConnection,
    secret: Option<String>,
    wake: Wake,
) -> Receiver<Connections> {
    change(wake, binding::save_and_bind(connection, secret))
}

/// Make `model` the connection's default.
pub fn use_as_default(
    mut connection: ModelConnection,
    model: String,
    context: Option<u64>,
    wake: Wake,
) -> Receiver<Connections> {
    connection.default_model_id = Some(model);
    if let Some(context) = context {
        connection.manual_context_window = Some(context.clamp(1024, 10_000_000));
    }
    change(wake, async move {
        tokio::task::spawn_blocking(move || configuration::save(connection, None))
            .await
            .map_err(|e| e.to_string())?
    })
}

pub fn remove(id: String, generation: String, wake: Wake) -> Receiver<Connections> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
        let result = configuration::remove(&id, &generation).and_then(|()| configuration::load());
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

/// What discovery found: reachable services and installed ones that are not
/// running.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Discovery {
    pub candidates: Vec<Candidate>,
    pub stopped: Vec<Installed>,
}

/// Probe local model services (loopback only).
pub fn discover(wake: Wake) -> Receiver<Discovery> {
    run(
        wake,
        async {
            let ports = discovery::ports(std::env::var("OLLAMA_HOST").ok().as_deref());
            let candidates = discovery::discover_ports(&ports).await;
            let stopped = tokio::task::spawn_blocking(discovery::installed)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|i| !candidates.iter().any(|c| c.driver == i.driver))
                .collect();
            Discovery {
                candidates,
                stopped,
            }
        },
        |_| Discovery::default(),
    )
}

/// Start an installed service, then look again once it had time to listen.
pub fn start_service(driver: Driver, wake: Wake) -> Receiver<Discovery> {
    run(
        wake,
        async move {
            if discovery::start(driver).is_ok() {
                for _ in 0..20 {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    let ports = discovery::ports(std::env::var("OLLAMA_HOST").ok().as_deref());
                    let candidates = discovery::discover_ports(&ports).await;
                    if candidates.iter().any(|c| c.driver == driver) {
                        return Discovery {
                            candidates,
                            stopped: vec![],
                        };
                    }
                }
            }
            Discovery::default()
        },
        |_| Discovery::default(),
    )
}

/// `Connect`: bind a discovered service without the form.
pub fn quick_connect(candidate: Candidate, wake: Wake) -> Receiver<Connections> {
    change(wake, binding::quick_connect(candidate))
}

/// A running sign-in's updates.
pub enum SignIn {
    Progress(Progress),
    Done(Connections),
}

/// Sign in with `provider`: progress, then the saved connections.
pub fn sign_in(
    provider: OauthProvider,
    existing: Option<ModelConnection>,
    cancel: Cancel,
    wake: Wake,
) -> Receiver<SignIn> {
    let (tx, rx) = mpsc::sync_channel(8);
    std::thread::spawn(move || {
        let progress_tx = tx.clone();
        let progress_wake = wake.clone();
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
            .and_then(|runtime| {
                runtime.block_on(async move {
                    binding::sign_in(
                        provider,
                        existing,
                        move |step| {
                            let _ = progress_tx.try_send(SignIn::Progress(step));
                            progress_wake.notify();
                        },
                        cancel,
                    )
                    .await?;
                    tokio::task::spawn_blocking(configuration::load)
                        .await
                        .map_err(|e| e.to_string())?
                })
            });
        let _ = tx.send(SignIn::Done(result));
        wake.notify();
    });
    rx
}

/// The catalog of `connection`, read on a worker.
pub fn catalog(
    connection: ModelConnection,
    wake: Wake,
) -> Receiver<Result<Vec<CatalogModel>, String>> {
    run(
        wake,
        async move {
            let client = crate::platform::proxy::system(reqwest::Client::builder())
                .redirect_policy(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .map_err(|e| e.to_string())?;
            // An OAuth token is refreshed before it is used to list.
            let key = connection
                .resolve_credential()
                .await
                .ok()
                .flatten()
                .map(|r| r.bearer);
            list_models(&client, &connection, key.as_deref()).await
        },
        Err,
    )
}

/// `verify`: the Agent tool round trip for the connection's model. The
/// model client's stream callbacks are not `Send`, so the future is built on
/// the worker thread itself.
pub fn verify(connection: ModelConnection, wake: Wake) -> Receiver<Result<(), String>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
            .and_then(|runtime| {
                runtime.block_on(async {
                    tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        crate::agent::runtimes::puppyone_agent::verify(
                            &connection,
                            &crate::features::desktop_agent::CloudCompute,
                        ),
                    )
                    .await
                    .map_err(|_| "TIMEOUT".to_owned())?
                })
            });
        let _ = tx.send(result);
        wake.notify();
    });
    rx
}

/// PuppyOne compute's state for the account (blocking read of the cached
/// directory).
pub fn managed_status(wake: Wake) -> Receiver<Option<(bool, bool)>> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let snapshot = crate::features::desktop_agent::read_managed_status();
        let _ = tx.send(snapshot);
        wake.notify();
    });
    rx
}
