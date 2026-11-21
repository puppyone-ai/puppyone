//! The GPUI app's updates (`update-service.mjs`, without electron-updater):
//! where this build looks for one, why it may not, reading the feed and
//! downloading the archive. The update itself goes in through a
//! [`prepared::PreparedUpdate`] swap; the service around these is
//! `features::updates`.
//!
//! A release build names its feed when it is packaged
//! (`PUPPYONE_UPDATE_FEED_URL`, a directory holding `<channel>-mac.yml`);
//! nothing is compiled in otherwise. An unpackaged development build may
//! point at a local feed with `PUPPYONE_DESKTOP_DEV_UPDATE_URL` and
//! `PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG=1`, as the product's may.
pub mod feed;
pub mod installer;
pub mod policy;
mod preferences;
pub use preferences::{read_automatic_download, write_automatic_download};
#[cfg(test)]
mod configuration_tests;
#[cfg(target_os = "macos")]
pub mod prepared;
pub mod state;
#[cfg(test)]
mod transport_tests;

use super::build_identity::{Channel, Identity};
use state::Progress;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// `BACKGROUND_UPDATE_INITIAL_DELAY_MS` / `_INTERVAL_MS`.
pub const INITIAL_CHECK: Duration = Duration::from_secs(15);
pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// An update archive larger than this is refused.
const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;

/// `resolveDesktopUpdateConfiguration`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Configuration {
    pub channel: Channel,
    pub current_version: String,
    pub feed: Option<url::Url>,
    /// The metadata's name: `<update channel>-mac.yml`.
    pub update_channel: Option<&'static str>,
    pub force_dev: bool,
}

fn truthy(value: Option<String>) -> bool {
    matches!(value.as_deref(), Some("1" | "true" | "yes"))
}
fn feed_url(value: &str, loopback: bool) -> Option<url::Url> {
    let url = url::Url::parse(value.trim().trim_end_matches('/')).ok()?;
    let secure = url.scheme() == "https" || (loopback && feed::local_http(&url));
    (secure && url.username().is_empty() && url.password().is_none() && url.query().is_none())
        .then_some(url)
}

pub fn configuration(identity: &Identity, env: impl Fn(&str) -> Option<String>) -> Configuration {
    resolve_configuration(identity, option_env!("PUPPYONE_UPDATE_FEED_URL"), env)
}

fn resolve_configuration(
    identity: &Identity,
    compiled_feed: Option<&str>,
    env: impl Fn(&str) -> Option<String>,
) -> Configuration {
    let release_feed = match identity.channel {
        Channel::Dev => None,
        _ => compiled_feed.and_then(|v| feed_url(v, false)),
    };
    let development = (!identity.packaged && identity.channel == Channel::Dev)
        .then(|| env("PUPPYONE_DESKTOP_DEV_UPDATE_URL"))
        .flatten()
        .and_then(|v| feed_url(&v, true));
    let force_dev =
        development.is_some() && truthy(env("PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG"));
    let update_channel = match identity.channel {
        Channel::Internal => Some("internal"),
        Channel::Stable => Some("stable"),
        Channel::Dev => force_dev.then_some("dev"),
    };
    Configuration {
        channel: identity.channel,
        current_version: identity.version.clone(),
        feed: release_feed.or(if force_dev { development } else { None }),
        update_channel,
        force_dev,
    }
}

