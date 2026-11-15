//! The slice of the product's build identity (`shared/desktop-build-identity.mjs`)
//! that runtime policy reads: the release channel, whether this executable runs
//! from an application bundle (Electron's `app.isPackaged`), and the release
//! coordinates `tools/release/package-macos.py` stamps into a release build
//! (`PUPPYONE_BUILD_*`). An unstamped build is a development build of the
//! crate version.

/// `DESKTOP_BUILD_CHANNELS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Dev,
    Internal,
    Stable,
}
impl Channel {
    pub fn key(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Internal => "internal",
            Self::Stable => "stable",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "dev" => Some(Self::Dev),
            "internal" => Some(Self::Internal),
            "stable" => Some(Self::Stable),
            _ => None,
        }
    }
    /// Base human-readable application name per channel (`application-identity.mjs`).
    pub fn application_name(self) -> &'static str {
        match self {
            Self::Dev => "PuppyOne Rust Dev",
            Self::Internal => "PuppyOne Internal",
            Self::Stable => "PuppyOne",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub channel: Channel,
    pub version: String,
    pub packaged: bool,
    /// The release's build number, or `g<commit>` for a development build.
    pub build_id: Option<String>,
    pub commit: Option<String>,
    pub built_at: Option<String>,
    pub source_dirty: bool,
}
/// `puppy-one-rust --puppyone-build-identity` prints this build's identity
/// and exits, so packaging can check what it stamped.
pub const FLAG: &str = "--puppyone-build-identity";

impl Identity {
    /// The identity as `build-info.json` names it.
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "runtime": "gpui",
            "channel": self.channel.key(),
            "version": self.version,
            "buildId": self.build_id,
            "commitSha": self.commit,
            "builtAt": self.built_at,
            "sourceDirty": self.source_dirty,
        })
    }
    /// `formatDesktopBuildDiagnostics`: what Settings › General copies.
    pub fn diagnostics(&self) -> String {
        let unknown = |value: &Option<String>| value.clone().unwrap_or_else(|| "unknown".into());
        [
            "PuppyOne GPUI".to_string(),
            format!("Channel: {}", self.channel.key()),
            format!("Version: {}", self.version),
            format!("Build ID: {}", unknown(&self.build_id)),
            format!("Commit: {}", unknown(&self.commit)),
            format!("Built at: {}", unknown(&self.built_at)),
            format!("Source dirty: {}", self.source_dirty),
        ]
        .join("\n")
    }
}

/// This build: the channel and release coordinates a release build stamped
/// (`PUPPYONE_BUILD_CHANNEL`, `_VERSION`, `_ID`, `_COMMIT`, `_TIME`,
/// `_DIRTY`; a development build of the crate version otherwise), and
/// whether the executable lives in `*.app/Contents/MacOS`.
pub fn current() -> Identity {
    let stamp = |value: Option<&'static str>| value.filter(|v| !v.is_empty()).map(str::to_owned);
    Identity {
        channel: option_env!("PUPPYONE_BUILD_CHANNEL")
            .and_then(Channel::parse)
            .unwrap_or(Channel::Dev),
        version: stamp(option_env!("PUPPYONE_BUILD_VERSION"))
            .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string()),
        packaged: std::env::current_exe()
            .ok()
            .is_some_and(|exe| bundled(&exe)),
        build_id: stamp(option_env!("PUPPYONE_BUILD_ID")),
        commit: stamp(option_env!("PUPPYONE_BUILD_COMMIT")),
        built_at: stamp(option_env!("PUPPYONE_BUILD_TIME")),
        source_dirty: option_env!("PUPPYONE_BUILD_DIRTY") == Some("true"),
    }
}

