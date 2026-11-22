pub mod configuration;
pub mod credentials;
pub mod oauth;
pub mod providers;
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

/// The User-Agent of every model request (sign-in, catalogs, inference,
/// discovery): PuppyOne names itself. Some providers' gateways refuse
/// requests without one (chat.qwen.ai's Aliyun WAF answers an HTML block
/// page instead of the API).
pub const USER_AGENT: &str = concat!("PuppyOne/", env!("CARGO_PKG_VERSION"));

/// The client every model connection request is made with: the system
/// proxy, [`USER_AGENT`], never a redirect (a key is never sent on to
/// another host), connecting within 15 seconds and answering within
/// `timeout`.
pub fn http_client(timeout: std::time::Duration) -> reqwest::Result<reqwest::Client> {
    crate::platform::proxy::system(reqwest::Client::builder().user_agent(USER_AGENT))
        .redirect_policy(reqwest::redirect::Policy::none())
        .connect_timeout(timeout.min(std::time::Duration::from_secs(15)))
        .timeout(timeout)
        .build()
}

/// A response body of at most `limit` bytes; a longer one is refused
/// (`None`) rather than read on.
pub async fn read_limited(response: reqwest::Response, limit: usize) -> Option<Vec<u8>> {
    use futures_util::StreamExt as _;
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return None;
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        if body.len() + chunk.len() > limit {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}

/// Metadata answers (tokens, catalogs, service probes) are small: 4 MiB.
pub const METADATA_LIMIT: usize = 4 * 1024 * 1024;
