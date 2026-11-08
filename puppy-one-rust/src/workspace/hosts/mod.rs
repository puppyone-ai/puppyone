//! Folders on the owner's other computers (PuppyOne Host): the host file
//! protocol, the host's own file service and, over SSH that ends on the
//! host, the access side that opens those folders here.
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
