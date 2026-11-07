pub mod configuration;
pub mod schema;

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
