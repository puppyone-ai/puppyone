//! Account doubles: an in-memory credential store, a scripted remote and
//! signed-in brokers, for these tests and the window's (`test-support`).
use super::{callback, http::Remote, model::*, service::Broker, store::Store};
use std::sync::{
    Arc, Barrier, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

type Hook = Arc<dyn Fn() + Send + Sync>;
/// Answers API requests in place of the fixed `{"ok":true}`.
pub type Responder = Arc<dyn Fn(&ApiRequest) -> Result<serde_json::Value> + Send + Sync>;
/// Answers ticketed screen WebSocket opens in tests.
pub type ScreenResponder =
    Arc<dyn Fn(&url::Url, (&str, &str)) -> Result<super::ScreenSocket> + Send + Sync>;
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
    pub refreshes: AtomicU64,
    pub requests: AtomicU64,
    pub inits: AtomicU64,
    pub providers_calls: AtomicU64,
    pub expires: AtomicU64,
    pub providers_hook: Mutex<Option<Hook>>,
    pub refresh_hook: Mutex<Option<Hook>>,
    pub request_hook: Mutex<Option<Hook>>,
    pub logout_hook: Mutex<Option<Hook>>,
    pub providers_error: Mutex<Option<Error>>,
    pub refresh_error: Mutex<Option<Error>>,
    pub request_error: Mutex<Option<Error>>,
    pub reject_access: Mutex<Option<String>>,
    pub first_requests: Mutex<Option<Arc<Barrier>>>,
    pub wrong_user: AtomicBool,
    pub fail_initialize: AtomicBool,
    pub fail_logout: AtomicBool,
    pub responder: Mutex<Option<Responder>>,
    pub screen_responder: Mutex<Option<ScreenResponder>>,
    pub keep_workspace_events: bool,
}
impl Default for FakeRemote {
    fn default() -> Self {
        Self {
            exchanges: AtomicU64::new(0),
            refreshes: AtomicU64::new(0),
            requests: AtomicU64::new(0),
            inits: AtomicU64::new(0),
            providers_calls: AtomicU64::new(0),
            expires: AtomicU64::new(3600),
            providers_hook: Mutex::default(),
            refresh_hook: Mutex::default(),
            request_hook: Mutex::default(),
            providers_error: Mutex::default(),
            refresh_error: Mutex::default(),
            request_error: Mutex::default(),
            reject_access: Mutex::default(),
            first_requests: Mutex::default(),
            wrong_user: AtomicBool::new(false),
            fail_initialize: AtomicBool::new(false),
            fail_logout: AtomicBool::new(false),
            logout_hook: Mutex::default(),
            responder: Mutex::default(),
            screen_responder: Mutex::default(),
            keep_workspace_events: false,
        }
    }
}
impl FakeRemote {
    pub(super) fn session(&self, env: &Environment, user: &str, n: u64) -> Session {
        Session::from_reply(
            env.clone(),
            AuthReply {
                user: Some(AuthUser {
                    id: Some(user.into()),
                    email: Some(format!("{user}@example.test")),
                }),
                access_token: Secret(format!("private-access-{n}")),
                refresh_token: Some(Secret(format!("private-refresh-{n}"))),
                expires_in: Some(self.expires.load(Ordering::SeqCst) as f64),
                user_id: None,
                user_email: None,
            },
        )
        .unwrap()
    }
}
impl Remote for FakeRemote {
    fn providers(&self, _: &Environment, fence: &Fence) -> Result<()> {
        self.providers_calls.fetch_add(1, Ordering::SeqCst);
        let hook = self.providers_hook.lock().unwrap().clone();
        if let Some(hook) = hook {
            hook();
        }
        fence.check()?;
        if let Some(error) = *self.providers_error.lock().unwrap() {
            return Err(error);
        }
        Ok(())
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
    fn public(&self, _: &Environment, path: &str, _: &Fence) -> Result<serde_json::Value> {
        let responder = self.responder.lock().unwrap().clone();
        match responder {
            Some(responder) => responder(&ApiRequest {
                idempotency_key: None,
                method: reqwest::Method::GET,
                path: path.into(),
                query: vec![],
                body: None,
            }),
            None => Ok(serde_json::json!({})),
        }
    }
    fn logout(&self, _: &Credential, _: Option<&Session>, _: &Fence) -> Result<()> {
        let hook = self.logout_hook.lock().unwrap().clone();
        if let Some(hook) = hook {
            hook();
        }
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
    fn stream(
        &self,
        _: &Session,
        request: &ApiRequest,
        fence: &Fence,
        sink: &mut super::transport::StreamSink<'_>,
    ) -> Result<()> {
        if !self.keep_workspace_events || !request.path.ends_with("/workbench/events") {
            return Err(Error::Unsupported);
        }
        fence.check()?;
        sink(super::transport::StreamEvent::Connected)?;
        // A screen fixture also owns a live file subscription. An unsupported
        // stream would retire the real Cloud provider before a file can open.
        loop {
            fence.check()?;
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    fn screen_stream(
        &self,
        url: &url::Url,
        protocols: (&str, &str),
        fence: &Fence,
    ) -> Result<super::ScreenSocket> {
        fence.check()?;
        let responder = self.screen_responder.lock().unwrap().clone();
        match responder {
            Some(responder) => responder(url, protocols),
            None => Err(Error::Unsupported),
        }
    }
}
pub(super) fn env() -> Environment {
    Environment::new("http://127.0.0.1:18080/api/v1", "http://127.0.0.1:13000").unwrap()
}
pub(super) fn login(broker: &Broker, user: &str) -> Result<()> {
    broker.complete_login(
        env(),
        callback::Input::Code(Secret(user.into())),
        &Secret("verifier".into()),
        &broker.control.fence(),
    )
}
/// Signs `user` in again on a fixture broker (the browser round trip done).
pub fn relogin(broker: &Broker, user: &str) {
    login(broker, user).unwrap();
}
/// Controls a signed-out fixture broker's browser sign-in without opening a
/// loopback socket.
pub struct SignInControl {
    broker: Arc<Broker>,
    remote: Arc<FakeRemote>,
    held: Arc<(Mutex<bool>, std::sync::Condvar)>,
}
impl SignInControl {
    pub fn starts(&self) -> u64 {
        self.remote.providers_calls.load(Ordering::SeqCst)
    }
    /// Holds the next `sign_in` in `Status::SigningIn` until [`Self::fail`] or
    /// [`Self::complete`].
    pub fn hold(&self) {
        *self.held.0.lock().unwrap() = true;
    }
    pub fn fail(&self, error: Error) {
        *self.remote.providers_error.lock().unwrap() = Some(error);
        *self.held.0.lock().unwrap() = false;
        self.held.1.notify_all();
    }
    pub fn complete(&self, user: &str) {
        *self.remote.providers_error.lock().unwrap() = None;
        self.broker.control.advance();
        *self.held.0.lock().unwrap() = false;
        self.held.1.notify_all();
        login(&self.broker, user).unwrap();
    }
}
impl Drop for SignInControl {
    fn drop(&mut self) {
        *self.held.0.lock().unwrap() = false;
        self.held.1.notify_all();
    }
}
pub fn sign_in_fixture() -> (
    Arc<Broker>,
    async_channel::Receiver<super::service::BrowserEvent>,
    Arc<SignInControl>,
) {
    let remote = Arc::new(FakeRemote::default());
    let held = Arc::new((Mutex::new(true), std::sync::Condvar::new()));
    let gate = held.clone();
    *remote.providers_hook.lock().unwrap() = Some(Arc::new(move || {
        let lock = gate.0.lock().unwrap();
        let _ = gate
            .1
            .wait_timeout_while(lock, std::time::Duration::from_secs(5), |v| *v);
    }));
    let (broker, browser) = Broker::new(env(), remote.clone(), Arc::new(MemoryStore::default()));
    let control = Arc::new(SignInControl {
        broker: broker.clone(),
        remote,
        held,
    });
    (broker, browser, control)
}
pub fn account_fixture() -> (
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
pub fn responding_account_fixture(
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
/// A signed-in account whose API and screen-stream answers come from test responders.
pub fn responding_screen_account_fixture(
    responder: Responder,
    screen: ScreenResponder,
) -> (
    Arc<Broker>,
    async_channel::Receiver<super::service::BrowserEvent>,
) {
    let remote = FakeRemote {
        keep_workspace_events: true,
        ..Default::default()
    };
    *remote.responder.lock().unwrap() = Some(responder);
    *remote.screen_responder.lock().unwrap() = Some(screen);
    let pair = Broker::new(env(), Arc::new(remote), Arc::new(MemoryStore::default()));
    login(&pair.0, "alice").unwrap();
    pair
}
pub fn protocol_fixture(environment: Environment) -> (Arc<Broker>, Binding) {
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
pub(super) fn snapshot(broker: &Broker) -> Snapshot {
    broker.subscribe().borrow().clone()
}
pub(super) fn binding(broker: &Broker) -> Binding {
    snapshot(broker).account.unwrap().binding
}
/// A broker signed in as a real account from its refresh token, over the
/// real transport: acceptance against a deployment, never a unit test.
pub fn refresh_token_broker(
    api: &str,
    web: &str,
    user: &str,
    email: &str,
    refresh: &str,
) -> Arc<Broker> {
    let environment = Environment::new(api, web).expect("acceptance environment");
    let store = MemoryStore::default();
    *store.saved.lock().unwrap() = Some(Credential {
        version: 1,
        environment: environment.clone(),
        user: user.into(),
        email: email.into(),
        refresh: Secret(refresh.into()),
    });
    let broker = Broker::new(
        environment,
        Arc::new(super::http::Http::new().expect("HTTP")),
        Arc::new(store),
    )
    .0;
    broker.restore();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let snapshot = broker.subscribe().borrow().clone();
        if snapshot.status == Status::Authenticated && broker.signed_in_binding().is_some() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the account did not restore: {:?} {:?}",
            snapshot.status,
            snapshot.error
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    broker
}
