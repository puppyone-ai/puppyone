//! The slice of the product's build identity (`shared/desktop-build-identity.mjs`)
//! that runtime policy reads: the release channel, whether this executable runs
//! from an application bundle (Electron's `app.isPackaged`), and the version.
//! Release coordinates, signing and update feeds belong to packaging (PL-1).

/// `DESKTOP_BUILD_CHANNELS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Dev,
    Internal,
    Stable,
}
impl Channel {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "dev" => Some(Self::Dev),
            "internal" => Some(Self::Internal),
            "stable" => Some(Self::Stable),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub channel: Channel,
    pub version: String,
    pub packaged: bool,
}

/// This build: the channel the release build stamped in
/// `PUPPYONE_BUILD_CHANNEL` (a development build otherwise), the crate
/// version, and whether the executable lives in `*.app/Contents/MacOS`.
pub fn current() -> Identity {
    Identity {
        channel: option_env!("PUPPYONE_BUILD_CHANNEL")
            .and_then(Channel::parse)
            .unwrap_or(Channel::Dev),
        version: env!("CARGO_PKG_VERSION").to_string(),
        packaged: std::env::current_exe()
            .ok()
            .is_some_and(|exe| bundled(&exe)),
    }
}

fn bundled(exe: &std::path::Path) -> bool {
    let mut parts = exe.ancestors().skip(1);
    let (Some(macos), Some(contents), Some(app)) = (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    macos.file_name().is_some_and(|n| n == "MacOS")
        && contents.file_name().is_some_and(|n| n == "Contents")
        && app.extension().is_some_and(|e| e == "app")
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
        assert!(!bundled(Path::new("/x/Contents/MacOS/puppy-one-rust")));
        assert!(!bundled(Path::new("puppy-one-rust")));
    }

    #[test]
    fn channels_and_node_names_follow_the_product() {
        assert_eq!(Channel::parse("stable"), Some(Channel::Stable));
        assert_eq!(Channel::parse("qubits"), None);
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
}
