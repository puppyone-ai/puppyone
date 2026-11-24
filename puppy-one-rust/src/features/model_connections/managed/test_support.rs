//! Tests: a scripted compute gateway whose answers a test can hold back,
//! fail or let through, as the product's `managedConnection` fixture
//! answers.
use super::*;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
};

pub(crate) type Reply = Result<Value, Failed>;
/// A request the service did not answer.
pub(crate) fn failed() -> Reply {
    Err(Failed)
}

/// The service as the product's fixture answers it.
pub(crate) struct World {
    pub(crate) session: Option<Session>,
    pub(crate) trial: i64,
    pub(crate) trial_granted: i64,
    pub(crate) balance: i64,
    pub(crate) catalog: Option<Value>,
    pub(crate) checkout_url: String,
    pub(crate) usage: Option<Value>,
    pub(crate) sign_in_starts: bool,
    /// Browser sign-ins asked for.
    pub(crate) sign_ins: usize,
    pub(crate) calls: Vec<String>,
    pub(crate) held: HashMap<String, VecDeque<async_channel::Receiver<Reply>>>,
    pub(crate) opened: Vec<String>,
}
pub(crate) type Shared = Arc<Mutex<World>>;

pub(crate) fn session(user: &str) -> Session {
    Session {
        key: format!("{user}\nsession-{user}\nhttps://qubits-api.puppyone.ai/api/v1"),
        user: user.into(),
    }
}

pub(crate) fn world(signed_in: bool) -> Shared {
    Arc::new(Mutex::new(World {
        session: signed_in.then(|| session("user-one")),
        trial: 0,
        trial_granted: 0,
        balance: 5_000_000,
        catalog: None,
        checkout_url: "https://sandbox.polar.sh/checkout/test".into(),
        usage: None,
        sign_in_starts: true,
        sign_ins: 0,
        calls: Vec::new(),
        held: HashMap::new(),
        opened: Vec::new(),
    }))
}

impl World {
    fn wallet(&self) -> Value {
        serde_json::json!({
            "balance_micro_usd": self.balance,
            "available_micro_usd": self.balance,
            "reserved_micro_usd": 0,
            "trial_granted_micro_usd": self.trial_granted,
        })
    }
    pub(crate) fn reply(&mut self, path: &str) -> Reply {
        Ok(match path {
            "/ai/catalog" => self.catalog.clone().unwrap_or_else(|| {
                serde_json::json!({
                    "sandbox": true,
                    "trial_credit_micro_usd": self.trial,
                    "packs": [{"id": "test-credit", "price_cents": 500}],
                    "models": [{"id": "test/model", "name": "Test", "context_window": 32768}],
                })
            }),
            "/ai/balance" => self.wallet(),
            "/ai/trial" => {
                self.trial_granted = self.trial;
                self.wallet()
            }
            "/ai/checkouts" => serde_json::json!({"checkout_url": self.checkout_url}),
            usage if usage.starts_with("/ai/usage/") => self.usage.clone().ok_or(Failed)?,
            _ => return Err(Failed),
        })
    }
}

struct Fake(Shared);
impl Fake {
    /// A call is made, and logged, when its request runs.
    fn answer(&self, call: String, path: &str) -> Answer {
        let (world, path) = (self.0.clone(), path.to_owned());
        Box::pin(async move {
            let held = {
                let mut world = world.lock().unwrap();
                world.calls.push(call);
                world.held.get_mut(&path).and_then(VecDeque::pop_front)
            };
            match held {
                Some(held) => held.recv().await.unwrap_or(Err(Failed)),
                None => world.lock().unwrap().reply(&path),
            }
        })
    }
}
impl Gateway for Fake {
    fn public(&self, path: &str) -> Answer {
        self.answer(format!("public {path}"), path)
    }
    fn request(&self, method: Method, path: &str, _: Option<Value>, _: Option<String>) -> Answer {
        self.answer(format!("{method} {path}"), path)
    }
}

/// The next call to `path` waits for the returned sender.
pub(crate) fn hold(world: &Shared, path: &str) -> async_channel::Sender<Reply> {
    let (tx, rx) = async_channel::bounded(1);
    world
        .lock()
        .unwrap()
        .held
        .entry(path.into())
        .or_default()
        .push_back(rx);
    tx
}

/// The hooks of a wallet on `world`.
pub(crate) fn hooks(world: &Shared) -> Hooks {
    let (connect, sign_in, open) = (world.clone(), world.clone(), world.clone());
    Hooks {
        connect: Rc::new(move |_| {
            let gateway: Arc<dyn Gateway> = Arc::new(Fake(connect.clone()));
            (connect.lock().unwrap().session.clone(), Some(gateway))
        }),
        sign_in: Rc::new(move |_| {
            let mut world = sign_in.lock().unwrap();
            world.sign_ins += 1;
            world.sign_in_starts
        }),
        open: Rc::new(move |url| open.lock().unwrap().opened.push(url.into())),
        deadline: DEADLINE,
    }
}

pub(crate) fn wallet(world: &Shared, cx: &mut TestAppContext) -> Entity<ManagedCompute> {
    let hooks = hooks(world);
    cx.new(|_| ManagedCompute::new(hooks))
}

pub(crate) fn refresh(compute: &Entity<ManagedCompute>, force: bool, cx: &mut TestAppContext) {
    compute.update(cx, |c, cx| c.refresh(force, cx));
    cx.run_until_parked();
}

pub(crate) fn calls(world: &Shared) -> Vec<String> {
    world.lock().unwrap().calls.clone()
}

/// The account's own calls, in order.
pub(crate) fn session_calls(world: &Shared) -> Vec<String> {
    calls(world)
        .into_iter()
        .filter(|c| !c.starts_with("public"))
        .collect()
}
