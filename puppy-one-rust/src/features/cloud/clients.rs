//! The signed-in account's Cloud API clients, over the account's broker:
//! Project requests (the Homepage's rename and delete, the spaces) and
//! billing (Settings → Plan).
use crate::features::cloud::account;
use crate::workspace::cloud::services::{self, Client};
use gpui::App;
use std::sync::Arc;

/// The signed-in account's Project requests.
pub fn services_client(cx: &App) -> Option<Client> {
    let (broker, binding) = account::broker_and_binding(cx)?;
    Some(Client::new(Arc::new(services::BrokerTransport {
        broker,
        binding,
        cancel: Default::default(),
    })))
}

/// The signed-in account's billing requests (Settings → Plan).
pub fn billing_client(cx: &App) -> Option<crate::workspace::cloud::billing::Client> {
    let (broker, binding) = account::broker_and_binding(cx)?;
    Some(crate::workspace::cloud::billing::Client::new(Arc::new(
        services::BrokerTransport {
            broker,
            binding,
            cancel: Default::default(),
        },
    )))
}
