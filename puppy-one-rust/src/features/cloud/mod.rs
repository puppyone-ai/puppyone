//! Cloud as the window offers it: the signed-in account, the Projects
//! catalog and the spaces they live in, the first publication, a hosted
//! Project's Agents and its hosted Agent, a checkout's association and
//! PuppyOne compute. The Cloud client
//! underneath (sign-in broker, publication journal) is [`crate::cloud`].
//!
//! [`account`] is the account's public face (sign-in, status, the broker
//! and binding); everything else is reached through these exports.
pub mod account;
mod agent;
mod billing;
mod catalog;
mod clients;
mod managed_compute;
mod publish;
mod repository;
mod screen;
mod spaces;
mod workspace_agents;

#[cfg(test)]
pub use agent::{CloudAgentController, CloudAgentConversation, Hub, LABEL as HOSTED_AGENT_LABEL};
pub use agent::{HostedChats, hosted_installation};
pub use billing::{
    PlanSnapshot, cached as cached_billing, fetch as fetch_billing, namespace as billing_namespace,
    settle as settle_billing,
};
pub use catalog::{CloudCatalog, State as CatalogState, global as global_catalog, owner_of};
pub use clients::{agents_client, billing_client, services_client};
pub use managed_compute::{Reason as ComputeReason, global as global_compute, money};
#[cfg(test)]
pub use publish::install_factory;
#[cfg(test)]
pub(crate) use publish::states as publish_states;
pub use publish::{CloudPublish, HeaderStatus, Organizations};
pub use repository::RepositoryCloud;
pub use screen::{CloudScreen, CloudScreenEvent, ScreenLayout};
pub use spaces::{
    CloudSpaces, Status as SpacesStatus, global as global_spaces, mark as space_mark,
    name as space_name, plan_badge as space_plan_badge, read as global_spaces_read,
};
#[cfg(feature = "dev-capture")]
pub use workspace_agents::lab_client as lab_agents_client;
pub use workspace_agents::{CloudAgents, CopyStatus, InvitePhase, Opener, status as agent_status};