/// `getMacCodeSignatureStatus`: what `codesign -dv` says of this app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Signature {
    Release,
    AdHoc,
    Unsigned,
    OtherCertificate,
    Unreadable(String),
}
pub fn signature_of(output: Result<(bool, String), String>) -> Signature {
    match output {
        Err(error) => Signature::Unreadable(error),
        Ok((false, _)) => Signature::Unsigned,
        Ok((true, text))
            if text
                .lines()
                .any(|l| l.trim().eq_ignore_ascii_case("Signature=adhoc")) =>
        {
            Signature::AdHoc
        }
        Ok((true, text)) => {
            let release = text
                .lines()
                .filter_map(|l| l.strip_prefix("Authority="))
                .any(|a| {
                    [
                        "Developer ID Application:",
                        "Apple Distribution:",
                        "3rd Party Mac Developer Application:",
                    ]
                    .iter()
                    .any(|p| a.to_ascii_lowercase().starts_with(&p.to_ascii_lowercase()))
                });
            if release {
                Signature::Release
            } else {
                Signature::OtherCertificate
            }
        }
    }
}
#[cfg(target_os = "macos")]
pub fn signature(app: &Path) -> Signature {
    signature_of(
        std::process::Command::new("/usr/bin/codesign")
            .args(["-dv", "--verbose=4"])
            .arg(app)
            .output()
            .map(|o| {
                (
                    o.status.success(),
                    format!(
                        "{}\n{}",
                        String::from_utf8_lossy(&o.stdout),
                        String::from_utf8_lossy(&o.stderr)
                    ),
                )
            })
            .map_err(|e| e.to_string()),
    )
}

/// `getDisabledReason`, in its order; a build without a feed comes last.
pub fn disabled_reason(
    config: &Configuration,
    packaged: bool,
    signature: impl FnOnce() -> Signature,
) -> Option<String> {
    if config.channel == Channel::Dev && !config.force_dev {
        return Some("Auto updates are disabled for Development builds.".into());
    }
    if !packaged && !config.force_dev {
        return Some("Auto updates are disabled outside a packaged release build.".into());
    }
    if cfg!(target_os = "macos") && !config.force_dev {
        let reason = match signature() {
            Signature::Release => None,
            Signature::AdHoc => Some("Auto updates are disabled because this macOS build is ad-hoc signed.".into()),
            Signature::Unsigned => Some("Auto updates are disabled because this macOS build is not code signed.".into()),
            Signature::OtherCertificate => Some(
                "Auto updates are disabled because this macOS build is not signed with a release certificate."
                    .into(),
            ),
            Signature::Unreadable(error) => Some(format!(
                "Auto updates are disabled because the macOS code signature could not be inspected: {error}"
            )),
        };
        if reason.is_some() {
            return reason;
        }
    }
    config
        .feed
        .is_none()
        .then(|| "Auto updates are disabled because this build names no update feed.".into())
}

/// The update a feed offers this computer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub version: String,
    pub url: url::Url,
    pub sha512: String,
    pub size: u64,
}

fn runtime() -> Result<tokio::runtime::Runtime, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())
}
fn client(
    config: &Configuration,
    destination: &url::Url,
    timeout: Duration,
) -> Result<reqwest::Client, String> {
    // A forced local development feed stays on this computer even when an
    // environment or fixed system proxy is configured (not just a PAC).
    let builder = if config.force_dev && feed::local_http(destination) {
        reqwest::Client::builder().no_proxy()
    } else {
        crate::platform::proxy::system(reqwest::Client::builder())
    };
    builder
        .redirect_policy(reqwest::redirect::Policy::none())
        .https_only(!config.force_dev)
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}

/// Returns the per-OS updater metadata filename (`<channel>-mac.yml`,
/// `<channel>-win.yml`, or `<channel>-linux.yml`).
pub fn platform_feed_filename(channel: &str, os: super::os::Os) -> String {
    let suffix = match os {
        super::os::Os::Macos => "mac",
        super::os::Os::Windows => "win",
        super::os::Os::Linux | super::os::Os::Other => "linux",
    };
    format!("{channel}-{suffix}.yml")
}

