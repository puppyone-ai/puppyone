//! Native account authority. No GPUI, browser SDK, or workspace save queue.
mod callback;
mod http;
pub mod model;
mod result_page;
mod service;
mod store;
mod transport;
pub use model::{Environment, Error, Snapshot, Status};
pub use service::{Broker, BrowserEvent};
#[cfg(any(test, feature = "test-support"))]
mod fixtures;
#[cfg(any(test, feature = "test-support"))]
pub use fixtures::{
    Responder, account_fixture, protocol_fixture, relogin, responding_account_fixture,
};
pub use transport::{Cancellation, HostTunnel, ServiceCode, StreamEvent};
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod tests;

/// The process's signed-in broker for owners that run outside the UI (the
/// built-in Agent's managed compute), with the Payments decision the UI
/// last applied. It grants nothing a binding check would not.
static CURRENT: std::sync::Mutex<Option<(std::sync::Arc<Broker>, bool)>> =
    std::sync::Mutex::new(None);
/// "Return to PuppyOne Desktop" on the sign-in result page: the app comes
/// forward (`onReturnToApp`). The UI listens once, for the whole process.
fn reveal() -> &'static (async_channel::Sender<()>, async_channel::Receiver<()>) {
    static REVEAL: std::sync::OnceLock<(async_channel::Sender<()>, async_channel::Receiver<()>)> =
        std::sync::OnceLock::new();
    REVEAL.get_or_init(async_channel::unbounded)
}
pub(crate) fn reveal_app() {
    let _ = reveal().0.try_send(());
}
pub fn reveal_requests() -> async_channel::Receiver<()> {
    reveal().1.clone()
}
pub fn install_current(broker: Option<std::sync::Arc<Broker>>) {
    if let Ok(mut current) = CURRENT.lock() {
        let payments = current.as_ref().is_some_and(|(_, p)| *p);
        *current = broker.map(|b| (b, payments));
    }
}
pub fn set_payments(enabled: bool) {
    if let Ok(mut current) = CURRENT.lock()
        && let Some((_, payments)) = current.as_mut()
    {
        *payments = enabled;
    }
}
/// The broker and binding managed compute may use now, if any.
pub fn current() -> Option<(std::sync::Arc<Broker>, model::Binding)> {
    let current = CURRENT.lock().ok()?;
    let (broker, payments) = current.as_ref()?;
    if !payments {
        return None;
    }
    let binding = broker.signed_in_binding()?;
    Some((broker.clone(), binding))
}
