use super::{callback, http::Remote, model::*, service::Broker, store::Store};
use std::sync::{
    Arc, Barrier, Condvar, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant};

type Hook = Arc<dyn Fn() + Send + Sync>;
/// Answers API requests in place of the fixed `{"ok":true}`.
pub(crate) type Responder = Arc<dyn Fn(&ApiRequest) -> Result<serde_json::Value> + Send + Sync>;
#[derive(Default)]
pub(super) struct MemoryStore {
    pub saved: Mutex<Option<Credential>>,
    pub before_save: Mutex<Option<Hook>>,
    pub fail_save: AtomicBool,
    pub fail_clear: AtomicBool,
}
impl Store for MemoryStore {
    fn load(&self) -> Result<Option<Credential>> {
        Ok(self.saved.lock().unwrap().clone())
    }
    fn save(&self, value: &Credential) -> Result<()> {
        let hook = self.before_save.lock().unwrap().clone();
        if let Some(hook) = hook {
            hook();
        }
        if self.fail_save.load(Ordering::SeqCst) {
            return Err(Error::SecureStorage);
        }
        *self.saved.lock().unwrap() = Some(value.clone());
        Ok(())
    }
    fn clear(&self) -> Result<()> {
        if self.fail_clear.load(Ordering::SeqCst) {
            return Err(Error::SecureStorage);
        }
        *self.saved.lock().unwrap() = None;
        Ok(())
    }
}
pub(super) struct FakeRemote {
    pub exchanges: AtomicU64,
    refreshes: AtomicU64,
    requests: AtomicU64,
    inits: AtomicU64,
    expires: AtomicU64,
    refresh_hook: Mutex<Option<Hook>>,
    request_hook: Mutex<Option<Hook>>,
    refresh_error: Mutex<Option<Error>>,
    request_error: Mutex<Option<Error>>,
    reject_access: Mutex<Option<String>>,
    first_requests: Mutex<Option<Arc<Barrier>>>,
    wrong_user: AtomicBool,
    fail_initialize: AtomicBool,
    fail_logout: AtomicBool,
    responder: Mutex<Option<Responder>>,
}
impl Default for FakeRemote {
    fn default() -> Self {
        Self {
            exchanges: AtomicU64::new(0),
            refreshes: AtomicU64::new(0),
            requests: AtomicU64::new(0),
            inits: AtomicU64::new(0),
            expires: AtomicU64::new(3600),
            refresh_hook: Mutex::default(),
            request_hook: Mutex::default(),
            refresh_error: Mutex::default(),
            request_error: Mutex::default(),
            reject_access: Mutex::default(),
            first_requests: Mutex::default(),
            wrong_user: AtomicBool::new(false),
            fail_initialize: AtomicBool::new(false),
            fail_logout: AtomicBool::new(false),
            responder: Mutex::default(),
        }
    }
}
impl FakeRemote {
    fn session(&self, env: &Environment, user: &str, n: u64) -> Session {
        Session::from_reply(
            env.clone(),
            AuthReply {
                user: AuthUser {
                    id: user.into(),
                    email: format!("{user}@example.test"),
                },
                access_token: Secret(format!("private-access-{n}")),
                refresh_token: Secret(format!("private-refresh-{n}")),
                expires_in: self.expires.load(Ordering::SeqCst),
            },
        )
        .unwrap()
    }
}
impl Remote for FakeRemote {
    fn providers(&self, _: &Environment, fence: &Fence) -> Result<()> {
        fence.check()
    }
    fn exchange(&self, env: &Environment, code: &Secret, _: &Secret, _: &Fence) -> Result<Session> {
        self.exchanges.fetch_add(1, Ordering::SeqCst);
        Ok(self.session(env, &code.0, 0))
    }
    fn refresh(&self, credential: &Credential, _: &Fence) -> Result<Session> {
        let n = self.refreshes.fetch_add(1, Ordering::SeqCst) + 1;
        let hook = self.refresh_hook.lock().unwrap().clone();
        if let Some(hook) = hook {
            hook();
        }
        if let Some(error) = *self.refresh_error.lock().unwrap() {
            return Err(error);
        }
        Ok(self.session(
            &credential.environment,
            if self.wrong_user.load(Ordering::SeqCst) {
                "other"
            } else {
                &credential.user
            },
            n,
        ))
    }
    fn logout(&self, _: &Credential, _: Option<&Session>, _: &Fence) -> Result<()> {
        if self.fail_logout.load(Ordering::SeqCst) {
            Err(Error::Unavailable)
        } else {
            Ok(())
        }
    }
    fn initialize(&self, _: &Session, _: &Fence) -> Result<()> {
        self.inits.fetch_add(1, Ordering::SeqCst);
        if self.fail_initialize.load(Ordering::SeqCst) {
            Err(Error::Unavailable)
        } else {
            Ok(())
        }
    }
    fn request(
        &self,
        session: &Session,
        request: &ApiRequest,
        _: &Fence,
    ) -> Result<serde_json::Value> {
        self.requests.fetch_add(1, Ordering::SeqCst);
        let responder = self.responder.lock().unwrap().clone();
        if let Some(responder) = responder {
            return responder(request);
        }
        let hook = self.request_hook.lock().unwrap().clone();
        if let Some(hook) = hook {
            hook();
        }
        let rejected = self.reject_access.lock().unwrap().as_ref() == Some(&session.access.0);
        if rejected {
            let barrier = self.first_requests.lock().unwrap().clone();
            if let Some(barrier) = barrier {
                barrier.wait();
            }
            return Err(Error::InvalidCredentials);
        }
        if let Some(error) = *self.request_error.lock().unwrap() {
            return Err(error);
        }
        Ok(serde_json::json!({"ok":true}))
    }
}
#[derive(Default)]
struct Gate {
    entered: (Mutex<bool>, Condvar),
    released: (Mutex<bool>, Condvar),
}
impl Gate {
    fn block(&self) {
        *self.entered.0.lock().unwrap() = true;
        self.entered.1.notify_all();
        let lock = self.released.0.lock().unwrap();
        let (lock, _) = self
            .released
            .1
            .wait_timeout_while(lock, Duration::from_secs(5), |v| !*v)
            .unwrap();
        assert!(*lock, "controlled operation was not released");
    }
    fn entered(&self) {
        let lock = self.entered.0.lock().unwrap();
        let (lock, _) = self
            .entered
            .1
            .wait_timeout_while(lock, Duration::from_secs(4), |v| !*v)
            .unwrap();
        assert!(*lock, "controlled operation did not start");
    }
    fn release(&self) {
        *self.released.0.lock().unwrap() = true;
        self.released.1.notify_all();
    }
}
pub(super) fn env() -> Environment {
    Environment::new("http://127.0.0.1:18080/api/v1", "http://127.0.0.1:13000").unwrap()
}
fn setup() -> (Arc<Broker>, Arc<FakeRemote>, Arc<MemoryStore>) {
    let remote = Arc::new(FakeRemote::default());
    let store = Arc::new(MemoryStore::default());
    let broker = Broker::new(env(), remote.clone(), store.clone()).0;
    (broker, remote, store)
}
fn login(broker: &Broker, user: &str) -> Result<()> {
    broker.complete_login(
        env(),
        callback::Input::Code(Secret(user.into())),
        &Secret("verifier".into()),
        &broker.control.fence(),
    )
}
pub(crate) fn account_fixture() -> (
    Arc<Broker>,
    async_channel::Receiver<super::service::BrowserEvent>,
) {
    let pair = Broker::new(
        env(),
        Arc::new(FakeRemote::default()),
        Arc::new(MemoryStore::default()),
    );
    login(&pair.0, "alice").unwrap();
    pair
}
/// A signed-in account whose API answers come from `responder`.
pub(crate) fn responding_account_fixture(
    responder: Responder,
) -> (
    Arc<Broker>,
    async_channel::Receiver<super::service::BrowserEvent>,
) {
    let remote = FakeRemote::default();
    *remote.responder.lock().unwrap() = Some(responder);
    let pair = Broker::new(env(), Arc::new(remote), Arc::new(MemoryStore::default()));
    login(&pair.0, "alice").unwrap();
    pair
}
pub(crate) fn protocol_fixture(environment: Environment) -> (Arc<Broker>, Binding) {
    let broker = Broker::new(
        environment.clone(),
        Arc::new(super::http::Http::new().unwrap()),
        Arc::new(MemoryStore::default()),
    )
    .0;
    broker
        .complete_login(
            environment,
            callback::Input::Code(Secret("synthetic-code".into())),
            &Secret("synthetic-verifier".into()),
            &broker.control.fence(),
        )
        .unwrap();
    let binding = binding(&broker);
    (broker, binding)
}
fn snapshot(broker: &Broker) -> Snapshot {
    broker.subscribe().borrow().clone()
}
fn binding(broker: &Broker) -> Binding {
    snapshot(broker).account.unwrap().binding
}
fn request(method: reqwest::Method) -> ApiRequest {
    ApiRequest {
        method,
        path: "/projects/p/workbench".into(),
        query: Vec::new(),
        body: None,
    }
}
pub(super) fn wait(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(4);
    while !predicate() {
        assert!(Instant::now() < deadline, "operation did not settle");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn configuration_is_explicit_credential_free_and_root_closed() {
    use super::store::profile_account;
    use std::ffi::OsStr;
    assert_ne!(
        profile_account(None),
        profile_account(Some(OsStr::new("default")))
    );
    assert_ne!(
        profile_account(Some(OsStr::new("a"))),
        profile_account(Some(OsStr::new("b")))
    );
    assert_eq!(
        profile_account(Some(OsStr::new("a"))),
        profile_account(Some(OsStr::new("a")))
    );
    for api in [
        "http://puppyone.ai/api/v1",
        "https://evil.test/api/v1",
        "https://puppyone.ai.evil.test/api/v1",
        "https://user:secret@puppyone.ai/api/v1",
        "https://puppyone.ai/api/v1?token=x",
        "https://puppyone.ai/api/v1#secret",
        "https://puppyone.ai/v2",
    ] {
        assert!(Environment::new(api, "https://www.puppyone.ai").is_err());
    }
    assert!(
        Environment::new(
            "https://api.puppyone.ai/api/v1",
            "https://www.puppyone.ai/login"
        )
        .is_err()
    );
    for path in [
        "//evil.test",
        "/../auth",
        "/projects/%2e%2e",
        "/foo?x=1",
        "/a\\b",
    ] {
        assert!(env().api_url(path, &[]).is_err());
    }
    assert_eq!(
        callback::challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}
#[test]
fn twenty_requests_share_refresh_and_initialization_without_exposing_secrets() {
    let (broker, remote, _) = setup();
    remote.expires.store(60, Ordering::SeqCst);
    login(&broker, "alice").unwrap();
    remote.expires.store(3600, Ordering::SeqCst);
    let gate = Arc::new(Gate::default());
    let g = gate.clone();
    *remote.refresh_hook.lock().unwrap() = Some(Arc::new(move || g.block()));
    let start = Arc::new(Barrier::new(21));
    let binding = binding(&broker);
    let threads: Vec<_> = (0..20)
        .map(|_| {
            let (broker, binding, start) = (broker.clone(), binding.clone(), start.clone());
            std::thread::spawn(move || {
                start.wait();
                broker.request(&binding, &request(reqwest::Method::GET))
            })
        })
        .collect();
    start.wait();
    gate.entered();
    gate.release();
    for thread in threads {
        assert!(thread.join().unwrap().is_ok());
    }
    assert_eq!(remote.refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(remote.inits.load(Ordering::SeqCst), 1);
    let public = format!("{:?}", snapshot(&broker));
    assert!(!public.contains("private-access") && !public.contains("private-refresh"));
}
#[test]
fn simultaneous_old_token_401s_reuse_the_new_token() {
    let (broker, remote, _) = setup();
    login(&broker, "alice").unwrap();
    *remote.reject_access.lock().unwrap() = Some("private-access-0".into());
    *remote.first_requests.lock().unwrap() = Some(Arc::new(Barrier::new(20)));
    let binding = binding(&broker);
    let threads: Vec<_> = (0..20)
        .map(|_| {
            let (broker, binding) = (broker.clone(), binding.clone());
            std::thread::spawn(move || broker.request(&binding, &request(reqwest::Method::GET)))
        })
        .collect();
    for thread in threads {
        assert!(thread.join().unwrap().is_ok());
    }
    assert_eq!(remote.refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(remote.requests.load(Ordering::SeqCst), 40);
}
#[test]
fn offline_restore_keeps_identity_and_invalid_refresh_revokes_it() {
    let (broker, remote, store) = setup();
    login(&broker, "alice").unwrap();
    let restored = Broker::new(env(), remote.clone(), store.clone()).0;
    *remote.refresh_error.lock().unwrap() = Some(Error::Unavailable);
    restored.restore();
    wait(|| snapshot(&restored).status == Status::Offline);
    assert_eq!(binding(&restored).user, "alice");
    assert!(store.load().unwrap().is_some());
    *remote.refresh_error.lock().unwrap() = Some(Error::InvalidCredentials);
    restored.restore();
    wait(|| {
        snapshot(&restored).account.is_none() && snapshot(&restored).status == Status::SignedOut
    });
    assert!(store.load().unwrap().is_none());
}
#[test]
fn logout_and_account_switch_fence_a_late_failed_refresh() {
    let (broker, remote, store) = setup();
    remote.expires.store(60, Ordering::SeqCst);
    login(&broker, "alice").unwrap();
    let gate = Arc::new(Gate::default());
    let g = gate.clone();
    *remote.refresh_hook.lock().unwrap() = Some(Arc::new(move || g.block()));
    *remote.refresh_error.lock().unwrap() = Some(Error::InvalidCredentials);
    let old = binding(&broker);
    let copy = broker.clone();
    let pending = std::thread::spawn(move || copy.request(&old, &request(reqwest::Method::GET)));
    gate.entered();
    broker.sign_out();
    wait(|| snapshot(&broker).status == Status::SignedOut);
    remote.expires.store(3600, Ordering::SeqCst);
    login(&broker, "bob").unwrap();
    gate.release();
    assert_eq!(pending.join().unwrap().err(), Some(Error::SessionChanged));
    assert_eq!(binding(&broker).user, "bob");
    assert_eq!(store.load().unwrap().unwrap().user, "bob");
}
#[test]
fn a_late_keychain_write_is_rolled_back_before_new_account_commit() {
    let (broker, _, store) = setup();
    login(&broker, "alice").unwrap();
    let gate = Arc::new(Gate::default());
    let g = gate.clone();
    *store.before_save.lock().unwrap() = Some(Arc::new(move || g.block()));
    let b = broker.clone();
    let pending = std::thread::spawn(move || login(&b, "bob"));
    gate.entered();
    broker.cancel();
    *store.before_save.lock().unwrap() = None;
    gate.release();
    assert_eq!(pending.join().unwrap().err(), Some(Error::SessionChanged));
    assert_eq!(store.load().unwrap().unwrap().user, "alice");
    login(&broker, "carol").unwrap();
    assert_eq!(store.load().unwrap().unwrap().user, "carol");
}
#[test]
fn shutdown_drains_staged_credentials_and_cannot_resurrect_sign_in() {
    let (broker, _, store) = setup();
    let gate = Arc::new(Gate::default());
    let g = gate.clone();
    *store.before_save.lock().unwrap() = Some(Arc::new(move || g.block()));
    let b = broker.clone();
    let pending = std::thread::spawn(move || login(&b, "alice"));
    gate.entered();
    let drained = broker.shutdown_and_drain();
    assert!(drained.try_recv().is_err());
    *store.before_save.lock().unwrap() = None;
    gate.release();
    drained.recv_blocking().unwrap().unwrap();
    assert_eq!(pending.join().unwrap().err(), Some(Error::SessionChanged));
    assert!(store.load().unwrap().is_none());
    assert!(snapshot(&broker).account.is_none());
}
#[test]
fn vault_failure_does_not_publish_authenticated_or_hide_failed_logout() {
    let (broker, _, store) = setup();
    store.fail_save.store(true, Ordering::SeqCst);
    assert_eq!(login(&broker, "alice").err(), Some(Error::SecureStorage));
    assert!(snapshot(&broker).account.is_none());
    store.fail_save.store(false, Ordering::SeqCst);
    login(&broker, "alice").unwrap();
    let old = binding(&broker);
    store.fail_clear.store(true, Ordering::SeqCst);
    broker.sign_out();
    wait(|| snapshot(&broker).status == Status::StorageBlocked);
    assert_eq!(
        broker.request(&old, &request(reqwest::Method::GET)).err(),
        Some(Error::SessionChanged)
    );
    store.fail_clear.store(false, Ordering::SeqCst);
    broker.sign_out();
    wait(|| snapshot(&broker).status == Status::SignedOut);
    assert!(store.load().unwrap().is_none());
}
#[test]
fn wrong_account_refresh_and_changed_environment_never_retarget_a_lease() {
    let (broker, remote, store) = setup();
    remote.expires.store(60, Ordering::SeqCst);
    login(&broker, "alice").unwrap();
    remote.wrong_user.store(true, Ordering::SeqCst);
    let old = binding(&broker);
    assert!(
        broker
            .request(&old, &request(reqwest::Method::GET))
            .is_err()
    );
    assert!(store.load().unwrap().is_none());
    remote.expires.store(3600, Ordering::SeqCst);
    login(&broker, "alice").unwrap();
    let old = binding(&broker);
    broker.set_environment(
        Environment::new("http://localhost:19000/api/v1", "http://localhost:13000").unwrap(),
    );
    assert_eq!(
        broker.request(&old, &request(reqwest::Method::GET)).err(),
        Some(Error::SessionChanged)
    );
    assert!(snapshot(&broker).account.is_none());
}
#[test]
fn mutation_transport_errors_are_unknown_and_never_replayed() {
    let (broker, remote, _) = setup();
    login(&broker, "alice").unwrap();
    let binding = binding(&broker);
    *remote.request_error.lock().unwrap() = Some(Error::Unavailable);
    assert_eq!(
        broker
            .request(&binding, &request(reqwest::Method::PUT))
            .err(),
        Some(Error::OutcomeUnknown)
    );
    assert_eq!(remote.requests.load(Ordering::SeqCst), 1);
    *remote.request_error.lock().unwrap() = Some(Error::InvalidCredentials);
    assert_eq!(
        broker
            .request(&binding, &request(reqwest::Method::POST))
            .err(),
        Some(Error::InvalidCredentials)
    );
    assert_eq!(remote.requests.load(Ordering::SeqCst), 2);
    assert_eq!(remote.refreshes.load(Ordering::SeqCst), 0);
}
#[test]
fn uncertain_response_is_not_replayed_and_success_recovers_offline_projection() {
    let (broker, remote, _) = setup();
    login(&broker, "alice").unwrap();
    let binding = binding(&broker);
    *remote.request_error.lock().unwrap() = Some(Error::InvalidResponse);
    assert_eq!(
        broker
            .request(&binding, &request(reqwest::Method::PUT))
            .err(),
        Some(Error::OutcomeUnknown)
    );
    assert_eq!(remote.requests.load(Ordering::SeqCst), 1);
    *remote.request_error.lock().unwrap() = Some(Error::Unavailable);
    assert!(
        broker
            .request(&binding, &request(reqwest::Method::GET))
            .is_err()
    );
    assert_eq!(snapshot(&broker).status, Status::Offline);
    *remote.request_error.lock().unwrap() = None;
    assert!(
        broker
            .request(&binding, &request(reqwest::Method::GET))
            .is_ok()
    );
    assert_eq!(snapshot(&broker).status, Status::Authenticated);
}
#[test]
fn failed_remote_logout_does_not_keep_local_credentials_or_pretend_remote_revocation() {
    let (broker, remote, store) = setup();
    login(&broker, "alice").unwrap();
    remote.fail_logout.store(true, Ordering::SeqCst);
    broker.sign_out();
    wait(|| snapshot(&broker).error == Some(Error::RemoteLogoutUnavailable));
    assert_eq!(snapshot(&broker).status, Status::SignedOut);
    assert!(store.load().unwrap().is_none());
}

#[test]
fn late_read_is_discarded_and_late_write_reports_unknown() {
    for method in [reqwest::Method::GET, reqwest::Method::PUT] {
        let (broker, remote, _) = setup();
        login(&broker, "alice").unwrap();
        let gate = Arc::new(Gate::default());
        let g = gate.clone();
        *remote.request_hook.lock().unwrap() = Some(Arc::new(move || g.block()));
        let old = binding(&broker);
        let b = broker.clone();
        let writing = method == reqwest::Method::PUT;
        let pending = std::thread::spawn(move || b.request(&old, &request(method)));
        gate.entered();
        broker.cancel();
        gate.release();
        assert_eq!(
            pending.join().unwrap().err(),
            Some(if writing {
                Error::OutcomeUnknown
            } else {
                Error::SessionChanged
            })
        );
    }
}
#[test]
fn failed_business_initialization_does_not_undo_sign_in_and_retries_once_needed() {
    let (broker, remote, _) = setup();
    remote.fail_initialize.store(true, Ordering::SeqCst);
    login(&broker, "alice").unwrap();
    assert_eq!(snapshot(&broker).status, Status::Authenticated);
    remote.fail_initialize.store(false, Ordering::SeqCst);
    broker
        .request(&binding(&broker), &request(reqwest::Method::GET))
        .unwrap();
    broker
        .request(&binding(&broker), &request(reqwest::Method::GET))
        .unwrap();
    assert_eq!(remote.inits.load(Ordering::SeqCst), 2);
}

#[test]
fn expiry_finishes_the_public_attempt_and_retires_queued_browser_actions() {
    let remote = Arc::new(FakeRemote::default());
    let (broker, browser) = Broker::new(env(), remote, Arc::new(MemoryStore::default()));
    broker.sign_in_until(Instant::now() + Duration::from_secs(1));
    let mut event = None;
    wait(|| {
        event = browser.try_recv().ok();
        event.is_some()
    });
    let event = event.unwrap();
    assert!(broker.browser_current(&event));
    wait(|| snapshot(&broker).error == Some(Error::Expired));
    assert_eq!(snapshot(&broker).status, Status::SignedOut);
    assert!(!snapshot(&broker).can_reopen && !broker.browser_current(&event));
    broker.shutdown();
}
#[test]
fn retry_performs_network_validation_even_when_old_access_token_is_not_expired() {
    let (broker, remote, _) = setup();
    login(&broker, "alice").unwrap();
    *remote.refresh_error.lock().unwrap() = Some(Error::Unavailable);
    broker.restore();
    wait(|| snapshot(&broker).status == Status::Offline);
    assert_eq!(remote.refreshes.load(Ordering::SeqCst), 1);
    *remote.refresh_error.lock().unwrap() = None;
    broker.restore();
    wait(|| snapshot(&broker).status == Status::Authenticated);
    assert_eq!(remote.refreshes.load(Ordering::SeqCst), 2);
}
#[test]
fn restoring_a_changed_vault_cannot_pair_another_identity_with_the_old_access_token() {
    let (broker, remote, store) = setup();
    login(&broker, "alice").unwrap();
    let old = binding(&broker);
    store
        .save(&remote.session(&env(), "bob", 9).credential)
        .unwrap();
    broker.restore();
    wait(|| snapshot(&broker).error == Some(Error::SessionChanged));
    assert!(snapshot(&broker).account.is_none());
    assert_eq!(
        broker.request(&old, &request(reqwest::Method::GET)).err(),
        Some(Error::SessionChanged)
    );
    assert_eq!(
        store.load().unwrap().unwrap().user,
        "bob",
        "Do not erase another writer's credential"
    );
}
#[test]
fn quitting_immediately_after_logout_still_clears_the_saved_sign_in() {
    let (broker, _, store) = setup();
    login(&broker, "alice").unwrap();
    broker.sign_out();
    broker
        .shutdown_and_drain()
        .recv_blocking()
        .unwrap()
        .unwrap();
    assert!(store.load().unwrap().is_none());
}

#[test]
fn close_preflight_waits_for_slow_vault_work_before_framework_shutdown() {
    let (broker, _, store) = setup();
    let gate = Arc::new(Gate::default());
    let g = gate.clone();
    *store.before_save.lock().unwrap() = Some(Arc::new(move || g.block()));
    let b = broker.clone();
    let pending = std::thread::spawn(move || login(&b, "alice"));
    gate.entered();
    let closed = broker.prepare_close();
    // GPUI's 200ms last-chance hook must not be the credential-write barrier.
    std::thread::sleep(Duration::from_millis(250));
    assert!(closed.try_recv().is_err());
    *store.before_save.lock().unwrap() = None;
    gate.release();
    closed.recv_blocking().unwrap().unwrap();
    assert_eq!(pending.join().unwrap().err(), Some(Error::SessionChanged));
    assert!(store.load().unwrap().is_none());
    broker.shutdown();
}
#[test]
fn failed_rollback_blocks_close_until_cleanup_succeeds() {
    let (broker, _, store) = setup();
    let gate = Arc::new(Gate::default());
    let g = gate.clone();
    *store.before_save.lock().unwrap() = Some(Arc::new(move || g.block()));
    let b = broker.clone();
    let pending = std::thread::spawn(move || login(&b, "alice"));
    gate.entered();
    broker.cancel();
    store.fail_clear.store(true, Ordering::SeqCst);
    *store.before_save.lock().unwrap() = None;
    gate.release();
    assert_eq!(pending.join().unwrap().err(), Some(Error::SecureStorage));
    assert_eq!(snapshot(&broker).status, Status::StorageBlocked);
    assert_eq!(
        broker.prepare_close().recv_blocking().unwrap(),
        Err(Error::SecureStorage)
    );
    store.fail_clear.store(false, Ordering::SeqCst);
    broker.prepare_close().recv_blocking().unwrap().unwrap();
    assert!(store.load().unwrap().is_none());
    broker.shutdown();
}
#[test]
fn ordinary_successful_requests_do_not_invalidate_unchanged_public_ui_state() {
    let (broker, _, _) = setup();
    login(&broker, "alice").unwrap();
    let mut updates = broker.subscribe();
    drop(updates.borrow_and_update());
    for _ in 0..20 {
        broker
            .request(&binding(&broker), &request(reqwest::Method::GET))
            .unwrap();
    }
    assert!(!updates.has_changed().unwrap());
    broker.shutdown();
}

#[test]
fn normal_close_preserves_an_accepted_login_instead_of_treating_it_as_logout() {
    let (broker, _, store) = setup();
    login(&broker, "alice").unwrap();
    broker.prepare_close().recv_blocking().unwrap().unwrap();
    assert_eq!(store.load().unwrap().unwrap().user, "alice");
    assert!(
        broker
            .request(&binding(&broker), &request(reqwest::Method::GET))
            .is_err()
    );
    broker.shutdown();
}

fn form(host: &str, origin: &str, body: &str) -> Vec<u8> {
    format!("POST /auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{body}", body.len()).into_bytes()
}
#[test]
fn callback_parser_rejects_host_origin_duplicates_framing_and_token_urls() {
    let host = "127.0.0.1:1234";
    let origin = "https://www.puppyone.ai";
    assert!(matches!(
        callback::parse(
            &form(host, origin, "state=s&refresh_token=t"),
            host,
            origin,
            "s"
        ),
        Ok(Some(callback::Input::Refresh(_)))
    ));
    for body in [
        "state=bad&refresh_token=t",
        "state=s&state=s&refresh_token=t",
        "state=s&refresh_token=t&refresh_token=t",
        "state=s&refresh_token=",
        "state=s&refresh_token=t&user_id=trusted",
    ] {
        assert!(callback::parse(&form(host, origin, body), host, origin, "s").is_err());
    }
    assert!(
        callback::parse(
            &form("evil.test", origin, "state=s&refresh_token=t"),
            host,
            origin,
            "s"
        )
        .is_err()
    );
    assert!(
        callback::parse(
            &form(host, "https://evil.test", "state=s&refresh_token=t"),
            host,
            origin,
            "s"
        )
        .is_err()
    );
    let valid = String::from_utf8(form(host, origin, "state=s&refresh_token=t")).unwrap();
    for extra in [
        "Host: 127.0.0.1:1234\r\n",
        "Transfer-Encoding: chunked\r\n",
        "Content-Length: 22\r\n",
    ] {
        let raw = valid.replacen("Origin:", &format!("{extra}Origin:"), 1);
        assert!(callback::parse(raw.as_bytes(), host, origin, "s").is_err());
    }
    for query in [
        "state=s&access_token=leak",
        "state=s&code=c&refresh_token=leak",
        "state=s&code=c&code=c",
        "state=s&error=denied&code=c&code=c",
        "state=s&error=denied&error_description=x&error_description=y",
        "state=s&code=c#hash",
    ] {
        let raw = format!("GET /auth/callback?{query} HTTP/1.1\r\nHost: {host}\r\n\r\n");
        assert!(callback::parse(raw.as_bytes(), host, origin, "s").is_err());
    }
    let raw = form(
        host,
        origin,
        &format!("state=s&refresh_token={}", "a".repeat(17000)),
    );
    assert_eq!(callback::parse(&raw, host, origin, "s").err(), Some(413));
}
