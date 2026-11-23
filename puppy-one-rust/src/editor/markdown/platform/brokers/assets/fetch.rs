//! Remote `https:` image fetching and shared Tokio runtime for `AssetBroker`
//! (`platform/brokers/assets/fetch.rs`, `TA-50`, `R12`).
use super::cache::CancelToken;
use crate::editor::markdown::platform::policy::{
    asset::{AssetFailure, MAX_REMOTE_IMAGE_BYTES},
    network,
};
use std::{sync::OnceLock, time::Duration};

const REMOTE_TIMEOUT: Duration = Duration::from_secs(20);

pub(in crate::editor::markdown::platform::brokers) fn shared_runtime()
-> Option<&'static tokio::runtime::Runtime> {
    static RUNTIME: OnceLock<Option<tokio::runtime::Runtime>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .thread_name("po-md-asset")
                .enable_all()
                .build()
                .ok()
        })
        .as_ref()
}

pub(super) fn fetch_remote(url: &str, cancel: &CancelToken) -> Result<Vec<u8>, AssetFailure> {
    let endpoint = network::resolve_public_endpoint(url).map_err(AssetFailure::Network)?;
    let client = network::build_pinned_https_client(&endpoint, REMOTE_TIMEOUT, false)
        .map_err(AssetFailure::Network)?;
    let runtime =
        shared_runtime().ok_or_else(|| AssetFailure::Network("Runtime unavailable".into()))?;
    runtime.block_on(async {
        let mut response = client
            .get(endpoint.url.as_str())
            .send()
            .await
            .map_err(|e| AssetFailure::Network(e.to_string().into()))?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AssetFailure::NotFound);
        }
        if !status.is_success() {
            return Err(AssetFailure::Network(
                format!("HTTP {}", status.as_u16()).into(),
            ));
        }
        if let Some(len) = response.content_length()
            && len > MAX_REMOTE_IMAGE_BYTES as u64
        {
            return Err(AssetFailure::ExceedsLimit {
                limit_bytes: MAX_REMOTE_IMAGE_BYTES as u64,
            });
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| AssetFailure::Network(e.to_string().into()))?
        {
            if cancel.is_cancelled() {
                return Err(AssetFailure::Network("Cancelled".into()));
            }
            if body.len().saturating_add(chunk.len()) > MAX_REMOTE_IMAGE_BYTES {
                return Err(AssetFailure::ExceedsLimit {
                    limit_bytes: MAX_REMOTE_IMAGE_BYTES as u64,
                });
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    })
}
