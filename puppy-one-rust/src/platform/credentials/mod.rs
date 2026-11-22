//! Cross-platform OS credential store (`credentials.md`).
//!
//! All four product credential namespaces share one synchronous [`CredentialStore`]
//! trait so worker threads and the Agent host can access secrets without GPUI's
//! foreground `App`:
//! - [`Namespace::CloudSignIn`] -> `"Puppyone Native Cloud Auth"`
//! - [`Namespace::CloudGit`] -> `"PuppyOne Cloud Git credential"`
//! - [`Namespace::HostDeviceKey`] -> `"PuppyOne Host Device Key"`
//! - [`Namespace::ModelConnection`] -> `"PuppyOne GPUI Model Connections"`
//!
//! Service names and account formats are preserved verbatim on macOS so upgrades
//! never sign users out. Missing or locked stores fail closed (`Unavailable` /
//! `Locked`) and never write plaintext secrets to disk.
use super::unsupported::Availability;
use std::fmt;

/// Maximum secret payload accepted across every backend (64 KiB).
pub const MAX_SECRET_BYTES: usize = 64 * 1024;

/// Fixed product credential namespaces. Exact macOS Keychain service names are
/// preserved for upgrade compatibility.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Namespace {
    CloudSignIn,
    CloudGit,
    HostDeviceKey,
    ModelConnection,
}

impl Namespace {
    /// Exact OS service identifier (matches existing macOS Keychain service names).
    pub const fn service_name(self) -> &'static str {
        match self {
            Self::CloudSignIn => "Puppyone Native Cloud Auth",
            Self::CloudGit => "PuppyOne Cloud Git credential",
            Self::HostDeviceKey => "PuppyOne Host Device Key",
            Self::ModelConnection => "PuppyOne GPUI Model Connections",
        }
    }
}

/// Typed credential storage errors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// No secure credential store is available on this OS or session.
    Unavailable(String),
    /// The OS credential store is locked and needs the user to unlock it.
    Locked,
    /// Secret exceeds backend or contract limit; never silently truncated.
    TooLarge { limit: usize },
    /// Underlying OS backend error.
    Backend(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(msg) => f.write_str(msg),
            Self::Locked => f.write_str("The system credential store is locked."),
            Self::TooLarge { limit } => {
                write!(f, "Credential exceeds the {limit}-byte storage limit.")
            }
            Self::Backend(msg) => f.write_str(msg),
        }
    }
}

impl std::error::Error for Error {}

/// Synchronous OS credential store interface.
pub trait CredentialStore: Send + Sync {
    fn get(&self, ns: Namespace, account: &str) -> Result<Option<Vec<u8>>, Error>;
    fn set(&self, ns: Namespace, account: &str, secret: &[u8]) -> Result<(), Error>;
    fn delete(&self, ns: Namespace, account: &str) -> Result<(), Error>;
    fn availability(&self) -> Availability;
}

/// Validates account identifiers shared by all backends.
pub(crate) fn validate_account(account: &str) -> Result<(), Error> {
    if account.is_empty() || account.len() > 512 || account.contains('\0') {
        return Err(Error::Backend(
            "Invalid credential account identifier.".into(),
        ));
    }
    Ok(())
}

/// Validates secret length shared by all backends (never silently truncates).
pub(crate) fn validate_secret(secret: &[u8]) -> Result<(), Error> {
    if secret.len() > MAX_SECRET_BYTES {
        return Err(Error::TooLarge {
            limit: MAX_SECRET_BYTES,
        });
    }
    Ok(())
}

/// Returns the active operating system's credential store implementation.
pub fn system() -> Box<dyn CredentialStore> {
    Box::new(imp::Store::new())
}

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod imp;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod imp;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod imp;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
#[path = "unsupported.rs"]
mod imp;

#[cfg(any(test, feature = "test-support"))]
pub mod memory;

#[cfg(test)]
mod tests;
