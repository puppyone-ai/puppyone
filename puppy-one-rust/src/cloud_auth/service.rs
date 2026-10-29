use super::{
    callback,
    http::{Http, Remote},
    model::*,
    store::Store,
};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct BrowserEvent {
    pub epoch: u64,
    pub url: String,
    expires: Instant,
}
struct Flight<T> {
    result: Mutex<Option<Result<T>>>,
    ready: Condvar,
}
impl<T: Clone> Flight<T> {
    fn new() -> Self {
        Self {
            result: Mutex::new(None),
            ready: Condvar::new(),
        }
    }
    fn wait(&self, fence: &Fence) -> Result<T> {
        let mut result = self.result.lock().unwrap();
        loop {
            fence.check()?;
            if let Some(result) = &*result {
                return result.clone();
            }
            result = self
                .ready
                .wait_timeout(result, Duration::from_millis(100))
                .unwrap()
                .0;
        }
    }
}
#[derive(Default)]
struct Mutation {
    rollback: Option<Option<Credential>>,
}
struct State {
    environment: Environment,
    epoch: u64,
    credential: Option<Credential>,
    session: Option<Session>,
    status: Status,
    error: Option<Error>,
    flight: Option<Arc<Flight<Session>>>,
    login: Option<BrowserEvent>,
    initialized: bool,
    initializing: Option<Arc<Flight<()>>>,
    closing: bool,
    logout_pending: bool,
}
pub struct Broker {
    pub(super) control: Arc<Control>,
    instance: uuid::Uuid,
    state: Mutex<State>,
    remote: Arc<dyn Remote>,
    store: Arc<dyn Store>,
    mutations: Mutex<Mutation>,
    updates: tokio::sync::watch::Sender<Snapshot>,
    browser: async_channel::Sender<BrowserEvent>,
}
impl Broker {
    pub fn native(
        environment: Environment,
    ) -> Result<(Arc<Self>, async_channel::Receiver<BrowserEvent>)> {
        #[cfg(target_os = "macos")]
        {
            Ok(Self::new(
                environment,
                Arc::new(Http::new()?),
                Arc::new(super::store::Keychain::new()),
            ))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = environment;
            Err(Error::Unsupported)
        }
    }
    pub(super) fn new(
        environment: Environment,
        remote: Arc<dyn Remote>,
        store: Arc<dyn Store>,
    ) -> (Arc<Self>, async_channel::Receiver<BrowserEvent>) {
        let (browser, receiver) = async_channel::bounded(4);
        let snapshot = Snapshot {
            epoch: 1,
            environment: environment.clone(),
            status: Status::SignedOut,
            account: None,
            error: None,
            can_reopen: false,
        };
        (
            Arc::new(Self {
                control: Control::new(),
                instance: uuid::Uuid::new_v4(),
                state: Mutex::new(State {
                    environment,
                    epoch: 1,
                    credential: None,
                    session: None,
                    status: Status::SignedOut,
                    error: None,
                    flight: None,
                    login: None,
                    initialized: false,
                    initializing: None,
                    closing: false,
                    logout_pending: false,
                }),
                remote,
                store,
                mutations: Mutex::default(),
                updates: tokio::sync::watch::channel(snapshot).0,
                browser,
            }),
            receiver,
        )
    }
    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<Snapshot> {
        self.updates.subscribe()
    }
    pub fn current(&self, epoch: u64) -> bool {
        let fence = self.control.fence();
        fence.epoch == epoch && fence.check().is_ok()
    }
    fn publish(&self, state: &State) {
        let next = Snapshot {
            epoch: state.epoch,
            environment: state.environment.clone(),
            status: state.status,
            account: state.credential.as_ref().map(|c| Account {
                email: c.email.clone(),
                binding: self.binding(state, c),
            }),
            error: state.error,
            can_reopen: state
                .login
                .as_ref()
                .is_some_and(|e| e.expires > Instant::now()),
        };
        self.updates.send_if_modified(|current| {
            if *current == next {
                false
            } else {
                *current = next;
                true
            }
        });
    }
    fn binding(&self, state: &State, credential: &Credential) -> Binding {
        Binding {
            environment: state.environment.clone(),
            user: credential.user.clone(),
            instance: self.instance,
            epoch: state.epoch,
        }
    }
    fn update(&self, fence: &Fence, change: impl FnOnce(&mut State)) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        fence.check()?;
        if state.closing {
            return Err(Error::SessionChanged);
        }
        state.epoch = fence.epoch;
        change(&mut state);
        self.publish(&state);
        Ok(())
    }
    fn begin(&self, status: Status) -> Result<Fence> {
        let mut state = self.state.lock().unwrap();
        self.control.fence().check()?;
        if state.closing {
            return Err(Error::SessionChanged);
        }
        let epoch = self.control.advance();
        let fence = Fence {
            control: self.control.clone(),
            epoch,
            deadline: None,
            cancel: None,
        };
        state.epoch = epoch;
        state.status = status;
        state.logout_pending |= status == Status::SigningOut;
        state.error = None;
        state.flight = None;
        state.login = None;
        state.initialized = false;
        state.initializing = None;
        self.publish(&state);
        Ok(fence)
    }
    fn fail(&self, fence: &Fence, error: Error) {
        // Expiry retires the attempt, not its right to publish the final state.
        // Only a newer generation/disposal may suppress this completion.
        let mut completion = fence.clone();
        completion.deadline = None;
        let _ = self.update(&completion, |s| {
            s.login = None;
            s.status = if error == Error::SecureStorage {
                Status::StorageBlocked
            } else if matches!(s.status, Status::SigningIn | Status::SignedOut)
                && s.session.as_ref().is_some_and(Session::fresh)
            {
                Status::Authenticated
            } else if s.credential.is_some() {
                Status::Offline
            } else {
                Status::SignedOut
            };
            s.error = Some(error);
        });
    }
    pub fn restore(self: &Arc<Self>) {
        let broker = self.clone();
        let fence = self.control.fence();
        if self
            .update(&fence, |s| {
                s.status = Status::Restoring;
                s.error = None;
            })
            .is_err()
        {
            return;
        }
        std::thread::spawn(move || {
            if let Err(error) = broker.restore_now(&fence) {
                broker.fail(&fence, error);
            }
        });
    }
    fn restore_now(&self, fence: &Fence) -> Result<()> {
        let mut serial = self.mutations.lock().unwrap();
        fence.check()?;
        self.reconcile_store(&mut serial, false)?;
        let credential = self.store.load()?;
        let (binding, rejected) = {
            let mut state = self.state.lock().unwrap();
            fence.check()?;
            let credential = credential.filter(|c| c.environment == state.environment);
            if state.credential.as_ref().is_some_and(|old| {
                credential
                    .as_ref()
                    .is_none_or(|new| old.user != new.user || old.environment != new.environment)
            }) {
                state.epoch = self.control.advance();
                state.credential = None;
                state.session = None;
                state.flight = None;
                state.status = Status::SignedOut;
                state.error = Some(Error::SessionChanged);
                self.publish(&state);
                return Err(Error::SessionChanged);
            }
            let binding = credential.as_ref().map(|c| self.binding(&state, c));
            let rejected = state.session.as_ref().map(|s| s.access.clone());
            state.credential = credential;
            if binding.is_none() {
                state.session = None;
                state.status = Status::SignedOut;
            }
            self.publish(&state);
            (binding, rejected)
        };
        drop(serial);
        if let Some(binding) = binding {
            self.session_for(&binding, rejected.as_ref())?;
            self.update(fence, |s| {
                s.status = Status::Authenticated;
                s.error = None;
            })?;
        }
        Ok(())
    }
    pub fn sign_in(self: &Arc<Self>) {
        self.sign_in_until(Instant::now() + Duration::from_secs(600));
    }
    pub(super) fn sign_in_until(self: &Arc<Self>, deadline: Instant) {
        let Ok(fence) = self.begin(Status::SigningIn) else {
            return;
        };
        let broker = self.clone();
        std::thread::spawn(move || {
            let mut fence = fence;
            fence.deadline = Some(deadline);
            let environment = broker.state.lock().unwrap().environment.clone();
            let result = broker
                .remote
                .providers(&environment, &fence)
                .and_then(|_| callback::run(&broker, environment, &fence));
            if let Err(error) = result {
                broker.fail(&fence, error);
            }
        });
    }
    pub fn reopen(&self) {
        let state = self.state.lock().unwrap();
        if self.current(state.epoch)
            && let Some(event) = &state.login
            && event.expires > Instant::now()
        {
            let _ = self.browser.try_send(event.clone());
        }
    }
    pub fn browser_current(&self, event: &BrowserEvent) -> bool {
        let state = self.state.lock().unwrap();
        self.current(event.epoch)
            && state.status == Status::SigningIn
            && event.expires > Instant::now()
            && state
                .login
                .as_ref()
                .is_some_and(|current| current.url == event.url && current.epoch == event.epoch)
    }
    pub fn cancel(&self) {
        let Ok(fence) = self.begin(Status::SignedOut) else {
            return;
        };
        self.fail(&fence, Error::Cancelled);
    }
    pub(super) fn browser_ready(&self, fence: &Fence, url: String) -> Result<()> {
        let event = BrowserEvent {
            epoch: fence.epoch,
            url,
            expires: fence
                .deadline
                .unwrap_or_else(|| Instant::now() + Duration::from_secs(600)),
        };
        self.update(fence, |s| s.login = Some(event.clone()))?;
        self.browser.try_send(event).map_err(|_| Error::Unavailable)
    }
    pub(super) fn complete_login(
        &self,
        environment: Environment,
        input: callback::Input,
        verifier: &Secret,
        fence: &Fence,
    ) -> Result<()> {
        fence.check()?;
        let session = match input {
            callback::Input::Code(code) => {
                self.remote.exchange(&environment, &code, verifier, fence)?
            }
            callback::Input::Refresh(refresh) => {
                let provisional = Credential {
                    version: 1,
                    environment,
                    user: String::new(),
                    email: String::new(),
                    refresh,
                };
                self.remote.refresh(&provisional, fence)?
            }
            callback::Input::Cancelled => return Err(Error::Cancelled),
        };
        self.adopt(&session, fence)?;
        // Initialization failure does not undo successful authentication. The
        // existing server endpoint is idempotent; no workspace is opened here.
        let mut initialized = fence.clone();
        initialized.deadline = None;
        let _ = self.initialize(&session, &initialized);
        initialized.check()
    }
    fn reconcile_store(&self, mutation: &mut Mutation, clear: bool) -> Result<()> {
        if clear {
            self.store.clear()?;
        } else if let Some(previous) = &mutation.rollback {
            match previous {
                Some(value) => self.store.save(value)?,
                None => self.store.clear()?,
            }
        }
        mutation.rollback = None;
        Ok(())
    }
    fn report_storage_error(&self) {
        let fence = self.control.fence();
        let _ = self.update(&fence, |s| {
            s.status = Status::StorageBlocked;
            s.error = Some(Error::SecureStorage);
        });
    }
    fn adopt(&self, session: &Session, fence: &Fence) -> Result<()> {
        let mut mutation = self.mutations.lock().unwrap();
        fence.check()?;
        self.reconcile_store(&mut mutation, false)?;
        mutation.rollback = Some(self.store.load()?);
        let committed = self.store.save(&session.credential).and_then(|_| {
            self.update(fence, |s| {
                s.credential = Some(session.credential.clone());
                s.session = Some(session.clone());
                s.status = Status::Authenticated;
                s.error = None;
                s.login = None;
                s.logout_pending = false;
            })
        });
        if committed.is_ok() {
            mutation.rollback = None;
        } else if self.reconcile_store(&mut mutation, false).is_err() {
            // Keep failed cleanup owned by the serialized mutation coordinator.
            // A cancelled attempt must not leave an undisclosed saved login.
            self.report_storage_error();
            return Err(Error::SecureStorage);
        }
        committed
    }
    fn initialize(&self, session: &Session, fence: &Fence) -> Result<()> {
        let (flight, leader) = {
            let mut state = self.state.lock().unwrap();
            fence.check()?;
            if state.initialized {
                return Ok(());
            }
            if let Some(flight) = &state.initializing {
                (flight.clone(), false)
            } else {
                let flight = Arc::new(Flight::new());
                state.initializing = Some(flight.clone());
                (flight, true)
            }
        };
        if leader {
            let result = self.remote.initialize(session, fence);
            let _ = self.update(fence, |s| {
                s.initialized = result.is_ok();
                s.initializing = None;
            });
            *flight.result.lock().unwrap() = Some(result);
            flight.ready.notify_all();
        }
        flight.wait(fence)
    }
    fn authorized(&self, binding: &Binding) -> Result<Fence> {
        let fence = self.control.fence();
        fence.check()?;
        let state = self.state.lock().unwrap();
        if state.closing
            || state.epoch != fence.epoch
            || binding.epoch != fence.epoch
            || binding.instance != self.instance
            || binding.environment != state.environment
            || !state
                .credential
                .as_ref()
                .is_some_and(|c| c.user == binding.user)
            || matches!(
                state.status,
                Status::SigningOut | Status::SigningIn | Status::StorageBlocked
            )
        {
            return Err(Error::SessionChanged);
        }
        Ok(fence)
    }
    fn session_for(&self, binding: &Binding, rejected: Option<&Secret>) -> Result<Session> {
        let fence = self.authorized(binding)?;
        let (flight, leader, credential) = {
            let mut state = self.state.lock().unwrap();
            fence.check()?;
            if let Some(session) = &state.session
                && session.fresh()
                && rejected.is_none_or(|token| token.0 != session.access.0)
            {
                return Ok(session.clone());
            }
            let credential = state.credential.clone().ok_or(Error::InvalidCredentials)?;
            if let Some(flight) = &state.flight {
                (flight.clone(), false, credential)
            } else {
                let flight = Arc::new(Flight::new());
                state.flight = Some(flight.clone());
                state.status = Status::Refreshing;
                self.publish(&state);
                (flight, true, credential)
            }
        };
        if leader {
            let result = self
                .remote
                .refresh(&credential, &fence)
                .and_then(|session| {
                    fence.check()?;
                    if session.credential.user != credential.user
                        || session.credential.environment != credential.environment
                    {
                        return Err(Error::InvalidCredentials);
                    }
                    self.adopt(&session, &fence)?;
                    Ok(session)
                });
            // Only this generation may clear credentials. A late 401 cannot
            // erase a replacement account or its durable credential.
            if result.as_ref().err() == Some(&Error::InvalidCredentials) && fence.check().is_ok() {
                self.invalidate_credential(&fence);
            } else if let Err(error) = result {
                self.fail(&fence, error);
            }
            let _ = self.update(&fence, |s| {
                if s.flight.as_ref().is_some_and(|f| Arc::ptr_eq(f, &flight)) {
                    s.flight = None;
                }
            });
            *flight.result.lock().unwrap() = Some(result);
            flight.ready.notify_all();
        }
        flight.wait(&fence)
    }
    fn invalidate_credential(&self, fence: &Fence) {
        let mut mutation = self.mutations.lock().unwrap();
        if fence.check().is_err() {
            return;
        }
        let cleared = self.reconcile_store(&mut mutation, true);
        // Revocation fences existing resource consumers even when Keychain fails.
        let mut state = self.state.lock().unwrap();
        if fence.check().is_err() {
            return;
        }
        state.epoch = self.control.advance();
        state.credential = None;
        state.session = None;
        state.flight = None;
        state.logout_pending = cleared.is_err();
        state.error = Some(cleared.err().unwrap_or(Error::InvalidCredentials));
        state.status = if cleared.is_ok() {
            Status::SignedOut
        } else {
            Status::StorageBlocked
        };
        self.publish(&state);
    }
    pub fn sign_out(self: &Arc<Self>) {
        let Ok(fence) = self.begin(Status::SigningOut) else {
            return;
        };
        let broker = self.clone();
        std::thread::spawn(move || {
            let (credential, session) = {
                let mut state = broker.state.lock().unwrap();
                if fence.check().is_err() {
                    return;
                }
                (state.credential.take(), state.session.take())
            };
            let cleared = {
                let mut mutation = broker.mutations.lock().unwrap();
                if fence.check().is_err() {
                    return;
                }
                broker.reconcile_store(&mut mutation, true)
            };
            let _ = broker.update(&fence, |s| {
                s.logout_pending = cleared.is_err();
                s.status = if cleared.is_ok() {
                    Status::SignedOut
                } else {
                    Status::StorageBlocked
                };
                s.error = cleared.err();
            });
            if let Some(credential) = credential {
                let control = Control::new();
                let mut remote_fence = control.fence();
                remote_fence.deadline = Some(Instant::now() + Duration::from_secs(4));
                if broker
                    .remote
                    .logout(&credential, session.as_ref(), &remote_fence)
                    .is_err()
                    && cleared.is_ok()
                {
                    let _ =
                        broker.update(&fence, |s| s.error = Some(Error::RemoteLogoutUnavailable));
                }
            }
        });
    }
    /// Internal native consumer API: no caller receives an access token. Non-read
    /// requests are never automatically replayed, including after a 401.
    pub fn request(&self, binding: &Binding, request: &ApiRequest) -> Result<serde_json::Value> {
        self.request_scoped(binding, request, &super::Cancellation::default())
    }
    pub fn check_binding(&self, binding: &Binding) -> Result<()> {
        self.authorized(binding).map(|_| ())
    }
    pub fn request_scoped(
        &self,
        binding: &Binding,
        request: &ApiRequest,
        cancel: &super::Cancellation,
    ) -> Result<serde_json::Value> {
        let mut fence = self.authorized(binding)?;
        fence.cancel = Some(cancel.clone());
        fence.check()?;
        binding.environment.api_url(&request.path, &request.query)?;
        let session = self.session_for(binding, None)?;
        let _ = self.initialize(&session, &fence);
        fence.check()?;
        let mut result = self.remote.request(&session, request, &fence);
        if result.as_ref().err() == Some(&Error::InvalidCredentials) && request.read_only() {
            let session = self.session_for(binding, Some(&session.access))?;
            result = self.remote.request(&session, request, &fence);
        }
        let valid = fence.check();
        if result.as_ref().err() == Some(&Error::Unavailable) {
            let _ = self.update(&fence, |s| s.status = Status::Offline);
        }
        // A server error or timeout after a mutation was sent is ambiguous.
        let ambiguous_response =
            matches!(result, Err(Error::Response(status, _)) if status >= 500 || status == 408);
        if !request.read_only()
            && (valid.is_err()
                || ambiguous_response
                || matches!(
                    result,
                    Err(Error::Unavailable
                        | Error::SessionChanged
                        | Error::Cancelled
                        | Error::InvalidResponse)
                ))
        {
            return Err(Error::OutcomeUnknown);
        }
        valid?;
        if result.is_ok() {
            self.update(&fence, |s| {
                s.status = Status::Authenticated;
                s.error = None;
            })?;
        }
        result
    }
    pub fn stream(
        &self,
        binding: &Binding,
        request: &ApiRequest,
        cancel: &super::Cancellation,
        sink: &mut super::transport::StreamSink<'_>,
    ) -> Result<()> {
        if request.method != reqwest::Method::GET || request.body.is_some() {
            return Err(Error::Configuration);
        }
        let mut fence = self.authorized(binding)?;
        fence.cancel = Some(cancel.clone());
        fence.check()?;
        let mut session = self.session_for(binding, None)?;
        let mut retried_401 = false;
        loop {
            fence.check()?;
            let result = self.remote.stream(&session, request, &fence, &mut |event| {
                fence.check()?;
                if matches!(event, super::StreamEvent::Connected) {
                    self.update(&fence, |state| {
                        state.status = Status::Authenticated;
                        state.error = None;
                    })?;
                }
                sink(event)
            });
            fence.check()?;
            // Planned renewal is not a transport failure and must not consume
            // the Provider's bounded reconnect budget. Never cross bindings.
            if result == Err(Error::Expired)
                || (result == Err(Error::InvalidCredentials) && !retried_401)
            {
                retried_401 |= result == Err(Error::InvalidCredentials);
                session = self.session_for(binding, Some(&session.access))?;
            } else {
                return result;
            }
        }
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "Native service reconfiguration boundary; no environment editor is added in this stage"
        )
    )]
    pub fn set_environment(&self, environment: Environment) {
        let Ok(fence) = self.begin(Status::SignedOut) else {
            return;
        };
        let _ = self.update(&fence, |s| {
            s.environment = environment;
            s.credential = None;
            s.session = None;
        });
    }
    pub fn shutdown(&self) {
        let mut state = self.state.lock().unwrap();
        state.closing = true;
        self.control.close();
    }
    /// Application close preflight, before GPUI's bounded last-chance quit hook.
    pub fn prepare_close(self: &Arc<Self>) -> async_channel::Receiver<Result<()>> {
        {
            let mut state = self.state.lock().unwrap();
            if !state.closing {
                state.epoch = self.control.advance();
            }
            state.closing = true;
            state.login = None;
            self.publish(&state);
        }
        self.drain_store()
    }
    pub fn shutdown_and_drain(self: &Arc<Self>) -> async_channel::Receiver<Result<()>> {
        self.shutdown();
        self.drain_store()
    }
    fn drain_store(self: &Arc<Self>) -> async_channel::Receiver<Result<()>> {
        let broker = self.clone();
        let (tx, rx) = async_channel::bounded(1);
        std::thread::spawn(move || {
            let mut mutation = broker.mutations.lock().unwrap();
            let logout = broker.state.lock().unwrap().logout_pending;
            let result = broker.reconcile_store(&mut mutation, logout);
            let mut state = broker.state.lock().unwrap();
            if result.is_ok() {
                state.logout_pending = false;
                if logout {
                    state.credential = None;
                    state.session = None;
                    state.status = Status::SignedOut;
                }
            } else if broker.control.fence().check().is_ok() {
                // A failed preflight can be retried; do not irreversibly disable
                // the account owner while the application remains open.
                state.closing = false;
                state.status = Status::StorageBlocked;
                state.error = Some(Error::SecureStorage);
            }
            if broker.control.fence().check().is_ok() {
                broker.publish(&state);
            }
            let _ = tx.send_blocking(result);
        });
        rx
    }
}
