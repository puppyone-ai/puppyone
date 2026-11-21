use super::model::*;
use crate::platform::credentials::{self, CredentialStore, Namespace};
use zeroize::Zeroize;

pub(super) trait Store: Send + Sync {
    fn load(&self) -> Result<Option<Credential>>;
    fn save(&self, credential: &Credential) -> Result<()>;
    fn clear(&self) -> Result<()>;
}

pub(super) struct Keychain {
    account: String,
    backend: Box<dyn CredentialStore>,
}

impl Keychain {
    pub fn new() -> Self {
        // Separate native profile and service; never inspect Electron credentials.
        Self {
            account: profile_account(std::env::var_os("PUPPYONE_RUST_DATA_DIR").as_deref()),
            backend: credentials::system(),
        }
    }

    pub fn is_available(&self) -> bool {
        self.backend.availability().is_available()
    }
}

pub(super) fn profile_account(profile: Option<&std::ffi::OsStr>) -> String {
    match profile {
        None => "session-v1/default".into(),
        Some(path) => format!(
            "session-v1/profile:{}",
            blake3::hash(path.as_encoded_bytes()).to_hex()
        ),
    }
}

/// The generic-password items of one keychain service, by account.
pub(super) trait Items {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>>;
    fn set(&self, account: &str, bytes: &[u8]) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
}

/// `readCredential`: the saved sign-in, or `None`. An unreadable record is
/// set aside as `<account>.corrupt.<time>` (`quarantineCorruptFile`) and
/// the account reads as signed out — never as a silent, valid logout.
pub(super) fn load(items: &dyn Items, account: &str) -> Result<Option<Credential>> {
    let Some(mut bytes) = items.get(account)? else {
        return Ok(None);
    };
    let credential = (bytes.len() <= 24 * 1024)
        .then(|| serde_json::from_slice::<Credential>(&bytes).ok())
        .flatten()
        .filter(Credential::valid);
    if credential.is_none() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        let moved = items
            .set(&format!("{account}.corrupt.{stamp}"), &bytes)
            .and_then(|()| items.delete(account));
        bytes.zeroize();
        return moved.map(|()| None);
    }
    bytes.zeroize();
    Ok(credential)
}

/// `writeCredential`: only the refresh credential and who it belongs to;
/// an access token is never part of the record.
pub(super) fn save(items: &dyn Items, account: &str, credential: &Credential) -> Result<()> {
    let mut bytes = serde_json::to_vec(credential).map_err(|_| Error::SecureStorage)?;
    let result = items.set(account, &bytes);
    bytes.zeroize();
    result
}

struct Service<'a>(&'a dyn CredentialStore);

impl Items for Service<'_> {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>> {
        self.0
            .get(Namespace::CloudSignIn, account)
            .map_err(|_| Error::SecureStorage)
    }
    fn set(&self, account: &str, bytes: &[u8]) -> Result<()> {
        self.0
            .set(Namespace::CloudSignIn, account, bytes)
            .map_err(|_| Error::SecureStorage)
    }
    fn delete(&self, account: &str) -> Result<()> {
        self.0
            .delete(Namespace::CloudSignIn, account)
            .map_err(|_| Error::SecureStorage)
    }
}

impl Store for Keychain {
    fn load(&self) -> Result<Option<Credential>> {
        load(&Service(&*self.backend), &self.account)
    }
    fn save(&self, credential: &Credential) -> Result<()> {
        save(&Service(&*self.backend), &self.account, credential)
    }
    fn clear(&self) -> Result<()> {
        Service(&*self.backend).delete(&self.account)
    }
}
