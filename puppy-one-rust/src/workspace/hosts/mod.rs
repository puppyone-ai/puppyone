//! Folders on the owner's other computers (PuppyOne Host): the host file
//! protocol, the host's own file service and, over SSH that ends on the
//! host, the access side that opens those folders here.
pub mod exec;
pub mod files;
pub mod lines;
pub mod protocol;
pub mod ssh;
