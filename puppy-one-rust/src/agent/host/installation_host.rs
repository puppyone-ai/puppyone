//! Own the non-Send resolver on one cancellable Tokio local runtime; GPUI only
//! exchanges immutable evidence. No window owns or joins the worker thread.
use crate::agent::{
    agent_error::AgentResult,
    installation::installation_service::{InstallationService, Progress, Snapshot},
};
use std::{rc::Rc, sync::Arc};
pub enum InstallationEvent {
    Progress(Arc<Progress>),
    Completed {
        request: u64,
        result: AgentResult<Arc<Snapshot>>,
    },
    Unavailable,
}
struct Request {
    id: u64,
    refresh: bool,
}
pub struct InstallationHost {
    requests: tokio::sync::mpsc::UnboundedSender<Request>,
    stop: tokio_util::sync::CancellationToken,
}
impl InstallationHost {
    pub fn new() -> (
        Self,
        tokio::sync::mpsc::UnboundedReceiver<InstallationEvent>,
    ) {
        Self::with_factory(|| InstallationService::system(None))
    }
    pub fn with_factory(
        factory: impl FnOnce() -> InstallationService + Send + 'static,
    ) -> (
        Self,
        tokio::sync::mpsc::UnboundedReceiver<InstallationEvent>,
    ) {
        let (requests, mut incoming) = tokio::sync::mpsc::unbounded_channel::<Request>();
        let stop = tokio_util::sync::CancellationToken::new();
        let stopping = stop.clone();
        let (publish, events) = tokio::sync::mpsc::unbounded_channel();
        let failed = publish.clone();
        if std::thread::Builder::new()
            .name("installation-discovery".into())
            .spawn(move || {
                let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                else {
                    let _ = publish.send(InstallationEvent::Unavailable);
                    return;
                };
                tokio::task::LocalSet::new().block_on(&runtime, async move {
                    let service = factory();
                    let progress = publish.clone();
                    let observer: Rc<dyn Fn(Arc<Progress>)> = Rc::new(move |value| {
                        let _ = progress.send(InstallationEvent::Progress(value));
                    });
                    loop {
                        let request = tokio::select! { biased;
                            _ = stopping.cancelled() => break,
                            request = incoming.recv() => match request { Some(request) => request, None => break },
                        };
                        let task = service.discover(request.refresh, Some(observer.clone()));
                        let publish = publish.clone();
                        tokio::task::spawn_local(async move {
                            let _ = publish.send(InstallationEvent::Completed {
                                request: request.id,
                                result: task.await,
                            });
                        });
                    }
                    service.dispose();
                });
            })
            .is_err()
        {
            let _ = failed.send(InstallationEvent::Unavailable);
        }
        (Self { requests, stop }, events)
    }
    pub fn discover(&self, id: u64, refresh: bool) -> bool {
        !self.stop.is_cancelled() && self.requests.send(Request { id, refresh }).is_ok()
    }
    pub fn close(&self) {
        self.stop.cancel();
    }
}
impl Drop for InstallationHost {
    fn drop(&mut self) {
        self.close();
    }
}

/// Consent-sensitive discovery never treats a cached absence as permission to
/// install. Called on an activation worker, not on the UI thread.
pub fn resolve_installation_now(
    id: &str,
) -> AgentResult<crate::agent::installation::executable_resolver::Observation> {
    use crate::agent::discovery::executable_discovery_port::{
        DiscoveryPortOptions, ExecutableDiscoveryPort,
    };
    use crate::agent::installation::executable_resolver::LocalAgentExecutableResolver;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| crate::agent::agent_error::AgentError::new(e.to_string()))?;
    tokio::task::LocalSet::new().block_on(&runtime, async {
        LocalAgentExecutableResolver::new(
            None,
            ExecutableDiscoveryPort::new(DiscoveryPortOptions::default()),
        )
        .resolve(id, None, vec![])
        .await
    })
}
