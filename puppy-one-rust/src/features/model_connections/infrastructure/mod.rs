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

/// Run `job` on its own current-thread runtime and answer once. The worker
/// is `localization::spawn`'s: it speaks the window's language (errors are
/// shown as they are) and a panic in it is contained. Configuration reads
/// and writes are called directly on it: it is a thread of its own.
fn run<T: Send + 'static>(
    wake: Wake,
    job: impl std::future::Future<Output = T> + Send + 'static,
    fallback: impl FnOnce(String) -> T + Send + 'static,
) -> Receiver<T> {
    let (tx, rx) = mpsc::sync_channel(1);
    crate::localization::spawn(move || {
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
            configuration::load()
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
    change(wake, async move { configuration::save(connection, None) })
}

/// The models `connection` offers in Chat besides its default: every text
/// model its service lists (the provider's whole catalog, as Cursor's picker
/// shows it), except Ollama's cloud models, models that refuse tools and
/// models whose names mark another kind (images, video, speech, embeddings:
/// [`discovery::chat_model`]).
pub fn offered(connection: &ModelConnection, models: &[CatalogModel]) -> Vec<String> {
    models
        .iter()
        .filter(|m| !m.remote && m.tools != Some(false) && discovery::chat_model(&m.id))
        .map(|m| m.id.clone())
        .filter(|m| connection.default_model_id.as_deref() != Some(m.as_str()))
        .take(64)
        .collect()
}

/// Brings every saved connection's Chat models up to its service's catalog,
/// so Chat offers each provider's whole text catalog without Settings being
/// opened (blocking: reads the catalogs concurrently). A connection is read
/// at most once every ten minutes; `true` when a connection was saved.
pub fn sync_offered() -> bool {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};
    static READ: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Default::default);
    // Tests never reach this machine's services (see `discover`).
    if cfg!(test) {
        return false;
    }
    let Ok(connections) = configuration::load() else {
        return false;
    };
    // Claimed before reading, so panels reloading together read once.
    let due: Vec<ModelConnection> = {
        let Ok(mut read) = READ.lock() else {
            return false;
        };
        connections
            .into_iter()
            .filter(|c| {
                let due = read
                    .get(&c.id)
                    .is_none_or(|at| at.elapsed() >= Duration::from_secs(600));
                if due {
                    read.insert(c.id.clone(), Instant::now());
                }
                due
            })
            .collect()
    };
    if due.is_empty() {
        return false;
    }
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return false;
    };
    let Ok(client) = catalog::metadata_client() else {
        return false;
    };
    let read = runtime.block_on(futures_util::future::join_all(due.into_iter().map(
        |connection| {
            let client = client.clone();
            async move {
                let key = connection
                    .resolve_credential()
                    .await
                    .ok()
                    .flatten()
                    .map(|r| r.bearer);
                // An authenticated connection whose credential cannot be
                // read (a locked or refused Keychain) is left as it is.
                let models = match key {
                    None if connection.auth != Auth::None => Err("CREDENTIAL_UNAVAILABLE".into()),
                    key => catalog::listed_models(&client, &connection, key.as_deref()).await,
                };
                (connection, models)
            }
        },
    )));
    let mut saved = false;
    for (connection, models) in read {
        let Ok(models) = models else { continue };
        let models = offered(&connection, &models);
        // The generation stays: a session on this connection goes on.
        saved |= configuration::set_chat_models(&connection.id, &models).unwrap_or(false);
    }
    saved
}

/// The models connection `id` offers in Chat besides its default (the
/// generation stays: [`configuration::set_chat_models`]).
pub fn set_chat_models(id: String, models: Vec<String>, wake: Wake) -> Receiver<Connections> {
    change(wake, async move {
        configuration::set_chat_models(&id, &models).map(|_| ())
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
    // Tests never probe this machine's services: every Settings page a test
    // opens would otherwise `lsof` the user's listeners and send them HTTP
    // (hundreds of connections per run, enough to exhaust loopback ports).
    // Discovery itself is tested on its own fixtures (`discovery::tests`).
    if cfg!(test) {
        let (tx, rx) = mpsc::sync_channel(1);
        let _ = tx.send(Discovery::default());
        wake.notify();
        return rx;
    }
    run(
        wake,
        async {
            let candidates = discovery::running().await;
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
                // Checks the service's own ports only, for at most 15 s.
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
                while std::time::Instant::now() < deadline {
                    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                    if discovery::serving(driver).await {
                        return Discovery {
                            candidates: discovery::running().await,
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

/// `Connect` / `Add`: bind a discovered service without the form, with
/// `model` as its default when the user picked one.
pub fn quick_connect(
    candidate: Candidate,
    model: Option<String>,
    wake: Wake,
) -> Receiver<Connections> {
    change(wake, binding::quick_connect(candidate, model))
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
    crate::localization::spawn(move || {
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
                    configuration::load()
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
            let client = catalog::metadata_client()?;
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
    crate::localization::spawn(move || {
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
    crate::localization::spawn(move || {
        let snapshot = crate::features::desktop_agent::read_managed_status();
        let _ = tx.send(snapshot);
        wake.notify();
    });
    rx
}

#[cfg(test)]
mod offered_tests {
    use super::*;

    /// A provider offers its whole text catalog besides its default, never
    /// a remote (Ollama cloud) model or one that refuses tools.
    #[test]
    fn every_text_model_but_the_default_is_offered() {
        let model = |id: &str, tools: Option<bool>, remote: bool| CatalogModel {
            tools,
            remote,
            ..CatalogModel::named(id.to_owned())
        };
        let connection = ModelConnection {
            default_model_id: Some("grok-4".into()),
            ..Default::default()
        };
        let catalog = [
            model("grok-4", Some(true), false),
            model("grok-4.7", None, false),
            model("grok-4.20-0309-reasoning", Some(true), false),
            model("embed", Some(false), false),
            model("gpt-oss:120b-cloud", Some(true), true),
            model("grok-imagine-video-1.5", None, false),
            model("grok-2-image", None, false),
        ];
        assert_eq!(
            offered(&connection, &catalog),
            ["grok-4.7", "grok-4.20-0309-reasoning"]
        );
    }
}
