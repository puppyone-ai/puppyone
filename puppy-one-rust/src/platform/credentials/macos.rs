use super::{CredentialStore, Error, Namespace, validate_account, validate_secret};
use crate::platform::unsupported::Availability;

const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;

pub(super) struct Store;

impl Store {
    pub(super) fn new() -> Self {
        Self
    }
}

impl CredentialStore for Store {
    fn get(&self, ns: Namespace, account: &str) -> Result<Option<Vec<u8>>, Error> {
        validate_account(account)?;
        match security_framework::passwords::get_generic_password(ns.service_name(), account) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(e) if e.code() == ERR_SEC_INTERACTION_NOT_ALLOWED => Err(Error::Locked),
            Err(e) => Err(Error::Backend(e.to_string())),
        }
    }

    fn set(&self, ns: Namespace, account: &str, secret: &[u8]) -> Result<(), Error> {
        validate_account(account)?;
        validate_secret(secret)?;
        security_framework::passwords::set_generic_password(ns.service_name(), account, secret)
            .map_err(|e| {
                if e.code() == ERR_SEC_INTERACTION_NOT_ALLOWED {
                    Error::Locked
                } else {
                    Error::Backend(e.to_string())
                }
            })
    }

    fn delete(&self, ns: Namespace, account: &str) -> Result<(), Error> {
        validate_account(account)?;
        match security_framework::passwords::delete_generic_password(ns.service_name(), account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(e) if e.code() == ERR_SEC_INTERACTION_NOT_ALLOWED => Err(Error::Locked),
            Err(e) => Err(Error::Backend(e.to_string())),
        }
    }

    fn availability(&self) -> Availability {
        Availability::Available
    }
}
