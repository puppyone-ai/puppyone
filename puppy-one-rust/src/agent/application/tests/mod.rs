//! The product's AgentService tests, over the same harness.
#[cfg(test)]
mod control;
/// The Agent service over scripted runtimes, for this crate's tests and the
/// window's (`test-support`).
pub mod harness;
#[cfg(test)]
mod requests;
#[cfg(test)]
mod service;
