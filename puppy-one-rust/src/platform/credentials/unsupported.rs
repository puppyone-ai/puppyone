use super::{CredentialStore, Error, Namespace, validate_account, validate_secret};
use crate::platform::unsupported::Availability;

const MSG: &str = "Secure credential storage is not available on this platform.";

pub(super) struct Store;

impl Store {
    pub(super) fn new() -> Self {
        Self
    }
}

impl CredentialStore for Store {
    fn get(&self, _ns: Namespace, account: &str) -> Result<Option<Vec<u8>>, Error> {
        validate_account(account)?;
        Err(Error::Unavailable(MSG.into()))
    }

    fn set(&self, _ns: Namespace, account: &str, secret: &[u8]) -> Result<(), Error> {
        validate_account(account)?;
        validate_secret(secret)?;
        Err(Error::Unavailable(MSG.into()))
    }

    fn delete(&self, _ns: Namespace, account: &str) -> Result<(), Error> {
        validate_account(account)?;
        Err(Error::Unavailable(MSG.into()))
    }

    fn availability(&self) -> Availability {
        Availability::unavailable_with_detail("credentials", "native.credentials.unavailable", MSG)
    }
}
