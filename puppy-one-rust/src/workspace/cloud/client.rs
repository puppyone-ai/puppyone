use super::{model, model::Runtime};
use crate::{
    cloud_auth::{self as auth, Broker, Cancellation, ServiceCode},
    workspace::contracts::*,
};
use auth::model::{ApiRequest, Binding};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Condvar, Mutex, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

pub(super) struct Shared {
    pub broker: Arc<Broker>,
    pub binding: Binding,
    pub cancel: Cancellation,
    pub runtime: Runtime,
    pub descriptor: Descriptor,
    pub epoch: AtomicU64,
    pub mutations: Mutex<()>,
    files: Flights<model::File>,
    lists: Flights<Vec<Entry>>,
}
impl Shared {
    pub fn new(
        broker: Arc<Broker>,
        binding: Binding,
        cancel: Cancellation,
        runtime: Runtime,
        descriptor: Descriptor,
    ) -> Arc<Self> {
        Arc::new(Self {
            broker,
            binding,
            cancel,
            runtime,
            descriptor,
            epoch: AtomicU64::new(0),
            mutations: Mutex::new(()),
            files: Flights::default(),
            lists: Flights::default(),
        })
    }
    pub fn check(&self) -> Result<()> {
        self.cancel.check().map_err(|_| model::stale())?;
        self.broker
            .check_binding(&self.binding)
            .map_err(|_| model::stale())
    }
    pub fn invalidate(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
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
        let value = self
            .broker
            .request_scoped(&self.binding, &request, &self.cancel);
        match value {
            Ok(value) => {
                self.check().map_err(|e| if request.read_only() { e } else { Error::new(ErrorKind::OutcomeUnknown, "Cloud access changed after dispatch; verify the outcome before retrying") })?;
                Ok(value)
            }
            Err(error) => {
                if terminal(error) {
                    self.retire();
                }
                Err(map_error(error))
            }
        }
    }
    pub fn list(&self, path: &RelativePath) -> Result<Vec<Entry>> {
        let key = model::path(path, true)?.to_owned();
        self.lists.run(self, key, || {
            model::entries(
                self.request(self.endpoint("/files", Some(path), Method::GET, None)?)?,
                path,
            )
        })
    }
    pub fn file(&self, path: &RelativePath) -> Result<model::File> {
        let key = model::path(path, false)?.to_owned();
        self.files.run(self, key, || {
            model::File::decode(
                self.request(self.endpoint("/file", Some(path), Method::GET, None)?)?,
                path,
            )
        })
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
        self.invalidate();
        let result = self.request(self.endpoint("/file", None, Method::PUT, Some(json!({"path": model::path(path, false)?, "content_base64": STANDARD.encode(bytes), "expected_revision": expected})))?);
        self.invalidate();
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
        let _serial = self.mutations.lock().unwrap();
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
        self.invalidate();
        let result = self.request(self.endpoint("/files", None, Method::POST, Some(body))?);
        self.invalidate();
        if result? != json!({}) {
            return Err(Error::new(
                ErrorKind::OutcomeUnknown,
                "Cloud operation receipt could not be verified",
            ));
        }
        Ok(())
    }
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
                ServiceCode::GenerationChanged
                    | ServiceCode::WorkbenchNotFound
                    | ServiceCode::NotRunning
            )
    )
}
pub(super) fn map_error(error: auth::Error) -> Error {
    let kind = match error {
        auth::Error::SessionChanged
        | auth::Error::Cancelled
        | auth::Error::Service(
            _,
            ServiceCode::GenerationChanged
            | ServiceCode::WorkbenchNotFound
            | ServiceCode::NotRunning,
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
}
type Pending<T> = HashMap<(u64, String), Weak<Flight<T>>>;
struct Flights<T> {
    pending: Mutex<Pending<T>>,
}
impl<T> Default for Flights<T> {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}
impl<T: Clone> Flights<T> {
    fn run(&self, shared: &Shared, path: String, work: impl FnOnce() -> Result<T>) -> Result<T> {
        shared.check()?;
        let epoch = shared.epoch.load(Ordering::Acquire);
        let key = (epoch, path);
        let (flight, leader) = {
            let mut pending = self.pending.lock().unwrap();
            pending.retain(|_, v| v.strong_count() > 0);
            if let Some(active) = pending.get(&key).and_then(Weak::upgrade) {
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
                });
                pending.insert(key.clone(), Arc::downgrade(&active));
                (active, true)
            }
        };
        if leader {
            let result = work();
            *flight.value.lock().unwrap() = Some(result);
            flight.ready.notify_all();
            self.pending.lock().unwrap().remove(&key);
        }
        let mut result = flight.value.lock().unwrap();
        while result.is_none() {
            shared.check()?;
            result = flight
                .ready
                .wait_timeout(result, Duration::from_millis(50))
                .unwrap()
                .0;
        }
        shared.check()?;
        let value = result.as_ref().unwrap().clone()?;
        if shared.epoch.load(Ordering::Acquire) != epoch {
            return Err(Error::new(
                ErrorKind::Io,
                "Cloud files changed during the read; revalidate",
            ));
        }
        Ok(value)
    }
}
