//! The Renderer's event loop as the controllers see it (`setTimeout`,
//! un-awaited promises and `Date.now()`), so they run on the window's
//! executor in the app and on a paused test runtime in tests.
use futures_util::future::LocalBoxFuture;
use std::cell::Cell;
use std::future::Future as _;
use std::rc::Rc;

/// The window executor.
pub trait UiRuntime {
    /// Runs `task` to completion (`void promise`).
    fn spawn(&self, task: LocalBoxFuture<'static, ()>);
    /// Resolves after `ms` milliseconds.
    fn sleep(&self, ms: u64) -> LocalBoxFuture<'static, ()>;
    /// `Date.now()`.
    fn now_ms(&self) -> i64;
}

/// `setTimeout(callback, ms)`; [`Timer::clear`] is `clearTimeout`.
pub struct Timer(Rc<Cell<bool>>);

impl Timer {
    pub fn clear(&self) {
        self.0.set(true);
    }
}

/// `setTimeout(callback, ms)`.
pub fn set_timeout(
    runtime: &Rc<dyn UiRuntime>,
    ms: u64,
    callback: impl FnOnce() + 'static,
) -> Timer {
    let cancelled = Rc::new(Cell::new(false));
    let flag = cancelled.clone();
    let sleep = runtime.sleep(ms);
    runtime.spawn(Box::pin(async move {
        sleep.await;
        if !flag.get() {
            callback();
        }
    }));
    Timer(cancelled)
}

/// The test runtime: a tokio `LocalSet` whose clock may be paused.
pub struct TokioUiRuntime {
    origin_ms: i64,
    origin: tokio::time::Instant,
}

impl TokioUiRuntime {
    pub fn create() -> Rc<dyn UiRuntime> {
        Rc::new(Self {
            origin_ms: crate::agent::contract::js::now_ms(),
            origin: tokio::time::Instant::now(),
        })
    }
}

impl UiRuntime for TokioUiRuntime {
    fn spawn(&self, task: LocalBoxFuture<'static, ()>) {
        tokio::task::spawn_local(task);
    }
    fn sleep(&self, ms: u64) -> LocalBoxFuture<'static, ()> {
        Box::pin(tokio::time::sleep(std::time::Duration::from_millis(ms)))
    }
    fn now_ms(&self) -> i64 {
        self.origin_ms + self.origin.elapsed().as_millis() as i64
    }
}

/// A started task several callers may await. Like a JS promise, it keeps
/// running when nobody awaits it.
pub type Task<T> = futures_util::future::Shared<LocalBoxFuture<'static, T>>;

/// Runs `future` until its first suspension now, as calling an `async`
/// function does, and keeps driving it on `runtime`. A future polled here
/// registers its waker again on its next poll.
pub fn start<T: Clone + 'static>(
    runtime: &Rc<dyn UiRuntime>,
    future: impl std::future::Future<Output = T> + 'static,
) -> Task<T> {
    let task = unstarted(future);
    launch(runtime, &task);
    task
}

/// A task that has not started. Store it where its own completion looks for
/// it (`this.pending = task`), then [`launch`] it: the product assigns a
/// promise before any of its callbacks can run.
pub fn unstarted<T: Clone + 'static>(
    future: impl std::future::Future<Output = T> + 'static,
) -> Task<T> {
    use futures_util::FutureExt;
    future.boxed_local().shared()
}

/// Starts a [`task`]: its synchronous prefix runs now.
pub fn launch<T: Clone + 'static>(runtime: &Rc<dyn UiRuntime>, task: &Task<T>) {
    let mut prefix = task.clone();
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    let _ = std::pin::Pin::new(&mut prefix).poll(&mut context);
    drop(prefix);
    let driver = task.clone();
    runtime.spawn(Box::pin(async move {
        driver.await;
    }));
}

/// `Promise.resolve().then(() => future)`: `future` starts only after the
/// runtime's next turn, even when its task is awaited synchronously.
pub fn start_deferred<T: Clone + 'static>(
    runtime: &Rc<dyn UiRuntime>,
    future: impl std::future::Future<Output = T> + 'static,
) -> Task<T> {
    let turn = microtask(runtime);
    start(runtime, async move {
        turn.await;
        future.await
    })
}

/// `void promise`: runs `future` until its first suspension now and keeps
/// driving it.
pub fn detach(
    runtime: &Rc<dyn UiRuntime>,
    future: impl std::future::Future<Output = ()> + 'static,
) {
    drop(start(runtime, future));
}

/// `await Promise.resolve()`: resolves once the runtime has taken a turn,
/// however often it is polled before.
pub fn microtask(runtime: &Rc<dyn UiRuntime>) -> impl std::future::Future<Output = ()> + 'static {
    type Turn = (Cell<bool>, std::cell::RefCell<Option<std::task::Waker>>);
    let turn: Rc<Turn> = Rc::new((Cell::new(false), std::cell::RefCell::new(None)));
    let taken = turn.clone();
    runtime.spawn(Box::pin(async move {
        taken.0.set(true);
        if let Some(waker) = taken.1.borrow_mut().take() {
            waker.wake();
        }
    }));
    std::future::poll_fn(move |context| {
        if turn.0.get() {
            return std::task::Poll::Ready(());
        }
        *turn.1.borrow_mut() = Some(context.waker().clone());
        std::task::Poll::Pending
    })
}

/// A settled task (`Promise.resolve(value)`).
pub fn resolved<T: Clone + 'static>(value: T) -> Task<T> {
    use futures_util::FutureExt;
    futures_util::future::ready(value).boxed_local().shared()
}

/// `Math.random()`.
pub fn math_random() -> f64 {
    (getrandom::u64().unwrap_or(0) >> 11) as f64 / (1u64 << 53) as f64
}

/// `crypto.randomUUID()`.
pub fn random_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}
