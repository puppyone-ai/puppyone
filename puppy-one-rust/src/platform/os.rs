//! The single place in the repository that names the current operating system
//! and CPU architecture. Upper layers query [`Os::current`] or
//! [`crate::platform::conventions::Conventions`] instead of writing `cfg(target_os)`.

/// Supported desktop operating systems.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Os {
    Macos,
    Windows,
    Linux,
    Other,
}

/// Supported CPU architectures.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Arch {
    Arm64,
    X64,
    Other,
}

impl Os {
    /// The operating system this binary was compiled for.
    pub const fn current() -> Self {
        #[cfg(target_os = "macos")]
        {
            Self::Macos
        }
        #[cfg(target_os = "windows")]
        {
            Self::Windows
        }
        #[cfg(target_os = "linux")]
        {
            Self::Linux
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            Self::Other
        }
    }

    pub const fn is_macos(self) -> bool {
        matches!(self, Self::Macos)
    }

    pub const fn is_windows(self) -> bool {
        matches!(self, Self::Windows)
    }

    pub const fn is_linux(self) -> bool {
        matches!(self, Self::Linux)
    }

    pub const fn is_unix_like(self) -> bool {
        matches!(self, Self::Macos | Self::Linux)
    }

    /// Stable machine identifier used by release metadata and feeds.
    pub const fn key(self) -> &'static str {
        match self {
            Self::Macos => "mac",
            Self::Windows => "win",
            Self::Linux => "linux",
            Self::Other => "other",
        }
    }
}

impl Arch {
    /// The CPU architecture this binary was compiled for.
    pub const fn current() -> Self {
        #[cfg(target_arch = "aarch64")]
        {
            Self::Arm64
        }
        #[cfg(target_arch = "x86_64")]
        {
            Self::X64
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            Self::Other
        }
    }

    /// Stable architecture identifier matching release artifact naming.
    pub const fn key(self) -> &'static str {
        match self {
            Self::Arm64 => "arm64",
            Self::X64 => "x64",
            Self::Other => "other",
        }
    }
}

/// Current `(Os, Arch)` pair.
pub const fn current() -> (Os, Arch) {
    (Os::current(), Arch::current())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_os_and_arch_have_stable_keys() {
        let (os, arch) = current();
        assert!(!os.key().is_empty());
        assert!(!arch.key().is_empty());
        assert!(Os::Macos.is_macos());
        assert!(Os::Windows.is_windows());
        assert!(Os::Linux.is_linux());
        assert!(Os::Macos.is_unix_like());
        assert!(Os::Linux.is_unix_like());
        assert!(!Os::Windows.is_unix_like());
        assert_eq!(Os::Macos.key(), "mac");
        assert_eq!(Os::Windows.key(), "win");
        assert_eq!(Os::Linux.key(), "linux");
        assert_eq!(Arch::Arm64.key(), "arm64");
        assert_eq!(Arch::X64.key(), "x64");
    }
}
