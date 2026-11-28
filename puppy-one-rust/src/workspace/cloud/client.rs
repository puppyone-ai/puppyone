use super::{model, model::Runtime};
use crate::{
    cloud::auth::{self as auth, Broker, Cancellation, ServiceCode},
    workspace::contracts::*,
};
use auth::model::{ApiRequest, Binding};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Condvar, Mutex, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

pub(super) struct VerifyAuthFailure {
    pub error: auth::Error,
    pub dispatched: bool,
    pub elapsed: Duration,
}

pub(super) enum VerifyError {
    Auth(VerifyAuthFailure),
    Contract(Error),
}

pub(super) struct Shared {
    pub broker: Arc<Broker>,
    pub binding: Binding,
    pub cancel: Cancellation,
    pub runtime: Runtime,
    pub sandbox: Arc<Mutex<super::sandbox::CloudSandbox>>,
    pub descriptor: Descriptor,
    pub epoch: AtomicU64,
    pub mutations: super::mutations::Mutations,
    files: Flights<model::File>,
    lists: Flights<Vec<Entry>>,
    /// One wake at a time: requests that find the Workspace asleep together
    /// wait for the first to wake it.
    waking: Mutex<()>,
}
impl Shared {
    pub fn new(
        broker: Arc<Broker>,
        binding: Binding,
        cancel: Cancellation,
        runtime: Runtime,
        descriptor: Descriptor,
    ) -> Arc<Self> {
        let sandbox = Arc::new(Mutex::new(super::sandbox::read_sandbox(&runtime.sandbox)));
        Arc::new(Self {
            broker,
            binding,
            cancel,
            runtime,
            sandbox,
            descriptor,
            epoch: AtomicU64::new(0),
            mutations: Default::default(),
            files: Flights::default(),
            lists: Flights::default(),
            waking: Mutex::new(()),
        })
    }
    pub fn check_auth(&self) -> std::result::Result<(), auth::Error> {
        self.cancel.check()?;
        self.broker.check_binding(&self.binding)
    }
    pub fn check(&self) -> Result<()> {
        self.check_auth().map_err(|_| model::stale())
    }
    pub fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
        self.files.invalidate(|_| true);
        self.lists.invalidate(|_| true);
    }
    pub fn invalidate_paths(&self, paths: &[RelativePath], listings: bool) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
        self.files
            .invalidate(|key| affected_path(key, paths, false));
        if listings {
            self.lists.invalidate(|key| affected_path(key, paths, true));
        }
    }
    pub fn retain_listings(&self) {
        self.lists.state.lock().unwrap().subscriptions += 1;
    }
    pub fn release_listings(&self) {
        self.lists.state.lock().unwrap().subscriptions -= 1;
        self.invalidate();
    }
    pub fn retire(&self) {
        self.cancel.cancel();
        self.invalidate();
    }
    pub fn endpoint(
        &self,
        suffix: &str,
        path: Option<&RelativePath>,
        method: Method,
        body: Option<Value>,
    ) -> Result<ApiRequest> {
        let mut query = vec![("generation".into(), self.runtime.generation.clone())];
        if let Some(path) = path {
            query.push(("path".into(), model::path(path, true)?.into()));
        }
        Ok(ApiRequest {
            idempotency_key: None,
            method,
            path: format!("/projects/{}/workbench{suffix}", self.runtime.project_id),
            query,
            body,
        })
    }
    pub fn request(&self, request: ApiRequest) -> Result<Value> {
        self.check()?;
        let mut woken = false;
        loop {
            let value = self
                .broker
                .request_scoped(&self.binding, &request, &self.cancel);
            match value {
                Ok(value) => {
                    self.check().map_err(|e| if request.read_only() { e } else { Error::new(ErrorKind::OutcomeUnknown, "Cloud access changed after dispatch; verify the outcome before retrying") })?;
                    return Ok(value);
                }
                // The Workspace went to sleep: the server refused before doing
                // anything, so it is woken and the same request sent again.
                Err(auth::Error::Service(_, ServiceCode::NotRunning)) if !woken => {
                    woken = true;
                    match self.wake() {
                        super::opening::Woken::Running => continue,
                        super::opening::Woken::Replaced => {
                            self.invalidate();
                            self.retire();
                            return Err(model::stale());
                        }
                        super::opening::Woken::Failed => {
                            self.invalidate();
                            return Err(Error::new(
                                ErrorKind::Io,
                                "The Cloud workspace is still waking up",
                            ));
                        }
                    }
                }
                Err(error) => {
                    self.invalidate();
                    if terminal(error) {
                        self.retire();
                    }
                    return Err(map_error(error));
                }
            }
        }
    }
    /// Wakes the Workspace after it went to sleep, once for every request
    /// that found it asleep together.
    fn wake(&self) -> super::opening::Woken {
        let _waking = self.waking.lock().unwrap();
        let started = Instant::now();
        let woken = super::opening::wake(&self.broker, &self.binding, &self.cancel, &self.runtime);
        crate::platform::diagnostics::warn(
            "[cloud-recovery] workspace woken",
            json!({
                "outcome": format!("{woken:?}"),
                "duration_ms": started.elapsed().as_millis() as u64,
            }),
        );
        woken
    }
    /// Verifies the root directory once during opening, preserving the full
    /// `auth::Error` (status, reason, request id, retryable) without side
    /// channels on `Shared`, and reusing a server-verified opening listing
    /// when present.
    pub fn verify_opening_root(
        &self,
        opening_root: Option<Value>,
    ) -> std::result::Result<Vec<Entry>, VerifyError> {
        let check_fenced = || {
            self.check_auth().map_err(|error| {
                VerifyError::Auth(VerifyAuthFailure {
                    error,
                    dispatched: false,
                    elapsed: Duration::ZERO,
                })
            })
        };
        check_fenced()?;
        let root = RelativePath::new(std::path::Path::new("")).map_err(VerifyError::Contract)?;
        if let Some(entries) = opening_root {
            let parsed = model::entries(json!({ "entries": entries }), &root)
                .map_err(VerifyError::Contract)?;
            check_fenced()?;
            return Ok(parsed);
        }
        let endpoint = self
            .endpoint("/files", Some(&root), Method::GET, None)
            .map_err(VerifyError::Contract)?;
        let started = Instant::now();
        match self
            .broker
            .request_scoped(&self.binding, &endpoint, &self.cancel)
        {
            Ok(value) => {
                check_fenced()?;
                model::entries(value, &root).map_err(VerifyError::Contract)
            }
            Err(error) => {
                let elapsed = started.elapsed();
                self.invalidate();
                if terminal(error) {
                    self.retire();
                }
                Err(VerifyError::Auth(VerifyAuthFailure {
                    error,
                    dispatched: true,
                    elapsed,
                }))
            }
        }
    }
    pub fn list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
        let key = model::path(path, true)?.to_owned();
        self.lists
            .run(key, || self.check(), || self.fresh_list(path))
    }
    /// Snapshot safety checks must consult storage on each observation: a
    /// live Explorer listing can legitimately precede an unreceived SSE event.
    pub fn fresh_list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
        model::entries(
            self.request(self.endpoint("/files", Some(path), Method::GET, None)?)?,
            path,
        )
    }
    pub fn file(&self, path: &RelativePath) -> Result<model::File> {
        let key = model::path(path, false)?.to_owned();
        self.files.run(
            key,
            || self.check(),
            || {
                model::File::decode(
                    self.request(self.endpoint("/file", Some(path), Method::GET, None)?)?,
                    path,
                )
            },
        )
    }
    pub fn raw_write(
        &self,
        path: &RelativePath,
        bytes: &[u8],
        expected: Option<&str>,
    ) -> Result<String> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        self.check()?;
        model::path(path, false)?;
        if !self.descriptor.capabilities.write {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                "This Cloud project is read-only",
            ));
        }
        if bytes.len() > Limits::CLOUD.text_bytes {
            return Err(Error::from("Cloud files are limited to 8 MiB"));
        }
        self.invalidate_paths(std::slice::from_ref(path), expected.is_none());
        // `query(path)`: the generation and the path, as for every file request.
        let result = self.request(self.endpoint("/file", Some(path), Method::PUT, Some(json!({"path": model::path(path, false)?, "content_base64": STANDARD.encode(bytes), "expected_revision": expected})))?);
        self.invalidate_paths(std::slice::from_ref(path), expected.is_none());
        let value = result?;
        let revision = model::digest(bytes);
        if value["revision"].as_str() != Some(&revision)
            || value["size"].as_u64() != Some(bytes.len() as u64)
        {
            return Err(Error::new(
                ErrorKind::OutcomeUnknown,
                "Cloud write receipt could not be verified; do not repeat automatically",
            ));
        }
        Ok(revision)
    }
    pub fn change(
        &self,
        action: &str,
        path: &RelativePath,
        destination: Option<&RelativePath>,
    ) -> Result<()> {
        let mut paths = vec![path];
        paths.extend(destination);
        let _serial = self.mutations.acquire(&paths, || self.check())?;
        self.check()?;
        if !self.descriptor.capabilities.write {
            return Err(Error::new(
                ErrorKind::PermissionDenied,
                "This Cloud project is read-only",
            ));
        }
        let mut body = json!({"action": action, "path": model::path(path, false)?});
        if let Some(destination) = destination {
            body["destination"] = model::path(destination, false)?.into();
        }
        let changed: Vec<_> = paths.into_iter().cloned().collect();
        self.invalidate_paths(&changed, true);
        let result = self.request(self.endpoint("/files", Some(path), Method::POST, Some(body))?);
        self.invalidate_paths(&changed, true);
        if result? != json!({}) {
            return Err(Error::new(
                ErrorKind::OutcomeUnknown,
                "Cloud operation receipt could not be verified",
            ));
        }
        Ok(())
    }
}
fn affected_path(key: &str, paths: &[RelativePath], listing: bool) -> bool {
    let key = std::path::Path::new(key);
    paths
        .iter()
        .any(|p| key.starts_with(p.as_path()) || (listing && p.as_path().parent() == Some(key)))
}
pub(super) fn terminal(error: auth::Error) -> bool {
    matches!(
        error,
        auth::Error::SessionChanged
            | auth::Error::InvalidCredentials
            | auth::Error::Http(401 | 403)
            | auth::Error::Service(401 | 403, _)
            | auth::Error::Service(
                _,
                ServiceCode::GenerationChanged | ServiceCode::WorkbenchNotFound
            )
    )
}
pub(super) fn map_error(error: auth::Error) -> Error {
    let kind = match error {
        auth::Error::SessionChanged
        | auth::Error::Cancelled
        | auth::Error::Service(
            _,
            ServiceCode::GenerationChanged | ServiceCode::WorkbenchNotFound,
        ) => ErrorKind::StaleLease,
        auth::Error::InvalidCredentials
        | auth::Error::Http(401 | 403)
        | auth::Error::Service(401 | 403, _) => ErrorKind::PermissionDenied,
        auth::Error::Http(404) | auth::Error::Service(_, ServiceCode::FileNotFound) => {
            ErrorKind::NotFound
        }
        auth::Error::Service(409, ServiceCode::FileConflict) => ErrorKind::AlreadyExists,
        auth::Error::OutcomeUnknown => ErrorKind::OutcomeUnknown,
        _ => ErrorKind::Io,
    };
    Error::new(kind, error.to_string())
}
struct Flight<T> {
    value: Mutex<Option<Result<T>>>,
    ready: Condvar,
    invalidated: AtomicBool,
}
struct FlightState<T> {
    pending: HashMap<String, Weak<Flight<T>>>,
    cached: HashMap<String, T>,
    order: VecDeque<String>,
    subscriptions: usize,
}
struct Flights<T> {
    state: Mutex<FlightState<T>>,
}
impl<T> Default for Flights<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new(FlightState {
                pending: HashMap::new(),
                cached: HashMap::new(),
                order: VecDeque::new(),
                subscriptions: 0,
            }),
        }
    }
}
impl<T: Clone> Flights<T> {
    fn invalidate(&self, affected: impl Fn(&str) -> bool) {
        let mut state = self.state.lock().unwrap();
        state.cached.retain(|key, _| !affected(key));
        state.order.retain(|key| !affected(key));
        state.pending.retain(|key, weak| {
            if affected(key) {
                if let Some(flight) = weak.upgrade() {
                    flight.invalidated.store(true, Ordering::Release);
                }
                false
            } else {
                true
            }
        });
    }
    /// Reads `key` once for every caller asking at the same time. A change
    /// that lands while the read is in flight supersedes it: the read runs
    /// again (`cloudWorkspaceFiles` drops such a read from its caches and a
    /// watcher reads again), so no caller is handed bytes a change replaced,
    /// and none sees the race unless the path keeps changing through every
    /// attempt.
    fn run(
        &self,
        key: String,
        check: impl Fn() -> Result<()>,
        work: impl Fn() -> Result<T>,
    ) -> Result<T> {
        for _ in 0..READ_ATTEMPTS {
            if let Some(value) = self.attempt(&key, &check, &work)? {
                return Ok(value);
            }
        }
        Err(Error::new(
            ErrorKind::Io,
            "Cloud files changed during the read; revalidate",
        ))
    }
    /// One coalesced read; `None` when a change superseded it.
    fn attempt(
        &self,
        key: &str,
        check: &impl Fn() -> Result<()>,
        work: &impl Fn() -> Result<T>,
    ) -> Result<Option<T>> {
        check()?;
        let (flight, leader) = {
            let mut state = self.state.lock().unwrap();
            if state.subscriptions > 0
                && let Some(value) = state.cached.get(key)
            {
                return Ok(Some(value.clone()));
            }
            let pending = &mut state.pending;
            pending.retain(|_, v| v.strong_count() > 0);
            if let Some(active) = pending.get(key).and_then(Weak::upgrade) {
                (active, false)
            } else {
                if pending.len() >= 128 {
                    return Err(Error::new(
                        ErrorKind::Io,
                        "Cloud read concurrency limit reached",
                    ));
                }
                let active = Arc::new(Flight {
                    value: Mutex::new(None),
                    ready: Condvar::new(),
                    invalidated: AtomicBool::new(false),
                });
                pending.insert(key.to_owned(), Arc::downgrade(&active));
                (active, true)
            }
        };
        if leader {
            let result = work();
            let mut state = self.state.lock().unwrap();
            if !flight.invalidated.load(Ordering::Acquire) {
                if state.subscriptions > 0
                    && let Ok(value) = &result
                {
                    if !state.cached.contains_key(key) {
                        state.order.push_back(key.to_owned());
                    }
                    state.cached.insert(key.to_owned(), value.clone());
                    while state.order.len() > 128 {
                        if let Some(oldest) = state.order.pop_front() {
                            state.cached.remove(&oldest);
                        }
                    }
                }
                state.pending.remove(key);
            }
            *flight.value.lock().unwrap() = Some(result);
            flight.ready.notify_all();
        }
        let mut result = flight.value.lock().unwrap();
        while result.is_none() {
            check()?;
            result = flight
                .ready
                .wait_timeout(result, Duration::from_millis(50))
                .unwrap()
                .0;
        }
        check()?;
        let value = result.as_ref().unwrap().clone()?;
        Ok((!flight.invalidated.load(Ordering::Acquire)).then_some(value))
    }
}
/// A read a change superseded runs this many times in all
/// (`readDocumentStorageSnapshot` reads a straddled document up to 8 times).
const READ_ATTEMPTS: usize = 8;

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::Path, sync::mpsc, thread};

    fn read(cache: &Flights<u32>, path: &str, value: u32) -> u32 {
        cache.run(path.into(), || Ok(()), || Ok(value)).unwrap()
    }
    #[test]
    fn listings_are_cached_only_while_watching_and_are_bounded() {
        let cache = Flights::default();
        assert_eq!(read(&cache, "", 1), 1);
        assert_eq!(read(&cache, "", 2), 2);
        cache.state.lock().unwrap().subscriptions = 1;
        assert_eq!(read(&cache, "", 3), 3);
        assert_eq!(read(&cache, "", 4), 3);
        for i in 0..128 {
            read(&cache, &format!("folder{i}"), i);
        }
        assert_eq!(cache.state.lock().unwrap().cached.len(), 128);
        assert_eq!(read(&cache, "", 5), 5);
        cache.state.lock().unwrap().subscriptions = 0;
        cache.invalidate(|_| true);
        assert_eq!(read(&cache, "", 6), 6);
        assert_eq!(read(&cache, "", 7), 7);
    }
    #[test]
    fn change_scope_drops_the_parent_and_subtree_but_preserves_other_listings() {
        for (changed, removed) in [
            ("docs/guide.md", vec!["docs"]),
            ("docs", vec!["", "docs", "docs/deep"]),
        ] {
            let cache = Flights::default();
            cache.state.lock().unwrap().subscriptions = 1;
            for key in ["", "docs", "docs/deep", "docs2", "other"] {
                read(&cache, key, 1);
            }
            let paths = [RelativePath::new(Path::new(changed)).unwrap()];
            cache.invalidate(|key| affected_path(key, &paths, true));
            for key in ["", "docs", "docs/deep", "docs2", "other"] {
                assert_eq!(
                    read(&cache, key, 2),
                    if removed.contains(&key) { 2 } else { 1 },
                    "{changed}: {key}"
                );
            }
            assert!(!affected_path("other", &paths, false));
            assert_eq!(affected_path("docs", &paths, false), changed == "docs");
        }
    }
    #[test]
    fn a_change_during_a_read_reads_again_without_discarding_unrelated_reads() {
        for changed in ["a.md", "b.md"] {
            let cache = Arc::new(Flights::default());
            cache.state.lock().unwrap().subscriptions = 1;
            let worker = cache.clone();
            let (started, start) = mpsc::channel();
            let (release, held) = mpsc::channel();
            let reads = Arc::new(AtomicU64::new(0));
            let counted = reads.clone();
            let task = thread::spawn(move || {
                worker.run(
                    "a.md".into(),
                    || Ok(()),
                    || {
                        // The first read is held while the change lands; a
                        // second one sees the changed bytes.
                        if counted.fetch_add(1, Ordering::AcqRel) == 0 {
                            started.send(()).unwrap();
                            held.recv_timeout(Duration::from_secs(2)).unwrap();
                            Ok(1)
                        } else {
                            Ok(2)
                        }
                    },
                )
            });
            start.recv_timeout(Duration::from_secs(2)).unwrap();
            cache.invalidate(|key| key == changed);
            release.send(()).unwrap();
            let superseded = changed == "a.md";
            assert_eq!(task.join().unwrap(), Ok(if superseded { 2 } else { 1 }));
            assert_eq!(
                reads.load(Ordering::Acquire),
                if superseded { 2 } else { 1 }
            );
            // What was read last is what the cache keeps.
            assert_eq!(read(&cache, "a.md", 3), if superseded { 2 } else { 1 });
        }
    }
    #[test]
    fn a_path_that_keeps_changing_through_every_attempt_reports_the_race() {
        let cache = Flights::<u32>::default();
        let reads = AtomicU64::new(0);
        let result = cache.run(
            "a.md".into(),
            || Ok(()),
            || {
                reads.fetch_add(1, Ordering::AcqRel);
                cache.invalidate(|key| key == "a.md");
                Ok(1)
            },
        );
        assert_eq!(result.unwrap_err().kind, ErrorKind::Io);
        assert_eq!(reads.load(Ordering::Acquire), READ_ATTEMPTS as u64);
    }
    #[test]
    fn errors_are_not_cached_and_authority_is_checked_even_on_cache_hits() {
        let cache = Flights::<u32>::default();
        cache.state.lock().unwrap().subscriptions = 1;
        assert!(
            cache
                .run("a".into(), || Ok(()), || Err(Error::from("network")))
                .is_err()
        );
        assert_eq!(read(&cache, "a", 2), 2);
        assert!(
            cache
                .run(
                    "a".into(),
                    || Err(model::stale()),
                    || panic!("must not dispatch")
                )
                .is_err()
        );
    }
}
