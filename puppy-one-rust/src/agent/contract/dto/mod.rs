//! The contract's shapes as Rust types (`types.ts`, `user-message-types.ts`,
//! `display-types.ts`). Windows and the Agent host exchange these; JSON is
//! only their transport form, read and written inside the contract.
mod display;
mod errors;
mod lenient;
mod local_connections;
mod record;
mod references;
mod runtime;
mod session;

pub use display::*;
pub use errors::*;
pub use local_connections::*;
pub use record::*;
pub use references::*;
pub use runtime::*;
pub use session::*;
