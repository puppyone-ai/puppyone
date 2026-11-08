//! Folders on the owner's other computers (PuppyOne Host): the host file
//! protocol, the host's own file service and, over SSH that ends on the
//! host, the access side that opens those folders here.
pub mod device;
pub mod exec;
pub mod files;
pub mod git;
pub mod lines;
pub mod protocol;
pub mod remote;
pub mod ssh;
#[cfg(any(test, feature = "test-support"))]
pub mod testing;
