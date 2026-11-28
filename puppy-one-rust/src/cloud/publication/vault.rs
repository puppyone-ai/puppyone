//! `cloud-publish-secret-vault.mjs`: the operation's Git credential secret,
//! kept only in the system credential store under an opaque reference. The
//! journal stores the reference, never the secret.
use crate::platform::credentials::{self, Namespace};
#[cfg(any(test, feature = "test-support"))]
use std::{collections::HashMap, sync::Mutex};

pub trait SecretVault: Send + Sync {
    fn create_ref(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
    fn put(&self, reference: &str, secret: &str) -> Result<(), String>;
    fn get(&self, reference: &str) -> Result<Option<String>, String>;
    fn clear(&self, reference: &str) -> Result<(), String>;
}

/// System credential store under [`Namespace::CloudGit`].
pub struct Keychain;

impl SecretVault for Keychain {
    fn put(&self, reference: &str, secret: &str) -> Result<(), String> {
        credentials::system()
            .set(Namespace::CloudGit, reference, secret.as_bytes())
            .map_err(|e| e.to_string())
    }
    fn get(&self, reference: &str) -> Result<Option<String>, String> {
        match credentials::system().get(Namespace::CloudGit, reference) {
            Ok(Some(bytes)) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|e| e.to_string()),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn clear(&self, reference: &str) -> Result<(), String> {
        credentials::system()
            .delete(Namespace::CloudGit, reference)
            .map_err(|e| e.to_string())
    }
}

/// Tests: an in-memory vault.
#[cfg(any(test, feature = "test-support"))]
#[derive(Default)]
pub struct Memory(pub Mutex<HashMap<String, String>>);
#[cfg(any(test, feature = "test-support"))]
impl SecretVault for Memory {
    fn put(&self, reference: &str, secret: &str) -> Result<(), String> {
        self.0
            .lock()
            .unwrap()
            .insert(reference.into(), secret.into());
        Ok(())
    }
    fn get(&self, reference: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(reference).cloned())
    }
    fn clear(&self, reference: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(reference);
        Ok(())
    }
}
