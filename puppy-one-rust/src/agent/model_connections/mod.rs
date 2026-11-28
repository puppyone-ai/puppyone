pub mod configuration;
pub mod drivers;
pub mod managed;
pub mod schema;
pub mod service;
pub mod snapshot;
pub mod wallet;

#[cfg(test)]
mod tests;

pub use service::{ModelConnectionService, ServiceComputeAccount};
pub use snapshot::{
    CatalogStatus, ConnectionCatalog, ManagedComputeSnapshot, ModelConnectionSnapshot,
};

/// The account PuppyOne compute bills: the app's signed-in Cloud account
/// while Payments is on. The composition hands it to the Agent's model
/// connections; the Agent never reaches for the app's account itself.
pub trait ComputeAccount: Send + Sync {
    /// The broker and binding managed compute may use now, if any.
    fn current(
        &self,
    ) -> Option<(
        std::sync::Arc<crate::cloud::auth::Broker>,
        crate::cloud::auth::model::Binding,
    )>;

    /// Notes a reservation id returned by `/ai/chat/completions` (`x-puppyone-reservation-id`).
    fn note_reservation(
        &self,
        binding: &crate::cloud::auth::model::Binding,
        reservation_id: &str,
        model_id: &str,
    ) {
        crate::cloud::auth::reservation::note(binding, reservation_id, model_id);
    }

    /// Invoked once a managed inference stream ends so the wallet refreshes
    /// balance & usage receipts promptly.
    fn on_inference_finished(&self) {}
}
/// A shared [`ComputeAccount`].
pub type ComputeAccountRef = std::sync::Arc<dyn ComputeAccount>;

/// No account to bill: PuppyOne compute is not offered.
pub struct NoComputeAccount;
impl ComputeAccount for NoComputeAccount {
    fn current(
        &self,
    ) -> Option<(
        std::sync::Arc<crate::cloud::auth::Broker>,
        crate::cloud::auth::model::Binding,
    )> {
        None
    }
}
