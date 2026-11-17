//! `useDesktopBuildInfo` / `DesktopBuildVersionSettingsRow`: this build's
//! channel and version as Settings › General shows them, and the
//! diagnostics its copy button puts on the clipboard.
use crate::platform::build_identity::{self, Channel};

pub struct BuildInfo {
    /// `CHANNEL_MESSAGE_IDS`.
    pub channel_key: &'static str,
    pub version: String,
    pub diagnostics: String,
}

pub fn current() -> BuildInfo {
    let identity = build_identity::current();
    BuildInfo {
        channel_key: match identity.channel {
            Channel::Dev => "shell.build.channel.dev",
            Channel::Internal => "shell.build.channel.internal",
            Channel::Stable => "shell.build.channel.stable",
        },
        diagnostics: identity.diagnostics(),
        version: identity.version,
    }
}
