use super::model::*;
#[cfg(any(target_os = "macos", test))]
use zeroize::Zeroize;

pub(super) trait Store: Send + Sync {
    fn load(&self) -> Result<Option<Credential>>;
    fn save(&self, credential: &Credential) -> Result<()>;
    fn clear(&self) -> Result<()>;
}
#[cfg(target_os = "macos")]
pub(super) struct Keychain {
    account: String,
}
#[cfg(target_os = "macos")]
const SERVICE: &str = "Puppyone Native Cloud Auth";
#[cfg(target_os = "macos")]
impl Keychain {
    pub fn new() -> Self {
        // Separate native profile and service; never inspect Electron credentials.
        Self {
            account: profile_account(std::env::var_os("PUPPYONE_RUST_DATA_DIR").as_deref()),
        }
    }
}
#[cfg(any(target_os = "macos", test))]
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
#[cfg(any(target_os = "macos", test))]
pub(super) trait Items {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>>;
    fn set(&self, account: &str, bytes: &[u8]) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
}
/// `readCredential`: the saved sign-in, or `None`. An unreadable record is
/// set aside as `<account>.corrupt.<time>` (`quarantineCorruptFile`) and
/// the account reads as signed out — never as a silent, valid logout.
#[cfg(any(target_os = "macos", test))]
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
#[cfg(any(target_os = "macos", test))]
pub(super) fn save(items: &dyn Items, account: &str, credential: &Credential) -> Result<()> {
    let mut bytes = serde_json::to_vec(credential).map_err(|_| Error::SecureStorage)?;
    let result = items.set(account, &bytes);
    bytes.zeroize();
    result
}
#[cfg(target_os = "macos")]
struct Service;
#[cfg(target_os = "macos")]
impl Items for Service {
    fn get(&self, account: &str) -> Result<Option<Vec<u8>>> {
        match security_framework::passwords::get_generic_password(SERVICE, account) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound only
            Err(_) => Err(Error::SecureStorage),
        }
    }
    fn set(&self, account: &str, bytes: &[u8]) -> Result<()> {
        security_framework::passwords::set_generic_password(SERVICE, account, bytes)
            .map_err(|_| Error::SecureStorage)
    }
    fn delete(&self, account: &str) -> Result<()> {
        match security_framework::passwords::delete_generic_password(SERVICE, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(_) => Err(Error::SecureStorage),
        }
    }
}
#[cfg(target_os = "macos")]
impl Store for Keychain {
    fn load(&self) -> Result<Option<Credential>> {
        load(&Service, &self.account)
    }
    fn save(&self, credential: &Credential) -> Result<()> {
        save(&Service, &self.account, credential)
    }
    fn clear(&self) -> Result<()> {
        Service.delete(&self.account)
    }
}
