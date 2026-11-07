//! Cloud as the window offers it: the signed-in account, the Projects
//! catalog, the services dialog, the first publication, a hosted Project's
//! Agents, a checkout's association and PuppyOne compute. The Cloud client
//! underneath (sign-in broker, publication journal) is [`crate::cloud`].
//!
//! [`account`] is the account's public face (sign-in, status, the broker
//! and binding); everything else is reached through these exports.
pub mod account;
mod agents;
mod catalog;
mod managed_compute;
mod publish;
mod repository;
mod services;

#[cfg(feature = "dev-capture")]
pub use agents::lab_client as lab_agents_client;
pub use agents::{CloudAgents, CopyStatus, Opener, status as agent_status};
pub use catalog::{CloudCatalog, State as CatalogState, global as global_catalog};
pub use managed_compute::{Reason as ComputeReason, global as global_compute, money};
pub use publish::{CloudPublish, HeaderStatus, Organizations};
#[cfg(test)]
pub use publish::{Publication, install_factory};
pub use repository::RepositoryCloud;
pub use services::{
    Close as ServicesClose, CloudServices, ResumePublication, Section as ServicesSection,
    billing_client, services_client,
};
