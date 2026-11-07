//! Cloud as the window offers it: the signed-in account, the Projects
//! catalog, the services dialog, the first publication, a hosted Project's
//! Agents, a checkout's association and PuppyOne compute. The Cloud client
//! underneath (sign-in broker, publication journal) is [`crate::cloud`].
pub mod account;
pub mod agents;
pub mod catalog;
pub mod managed_compute;
pub mod publish;
pub mod repository;
pub mod services;
