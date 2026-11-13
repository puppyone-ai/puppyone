//! Cloud as the window offers it: the signed-in account, the Projects
//! catalog and the spaces they live in, the first publication, a hosted
//! Project's Agents, a checkout's association and PuppyOne compute. The Cloud client
//! underneath (sign-in broker, publication journal) is [`crate::cloud`].
//!
//! [`account`] is the account's public face (sign-in, status, the broker
//! and binding); everything else is reached through these exports.
pub mod account;
mod agents;
mod billing;
mod catalog;
mod clients;
mod managed_compute;
mod publish;
mod repository;
mod spaces;

#[cfg(feature = "dev-capture")]
pub use agents::lab_client as lab_agents_client;
pub use agents::{CloudAgents, CopyStatus, Opener, status as agent_status};
pub use billing::{
    PlanSnapshot, cached as cached_billing, fetch as fetch_billing, namespace as billing_namespace,
    settle as settle_billing,
};
pub use catalog::{CloudCatalog, State as CatalogState, global as global_catalog, owner_of};
pub use clients::{billing_client, services_client};
pub use managed_compute::{Reason as ComputeReason, global as global_compute, money};
#[cfg(test)]
pub use publish::install_factory;
pub use publish::{CloudPublish, HeaderStatus, Organizations};
pub use repository::RepositoryCloud;
pub use spaces::{
    CloudSpaces, Status as SpacesStatus, global as global_spaces, mark as space_mark,
    name as space_name, plan_badge as space_plan_badge, read as global_spaces_read,
};
