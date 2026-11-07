//! `src/features/session-transport`: scoped Renderer operations.
mod managed_operation_scope;

pub use managed_operation_scope::{
    ManagedOperationScope, scoped_timeout_ms, wait_for_scoped_operation,
};
