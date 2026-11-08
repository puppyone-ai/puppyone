//! Cloud as the window offers it: the signed-in account, the Projects
//! catalog and the spaces they live in, the first publication, a hosted
//! Project's Agents, a checkout's association and PuppyOne compute. The Cloud client
//! underneath (sign-in broker, publication journal) is [`crate::cloud`].
//!
//! [`account`] is the account's public face (sign-in, status, the broker
//! and binding); everything else is reached through these exports.
pub mod account;
mod agents;
mod catalog;
mod clients;
mod managed_compute;
mod publish;
mod repository;
mod spaces;

#[cfg(feature = "dev-capture")]
pub use agents::lab_client as lab_agents_client;
pub use agents::{CloudAgents, CopyStatus, Opener, status as agent_status};
pub use catalog::{CloudCatalog, State as CatalogState, global as global_catalog};
pub use clients::{billing_client, services_client};
pub use managed_compute::{Reason as ComputeReason, global as global_compute, money};
#[cfg(test)]
pub use publish::install_factory;
pub use publish::{CloudPublish, HeaderStatus, Organizations};
pub use repository::RepositoryCloud;
pub use spaces::{
    CloudSpaces, Status as SpacesStatus, global as global_spaces, read as global_spaces_read,
};
