//! In-memory [`CredentialStore`] test double so upper-layer tests never touch
//! the real OS keychain/keyring.
use super::{CredentialStore, Error, Namespace, validate_account, validate_secret};
use crate::platform::unsupported::Availability;
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
pub struct Store {
    entries: Mutex<HashMap<(Namespace, String), Vec<u8>>>,
}

impl Store {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStore for Store {
    fn get(&self, ns: Namespace, account: &str) -> Result<Option<Vec<u8>>, Error> {
        validate_account(account)?;
        Ok(self
            .entries
            .lock()
            .unwrap()
            .get(&(ns, account.to_owned()))
            .cloned())
    }

    fn set(&self, ns: Namespace, account: &str, secret: &[u8]) -> Result<(), Error> {
        validate_account(account)?;
        validate_secret(secret)?;
        self.entries
            .lock()
            .unwrap()
            .insert((ns, account.to_owned()), secret.to_vec());
        Ok(())
    }

    fn delete(&self, ns: Namespace, account: &str) -> Result<(), Error> {
        validate_account(account)?;
        self.entries
            .lock()
            .unwrap()
            .remove(&(ns, account.to_owned()));
        Ok(())
    }

    fn availability(&self) -> Availability {
        Availability::Available
    }
}
