//! Native account authority. No GPUI, browser SDK, or workspace save queue.
mod callback;
mod http;
pub mod model;
pub mod reservation;
mod result_page;
mod service;
mod store;
mod transport;
pub use http::get_json;
pub use model::{Environment, Error, Snapshot, Status};
pub use service::{Broker, BrowserEvent};
#[cfg(any(test, feature = "test-support", feature = "dev-capture"))]
mod fixtures;
#[cfg(any(test, feature = "test-support", feature = "dev-capture"))]
pub use fixtures::{
    Responder, ScreenResponder, SignInControl, account_fixture, protocol_fixture,
    refresh_token_broker, relogin, responding_account_fixture, responding_live_account_fixture,
    responding_screen_account_fixture, sign_in_again, sign_in_fixture,
};
pub use transport::{
    BILLING_DISABLED, Cancellation, HostTunnel, ScreenReceiver, ScreenSender, ScreenSocket,
    ServiceCode, StreamEvent,
};
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod tests;

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
