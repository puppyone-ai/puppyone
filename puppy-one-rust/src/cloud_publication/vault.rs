//! `cloud-publish-secret-vault.mjs`: the operation's Git credential secret,
//! kept only in the system keychain under an opaque reference. The journal
//! stores the reference, never the secret.
use std::{collections::HashMap, sync::Mutex};

pub trait SecretVault: Send + Sync {
    fn create_ref(&self) -> String {
        uuid::Uuid::new_v4().to_string()
    }
    fn put(&self, reference: &str, secret: &str) -> Result<(), String>;
    fn get(&self, reference: &str) -> Result<Option<String>, String>;
    fn clear(&self, reference: &str) -> Result<(), String>;
}

/// The macOS keychain (generic passwords).
pub struct Keychain;
const SERVICE: &str = "PuppyOne Cloud Git credential";
impl SecretVault for Keychain {
    #[cfg(target_os = "macos")]
    fn put(&self, reference: &str, secret: &str) -> Result<(), String> {
        security_framework::passwords::set_generic_password(SERVICE, reference, secret.as_bytes())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    fn get(&self, reference: &str) -> Result<Option<String>, String> {
        match security_framework::passwords::get_generic_password(SERVICE, reference) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|e| e.to_string()),
            Err(e) if e.code() == -25300 => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(target_os = "macos")]
    fn clear(&self, reference: &str) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(SERVICE, reference) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    fn put(&self, _: &str, _: &str) -> Result<(), String> {
        Err("No secure credential store on this platform".into())
    }
    #[cfg(not(target_os = "macos"))]
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    #[cfg(not(target_os = "macos"))]
    fn clear(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

/// Tests: an in-memory vault.
#[derive(Default)]
pub struct Memory(pub Mutex<HashMap<String, String>>);
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