/// Reads `<feed>/<channel>-<os>.yml` and picks this processor's payload.
pub fn check(config: &Configuration) -> Result<Candidate, String> {
    let (Some(feed), Some(channel)) = (&config.feed, config.update_channel) else {
        return Err("No update feed is configured.".into());
    };
    let os = super::os::Os::current();
    let filename = platform_feed_filename(channel, os);
    let metadata_url = feed::payload_url(feed, &filename, config.force_dev)?;
    let source = runtime()?.block_on(async {
        let mut response = client(config, &metadata_url, Duration::from_secs(30))?
            .get(metadata_url.clone())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("{metadata_url} answered {}", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|n| n > feed::MAX_METADATA_BYTES as u64)
        {
            return Err("The update metadata is too large.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if chunk.len() > feed::MAX_METADATA_BYTES.saturating_sub(bytes.len()) {
                return Err("The update metadata is too large.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        String::from_utf8(bytes).map_err(|_| "The update metadata is not text.".into())
    })?;
    let metadata = feed::parse_for_os(&source, os).map_err(|errors| errors.join("; "))?;
    let file = feed::payload_for_os(&metadata, super::build_identity::node_architecture(), os)
        .ok_or("The update has no archive for this computer.")?;
    Ok(Candidate {
        version: metadata.version.clone(),
        url: feed::payload_url(feed, &file.url, config.force_dev)?,
        sha512: file.sha512.clone(),
        size: file.size,
    })
}

/// Downloads the candidate's archive into `directory`, checking its size
/// and SHA-512 as it arrives; `progress` sees every chunk. The returned
/// owner removes this archive when preparation finishes or is abandoned.
pub fn download(
    config: &Configuration,
    candidate: &Candidate,
    directory: &Path,
    mut progress: impl FnMut(Progress),
    cancel: &AtomicBool,
) -> Result<tempfile::TempPath, String> {
    use sha2::Digest as _;
    use std::io::Write as _;
    if candidate.size > MAX_ARCHIVE_BYTES {
        return Err("The update archive is too large.".into());
    }
    if candidate.size == 0 {
        return Err("The update archive is empty.".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("The download was cancelled.".into());
    }
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let mut file = tempfile::Builder::new()
        .prefix("update-")
        .suffix(".zip")
        .tempfile_in(directory)
        .map_err(|e| e.to_string())?;
    let mut hasher = sha2::Sha512::new();
    let started = std::time::Instant::now();
    runtime()?.block_on(async {
        let transfer = async {
            let mut response = client(config, &candidate.url, Duration::from_secs(60 * 60))?
                .get(candidate.url.clone())
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err(format!("{} answered {}", candidate.url, response.status()));
            }
            if response
                .content_length()
                .is_some_and(|n| n > candidate.size)
            {
                return Err("The update archive is larger than its feed says.".into());
            }
            if response
                .content_length()
                .is_some_and(|n| n < candidate.size)
            {
                return Err("The update archive is smaller than its feed says.".into());
            }
            let mut received = 0u64;
            while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
                if cancel.load(Ordering::Relaxed) {
                    return Err("The download was cancelled.".into());
                }
                if chunk.len() as u64 > candidate.size - received {
                    return Err("The update archive is larger than its feed says.".into());
                }
                received += chunk.len() as u64;
                hasher.update(&chunk);
                file.write_all(&chunk).map_err(|e| e.to_string())?;
                let seconds = started.elapsed().as_secs_f64().max(0.001);
                progress(Progress {
                    percent: received as f64 * 100. / candidate.size as f64,
                    bytes_per_second: received as f64 / seconds,
                    transferred: received as f64,
                    total: candidate.size as f64,
                });
            }
            if received != candidate.size {
                return Err("The update archive is smaller than its feed says.".into());
            }
            file.as_file().sync_all().map_err(|e| e.to_string())
        };
        // Cancellation also retires a request waiting for headers or a peer
        // which has stopped producing chunks, without waiting for its timeout.
        let cancelled = async {
            while !cancel.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        };
        tokio::select! {
            biased;
            _ = cancelled => Err("The download was cancelled.".into()),
            result = transfer => result,
        }
    })?;
    if cancel.load(Ordering::Relaxed) {
        return Err("The download was cancelled.".into());
    }
    use base64::Engine as _;
    let digest = base64::engine::general_purpose::STANDARD.encode(hasher.finalize());
    if digest != candidate.sha512 {
        return Err("The update archive does not match its feed's SHA-512.".into());
    }
    Ok(file.into_temp_path())
}

/// Per-OS update cache directory (`~/Library/Caches/PuppyOne GPUI.<name>` on
/// macOS, so staging stays on the same volume as `/Applications` / `~/Applications`;
/// `<cache_dir>/<name>` on Windows and Linux).
pub fn cache_path(name: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        super::paths::home_dir()
            .join("Library/Caches")
            .join(format!("PuppyOne GPUI.{name}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        super::paths::cache_dir().join(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn identity(channel: Channel, packaged: bool) -> Identity {
        Identity {
            channel,
            version: "0.4.4".into(),
            packaged,
            ..crate::platform::build_identity::current()
        }
    }

    /// `electron.update-service.test.mjs`'s configuration and disabled cases.
    #[test]
    fn disabled_reasons_follow_the_product_order() {
        let none = |_: &str| None;
        let dev = configuration(&identity(Channel::Dev, false), none);
        assert_eq!(
            disabled_reason(&dev, false, || Signature::Release).as_deref(),
            Some("Auto updates are disabled for Development builds.")
        );
        let unpackaged = configuration(&identity(Channel::Stable, false), none);
        assert!(
            disabled_reason(&unpackaged, false, || Signature::Release)
                .unwrap()
                .contains("outside a packaged release build")
        );
        let packaged = configuration(&identity(Channel::Stable, true), none);
        #[cfg(target_os = "macos")]
        assert!(
            disabled_reason(&packaged, true, || Signature::AdHoc)
                .unwrap()
                .contains("ad-hoc signed")
        );
        if option_env!("PUPPYONE_UPDATE_FEED_URL").is_none() {
            assert!(
                disabled_reason(&packaged, true, || Signature::Release)
                    .unwrap()
                    .contains("names no update feed")
            );
        }
    }

    #[test]
    fn a_development_build_may_use_a_local_feed_only_when_forced() {
        let env = |forced: bool| {
            move |key: &str| match key {
                "PUPPYONE_DESKTOP_DEV_UPDATE_URL" => Some("http://127.0.0.1:8765/feed/".into()),
                "PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG" => forced.then(|| "1".into()),
                _ => None,
            }
        };
        let off = configuration(&identity(Channel::Dev, false), env(false));
        assert_eq!((off.feed, off.force_dev), (None, false));
        let on = configuration(&identity(Channel::Dev, false), env(true));
        assert!(on.force_dev);
        assert_eq!(on.update_channel, Some("dev"));
        assert_eq!(on.feed.unwrap().as_str(), "http://127.0.0.1:8765/feed");
        assert_eq!(
            disabled_reason(
                &configuration(&identity(Channel::Dev, false), env(true)),
                false,
                || unreachable!()
            ),
            None
        );
        // A packaged build never takes the override.
        let packaged = configuration(&identity(Channel::Dev, true), env(true));
        assert!(!packaged.force_dev);
    }

    #[test]
    fn codesign_output_tells_release_from_ad_hoc() {
        let signed = |text: &str| signature_of(Ok((true, text.into())));
        assert_eq!(
            signed("Authority=Developer ID Application: PuppyOne (TEAM)\nAuthority=Apple Root CA"),
            Signature::Release
        );
        assert_eq!(signed("Signature=adhoc"), Signature::AdHoc);
        assert_eq!(
            signed("Authority=Apple Development: me"),
            Signature::OtherCertificate
        );
        assert_eq!(
            signature_of(Ok((false, String::new()))),
            Signature::Unsigned
        );
    }

    #[test]
    fn the_download_preference_defaults_on_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_automatic_download(dir.path()));
        write_automatic_download(dir.path(), false).unwrap();
        assert!(!read_automatic_download(dir.path()));
    }
}
