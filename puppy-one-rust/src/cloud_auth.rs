//! Native account authority. No GPUI, browser SDK, or workspace save queue.
mod callback;
mod http;
pub mod model;
mod service;
mod store;
mod transport;
pub use model::{Environment, Error, Snapshot, Status};
pub use service::{Broker, BrowserEvent};
#[cfg(test)]
pub(crate) use tests::{account_fixture, protocol_fixture};
pub use transport::{Cancellation, ServiceCode, StreamEvent};
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod tests;
