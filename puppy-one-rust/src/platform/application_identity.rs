//! Channel application identity policy (`shared/desktop/application-identity.mjs`),
//! kept pure of OS/UI side effects. Maps build channels to their application IDs
//! and display names, and disambiguates concurrent local Rust `dev` worktrees or
//! isolated `PUPPYONE_RUST_DATA_DIR` environments.

use super::build_identity::{self, Channel};
use std::path::{Path, PathBuf};

/// Static channel policy (`CHANNEL_APPLICATION_POLICIES` in `application-identity.mjs`,
/// adapted for the GPUI runtime alongside `tools/release/identity.py`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChannelApplicationPolicy {
    pub application_id: &'static str,
    pub application_name: &'static str,
    pub published: bool,
}

pub const fn channel_policy(channel: Channel) -> ChannelApplicationPolicy {
    match channel {
        Channel::Dev => ChannelApplicationPolicy {
            application_id: "ai.puppyone.desktop.gpui.dev",
            application_name: "PuppyOne Rust Dev",
            published: false,
        },
        Channel::Internal => ChannelApplicationPolicy {
            application_id: "ai.puppyone.desktop.internal",
            application_name: "PuppyOne Internal",
            published: true,
        },
        Channel::Stable => ChannelApplicationPolicy {
            application_id: "ai.puppyone.desktop",
            application_name: "PuppyOne",
            published: true,
        },
    }
}

/// Resolves the human-readable application name. Published channels (`Internal`,
/// `Stable`) strictly return their canonical product names, while `Dev` appends
/// any secondary git worktree (`puppyone-rust-<slug>`) or isolated data-dir tag.
pub fn resolve_application_name(
    channel: Channel,
    exe: Option<&Path>,
    custom_data_dir: Option<&Path>,
) -> String {
    let base = channel_policy(channel).application_name;
    if channel != Channel::Dev {
        return base.to_owned();
    }
    let mut tags: Vec<String> = Vec::new();
    if let Some(exe) = exe {
        for ancestor in exe.ancestors() {
            let Some(name) = ancestor.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if let Some(rest) = name.strip_prefix("puppyone-rust-")
                && let Some(clean) = sanitize_tag(rest)
            {
                tags.push(clean);
                break;
            }
        }
    }
    if let Some(dir) = custom_data_dir
        && let Some(tag) = extract_data_dir_tag(dir)
        && !tags
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&tag))
    {
        tags.push(tag);
    }
    if tags.is_empty() {
        base.to_owned()
    } else {
        format!("{base} [{}]", tags.join(" - "))
    }
}

/// Stable bundle identifier for a local Cargo `target/{debug,release}` dev `.app` wrapper,
/// derived from its resolved display name so distinct worktrees register separately in Dock.
pub fn dev_wrapper_bundle_id(app_name: &str) -> String {
    let slug: String = app_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    if slug.is_empty() {
        "local.puppyone.gpui.dev".to_owned()
    } else {
        format!("local.puppyone.gpui.{slug}")
    }
}

/// Runtime display name for menus, window titles, CLI control info, and dev bundles.
pub fn current_application_name() -> String {
    if std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
        || std::env::var_os("PUPPYONE_LAB").is_some()
    {
        return channel_policy(Channel::Stable).application_name.to_owned();
    }
    let identity = build_identity::current();
    let custom_data = std::env::var_os("PUPPYONE_RUST_DATA_DIR").map(PathBuf::from);
    resolve_application_name(
        identity.channel,
        std::env::current_exe().ok().as_deref(),
        custom_data.as_deref(),
    )
}

fn extract_data_dir_tag(dir: &Path) -> Option<String> {
    let mut raw = dir.file_name()?.to_str()?;
    // Ephemeral `tempfile::tempdir()` folders (`.tmpXXXXXX`) in tests are not user environments.
    if raw.starts_with(".tmp") {
        return None;
    }
    if raw.starts_with('.') {
        let parent = dir.parent()?.file_name()?.to_str()?;
        if matches!(parent, "tmp" | "var" | "private") || parent.starts_with(".tmp") {
            return None;
        }
        raw = parent;
    }
    if raw.eq_ignore_ascii_case("PuppyOne GPUI") {
        return None;
    }
    let trimmed = raw
        .strip_prefix("PuppyOne GPUI ")
        .or_else(|| raw.strip_prefix("PuppyOne "))
        .unwrap_or(raw);
    sanitize_tag(trimmed)
}

fn sanitize_tag(input: &str) -> Option<String> {
    let mut out = String::with_capacity(input.len());
    for ch in input.trim().chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ' ' | '.') {
            out.push(ch);
        }
        if out.len() >= 28 {
            break;
        }
    }
    let trimmed = out.trim().to_owned();
    (!trimmed.is_empty()).then_some(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn channel_policies_match_product_contracts() {
        assert_eq!(
            channel_policy(Channel::Stable).application_id,
            "ai.puppyone.desktop"
        );
        assert_eq!(channel_policy(Channel::Stable).application_name, "PuppyOne");
        assert!(channel_policy(Channel::Stable).published);
        assert_eq!(
            channel_policy(Channel::Internal).application_id,
            "ai.puppyone.desktop.internal"
        );
        assert_eq!(
            channel_policy(Channel::Internal).application_name,
            "PuppyOne Internal"
        );
        assert!(channel_policy(Channel::Internal).published);
        assert_eq!(
            channel_policy(Channel::Dev).application_id,
            "ai.puppyone.desktop.gpui.dev"
        );
        assert_eq!(
            channel_policy(Channel::Dev).application_name,
            "PuppyOne Rust Dev"
        );
        assert!(!channel_policy(Channel::Dev).published);
    }

    #[test]
    fn application_names_distinguish_channels_worktrees_and_isolated_data() {
        let main_exe =
            Path::new("/Users/me/project/puppyone-rust/puppy-one-rust/target/debug/puppy-one-rust");
        let wt_exe = Path::new(
            "/Users/me/project/puppyone-rust-cloud-desktop/puppy-one-rust/target/debug/puppy-one-rust",
        );
        let e2e_data = Path::new("/Users/me/Library/Application Support/PuppyOne GPUI E2E");
        let tmp_data = Path::new("/var/folders/xx/.tmpAbCd12");

        assert_eq!(
            resolve_application_name(Channel::Stable, Some(wt_exe), Some(e2e_data)),
            "PuppyOne"
        );
        assert_eq!(
            resolve_application_name(Channel::Internal, Some(wt_exe), None),
            "PuppyOne Internal"
        );
        assert_eq!(
            resolve_application_name(Channel::Dev, Some(main_exe), None),
            "PuppyOne Rust Dev"
        );
        assert_eq!(
            resolve_application_name(Channel::Dev, Some(main_exe), Some(tmp_data)),
            "PuppyOne Rust Dev"
        );
        assert_eq!(
            resolve_application_name(Channel::Dev, Some(wt_exe), None),
            "PuppyOne Rust Dev [cloud-desktop]"
        );
        assert_eq!(
            resolve_application_name(Channel::Dev, Some(wt_exe), Some(e2e_data)),
            "PuppyOne Rust Dev [cloud-desktop - E2E]"
        );
        assert_eq!(
            dev_wrapper_bundle_id("PuppyOne Rust Dev [cloud-desktop]"),
            "local.puppyone.gpui.puppyone-rust-dev--cloud-desktop"
        );
    }
}
