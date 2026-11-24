mod infrastructure;
mod managed;
mod ui;
pub use managed::{
    ManagedCompute as ComputeWallet, Reason as ComputeReason, global as global_compute, money,
};
#[cfg(test)]
pub(crate) use managed::{install as install_compute, test_support as compute_support};
pub use ui::{ModelConnections, Saved};
