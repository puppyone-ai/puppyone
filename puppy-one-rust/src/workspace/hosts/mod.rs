//! Folders on the owner's other computers (PuppyOne Host): the host file
//! protocol, the host's own file service and, over SSH that ends on the
//! host, the access side that opens those folders here.

/// `HOST_DEVICES_AVAILABLE` (`shared/host-contract/rollout.mjs`, v0.4.4
/// a0eff5ea4): the release gate the window and PuppyOne Host share. Enable
/// only in an internal rollout build; a saved experiment choice cannot
/// bypass it.
pub const AVAILABLE: bool = false;

#[cfg(test)]
pub(crate) mod acceptance;
pub mod connector;
pub mod control;
pub mod device;
pub mod exec;
pub mod files;
pub mod git;
pub mod identity;
pub mod lines;
pub mod process;
pub mod protocol;
pub mod registry;
pub mod remote;
pub mod service;
pub mod ssh;
#[cfg(any(test, feature = "test-support"))]
pub mod testing;