fn bundled(exe: &std::path::Path) -> bool {
    let mut parts = exe.ancestors().skip(1);
    let (Some(macos), Some(contents), Some(app)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let in_cargo_target = app
        .parent()
        .and_then(|profile| {
            let name = profile.file_name()?.to_str()?;
            matches!(name, "debug" | "release").then_some(profile.parent()?)
        })
        .and_then(|target| target.file_name())
        .is_some_and(|n| n == "target");
    !in_cargo_target
        && macos.file_name().is_some_and(|n| n == "MacOS")
        && contents.file_name().is_some_and(|n| n == "Contents")
        && app.extension().is_some_and(|e| e == "app")
}

/// Resolves the runtime application display name. Published channels keep their
/// canonical product names (`PuppyOne`, `PuppyOne Internal`), whereas `Dev`
/// appends any secondary git worktree (`puppyone-rust-<slug>`) or isolated
/// `PUPPYONE_RUST_DATA_DIR` tag so concurrent local builds stay distinguishable.
pub fn resolve_application_name(
    channel: Channel,
    exe: Option<&std::path::Path>,
    custom_data_dir: Option<&std::path::Path>,
) -> String {
    let base = channel.application_name();
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

fn extract_data_dir_tag(dir: &std::path::Path) -> Option<String> {
    let mut raw = dir.file_name()?.to_str()?;
    // Ignore ephemeral `tempfile::tempdir()` folders (`.tmpXXXXXX`) used in tests.
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

/// Runtime display name for menus, window titles, and the macOS dev bundle.
pub fn application_name() -> String {
    if std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
        || std::env::var_os("PUPPYONE_LAB").is_some()
    {
        return Channel::Stable.application_name().to_owned();
    }
    let identity = current();
    let custom_data = std::env::var_os("PUPPYONE_RUST_DATA_DIR").map(std::path::PathBuf::from);
    resolve_application_name(
        identity.channel,
        std::env::current_exe().ok().as_deref(),
        custom_data.as_deref(),
    )
}

/// Node's `process.platform` for this operating system.
pub fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

/// Node's `process.arch` for this processor.
pub fn node_architecture() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        "x86" => "ia32",
        other => other,
    }
}

/// Electron's `process.getSystemVersion()`: the macOS product version
/// (`kern.osproductversion`), else the kernel release, else empty.
pub fn system_version() -> String {
    #[cfg(target_os = "macos")]
    if let Some(version) = sysctl_string(c"kern.osproductversion") {
        return version;
    }
    #[cfg(unix)]
    if let Some(release) = sysctl_string(c"kern.osrelease") {
        return release;
    }
    String::new()
}

#[cfg(unix)]
fn sysctl_string(name: &std::ffi::CStr) -> Option<String> {
    let mut buffer = [0u8; 64];
    let mut length = buffer.len();
    // SAFETY: a NUL-terminated name, a buffer of `length` bytes and no new value.
    let status = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            buffer.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 || length == 0 || length > buffer.len() {
        return None;
    }
    let text = &buffer[..length];
    let end = text.iter().position(|&b| b == 0).unwrap_or(text.len());
    let value = std::str::from_utf8(&text[..end]).ok()?.trim().to_string();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::path::Path;

    #[test]
    fn only_an_application_bundle_counts_as_packaged() {
        assert!(bundled(Path::new(
            "/Applications/PuppyOne.app/Contents/MacOS/puppy-one-rust"
        )));
        assert!(!bundled(Path::new(
            "/Users/me/puppy-one-rust/target/release/puppy-one-rust"
        )));
        assert!(!bundled(Path::new(
            "/Users/me/puppy-one-rust/target/debug/PuppyOne Rust Dev.app/Contents/MacOS/puppy-one-rust"
        )));
        assert!(!bundled(Path::new("/x/Contents/MacOS/puppy-one-rust")));
        assert!(!bundled(Path::new("puppy-one-rust")));
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
    }

    #[test]
    fn channels_and_node_names_follow_the_product() {
        assert_eq!(Channel::parse("stable"), Some(Channel::Stable));
        assert_eq!(Channel::parse("qubits"), None);
        for channel in [Channel::Dev, Channel::Internal, Channel::Stable] {
            assert_eq!(Channel::parse(channel.key()), Some(channel));
        }
        // A test executable is never bundled; an unstamped build is Dev.
        assert!(!current().packaged);
        if option_env!("PUPPYONE_BUILD_CHANNEL").is_none() {
            assert_eq!(current().channel, Channel::Dev);
        }
        assert!(["darwin", "win32", "linux"].contains(&node_platform()));
        assert!(!node_architecture().is_empty());
        #[cfg(target_os = "macos")]
        assert!(
            system_version()
                .split('.')
                .next()
                .is_some_and(|major| major.parse::<u32>().is_ok())
        );
    }

    /// `formatDesktopBuildDiagnostics`: every coordinate on its own line.
    #[test]
    fn diagnostics_name_every_coordinate() {
        let identity = Identity {
            channel: Channel::Internal,
            version: "0.4.4-internal.7".into(),
            packaged: true,
            build_id: Some("7".into()),
            commit: Some("abc".into()),
            built_at: None,
            source_dirty: false,
        };
        assert_eq!(identity.json()["buildId"], "7");
        assert_eq!(identity.json()["builtAt"], serde_json::Value::Null);
        assert_eq!(
            identity.diagnostics(),
            "PuppyOne GPUI\nChannel: internal\nVersion: 0.4.4-internal.7\nBuild ID: 7\n\
             Commit: abc\nBuilt at: unknown\nSource dirty: false"
        );
    }
}
