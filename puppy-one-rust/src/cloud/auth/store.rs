use super::model::*;
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
#[cfg(target_os = "macos")]
impl Store for Keychain {
    fn load(&self) -> Result<Option<Credential>> {
        let mut bytes =
            match security_framework::passwords::get_generic_password(SERVICE, &self.account) {
                Ok(bytes) => bytes,
                Err(e) if e.code() == -25300 => return Ok(None), // errSecItemNotFound only
                Err(_) => return Err(Error::SecureStorage),
            };
        let credential = (bytes.len() <= 24 * 1024)
            .then(|| serde_json::from_slice::<Credential>(&bytes).ok())
            .flatten()
            .filter(Credential::valid);
        if credential.is_none() {
            // `quarantineCorruptFile`: an unreadable record is set aside, not
            // fatal, and the account reads as signed out.
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or_default();
            let aside = format!("{}.corrupt.{stamp}", self.account);
            let moved =
                security_framework::passwords::set_generic_password(SERVICE, &aside, &bytes)
                    .and_then(|_| {
                        security_framework::passwords::delete_generic_password(
                            SERVICE,
                            &self.account,
                        )
                    });
            bytes.zeroize();
            return match moved {
                Ok(()) => Ok(None),
                Err(_) => Err(Error::SecureStorage),
            };
        }
        bytes.zeroize();
        Ok(credential)
    }
    fn save(&self, credential: &Credential) -> Result<()> {
        let mut bytes = serde_json::to_vec(credential).map_err(|_| Error::SecureStorage)?;
        let result =
            security_framework::passwords::set_generic_password(SERVICE, &self.account, &bytes)
                .map_err(|_| Error::SecureStorage);
        bytes.zeroize();
        result
    }
    fn clear(&self) -> Result<()> {
        match security_framework::passwords::delete_generic_password(SERVICE, &self.account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(_) => Err(Error::SecureStorage),
        }
    }
}
