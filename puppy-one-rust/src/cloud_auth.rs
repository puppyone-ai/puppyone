//! Native account authority. No GPUI, browser SDK, or workspace save queue.
mod callback;
mod http;
pub mod model;
mod service;
mod store;
pub use model::{Environment, Error, Snapshot, Status};
pub use service::{Broker, BrowserEvent};
#[cfg(test)]
pub(crate) use tests::account_fixture;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod tests;
