//! This computer's device identity per account (`device-identity.mjs`): an
//! Ed25519 key whose public half the Cloud registers, which signs this
//! computer's device connection and is its SSH host key. The private key is
//! kept in the system keychain; the file beside it holds only public IDs and
//! the public key. A lost registration reply retries with the same key; an
//! identity is never reused across accounts or deployments.
use super::ssh::new_key;
use base64::{Engine, engine::general_purpose::STANDARD};
use russh::keys::{
    PrivateKey,
    signature::Signer as _,
    ssh_key::private::{Ed25519Keypair, KeypairData},
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use zeroize::Zeroize;

/// Where device keys are kept; nothing else ever holds a private key.
pub trait KeyStore: Send + Sync {
    fn put(&self, item: &str, secret: &[u8]) -> Result<(), String>;
    fn get(&self, item: &str) -> Result<Option<Vec<u8>>, String>;
    fn delete(&self, item: &str) -> Result<(), String>;
}
/// The login keychain (macOS), under the host's own service name.
#[cfg(target_os = "macos")]
pub struct Keychain;
#[cfg(target_os = "macos")]
const SERVICE: &str = "PuppyOne Host Device Key";
#[cfg(target_os = "macos")]
impl KeyStore for Keychain {
    fn put(&self, item: &str, secret: &[u8]) -> Result<(), String> {
        security_framework::passwords::set_generic_password(SERVICE, item, secret)
            .map_err(|e| e.to_string())
    }
    fn get(&self, item: &str) -> Result<Option<Vec<u8>>, String> {
        match security_framework::passwords::get_generic_password(SERVICE, item) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.code() == -25300 => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn delete(&self, item: &str) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(SERVICE, item) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}
/// Keys in memory, for tests.
#[derive(Default)]
pub struct MemoryKeys(Mutex<std::collections::HashMap<String, Vec<u8>>>);
impl KeyStore for MemoryKeys {
    fn put(&self, item: &str, secret: &[u8]) -> Result<(), String> {
        self.0.lock().unwrap().insert(item.into(), secret.to_vec());
        Ok(())
    }
    fn get(&self, item: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(self.0.lock().unwrap().get(item).cloned())
    }
    fn delete(&self, item: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(item);
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    deployment: String,
    account_id: String,
    /// Raw Ed25519 public key, base64.
    public_key: String,
    /// The keychain item holding its seed.
    key_item: String,
    device_id: Option<String>,
}
/// A registered identity: whose, and which device.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Owner {
    pub account_id: String,
    pub device_id: String,
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok() && value.len() == 36
}

pub struct DeviceIdentity {
    file: PathBuf,
    keys: Box<dyn KeyStore>,
    deployment: String,
    serial: Mutex<()>,
}
impl DeviceIdentity {
    pub fn new(file: PathBuf, keys: Box<dyn KeyStore>, deployment: &str) -> Self {
        Self {
            file,
            keys,
            deployment: deployment.to_owned(),
            serial: Mutex::new(()),
        }
    }
    fn load(&self) -> Result<Vec<Record>, String> {
        match std::fs::read(&self.file) {
            Ok(bytes) => {
                let records: Vec<Record> =
                    serde_json::from_slice(&bytes).map_err(|_| "Invalid device identities.")?;
                if records.len() > 32 {
                    return Err("Invalid device identities.".into());
                }
                Ok(records)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.to_string()),
        }
    }
    fn save(&self, records: &[Record]) -> Result<(), String> {
        save_private(
            &self.file,
            &serde_json::to_vec(records).map_err(|e| e.to_string())?,
        )
    }
    /// This account's registered identity here (nobody needs to be signed in).
    pub fn existing_for(&self, account: &str) -> Option<Owner> {
        if !uuid(account) {
            return None;
        }
        self.load().ok()?.into_iter().find_map(|r| {
            (r.deployment == self.deployment && r.account_id == account)
                .then_some(r.device_id)
                .flatten()
                .filter(|d| uuid(d))
                .map(|device_id| Owner {
                    account_id: account.to_owned(),
                    device_id,
                })
        })
    }
    /// Registers this computer for `account` with `register(public_key)`
    /// (`POST /hosts/devices`), which answers the device id. The same key is
    /// sent again after a lost reply; the Cloud answers the same id.
    pub fn register(
        &self,
        account: &str,
        register: impl FnOnce(&str) -> Result<String, String>,
    ) -> Result<Owner, String> {
        let _serial = self.serial.lock().unwrap();
        if !uuid(account) {
            return Err("Sign in before registering a device.".into());
        }
        let mut records = self.load()?;
        let index = match records
            .iter()
            .position(|r| r.deployment == self.deployment && r.account_id == account)
        {
            Some(index) => index,
            None => {
                let key = new_key();
                let KeypairData::Ed25519(pair) = key.key_data() else {
                    return Err("Unsupported device key.".into());
                };
                let item = format!("{}|{account}|{}", self.deployment, uuid::Uuid::new_v4());
                let mut seed = STANDARD.encode(pair.private.to_bytes());
                let stored = self.keys.put(&item, seed.as_bytes());
                seed.zeroize();
                stored.map_err(|_| "Device key storage is unavailable.")?;
                records.push(Record {
                    deployment: self.deployment.clone(),
                    account_id: account.to_owned(),
                    public_key: STANDARD.encode(pair.public.0),
                    key_item: item,
                    device_id: None,
                });
                self.save(&records)?;
                records.len() - 1
            }
        };
        if let Some(device) = records[index].device_id.clone().filter(|d| uuid(d)) {
            return Ok(Owner {
                account_id: account.to_owned(),
                device_id: device,
            });
        }
        let device = register(&records[index].public_key)?;
        if !uuid(&device) {
            return Err("Device registration returned an invalid ID.".into());
        }
        records[index].device_id = Some(device.to_lowercase());
        self.save(&records)?;
        Ok(Owner {
            account_id: account.to_owned(),
            device_id: device.to_lowercase(),
        })
    }
    /// After a definite revocation: the key goes, so a later share registers
    /// a new device.
    pub fn forget(&self, owner: &Owner) -> bool {
        let _serial = self.serial.lock().unwrap();
        let Ok(mut records) = self.load() else {
            return false;
        };
        let before = records.len();
        records.retain(|r| {
            let gone = r.deployment == self.deployment
                && r.account_id == owner.account_id
                && r.device_id.as_deref() == Some(owner.device_id.as_str());
            if gone {
                let _ = self.keys.delete(&r.key_item);
            }
            !gone
        });
        records.len() != before && self.save(&records).is_ok()
    }
    /// The device key of a registered identity, in memory only.
    pub fn key(&self, owner: &Owner) -> Result<PrivateKey, String> {
        let record = self
            .load()?
            .into_iter()
            .find(|r| {
                r.deployment == self.deployment
                    && r.account_id == owner.account_id
                    && r.device_id.as_deref() == Some(owner.device_id.as_str())
            })
            .ok_or("This device is not registered.")?;
        let mut stored = self
            .keys
            .get(&record.key_item)?
            .ok_or("This device's key is missing.")?;
        let seed = STANDARD.decode(&stored).map_err(|_| "Invalid device key.");
        stored.zeroize();
        let mut seed = seed?;
        let bytes: [u8; 32] = seed
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid device key.")?;
        seed.zeroize();
        let pair = Ed25519Keypair::from_seed(&bytes);
        if STANDARD.encode(pair.public.0) != record.public_key {
            return Err("This device's key does not match its registration.".into());
        }
        Ok(PrivateKey::from(pair))
    }
    /// `signForDevice`: the device key's raw Ed25519 signature, base64.
    pub fn sign(&self, owner: &Owner, payload: &str) -> Result<String, String> {
        let key = self.key(owner)?;
        let KeypairData::Ed25519(pair) = key.key_data() else {
            return Err("Unsupported device key.".into());
        };
        let signature: russh::keys::ssh_key::Signature = pair
            .try_sign(payload.as_bytes())
            .map_err(|e| e.to_string())?;
        Ok(STANDARD.encode(signature.as_bytes()))
    }
}

/// Written whole, for this user only.
pub(super) fn save_private(file: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let written = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut out = options.open(&temp)?;
        out.write_all(bytes)?;
        out.sync_all()?;
        std::fs::rename(&temp, file)
    })();
    let _ = std::fs::remove_file(&temp);
    written.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::signature::Verifier as _;

    const ACCOUNT: &str = "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f";
    const DEVICE: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";

    /// One key per account here: a lost reply registers the same key again,
    /// the key signs as the Cloud checks, and revocation forgets it.
    #[test]
    fn a_device_registers_once_per_account_and_signs_with_its_key() {
        let temp = tempfile::tempdir().unwrap();
        let identity = DeviceIdentity::new(
            temp.path().join("host-device-identity.json"),
            Box::new(MemoryKeys::default()),
            "https://api.puppyone.ai/api/v1",
        );
        let sent = Mutex::new(Vec::<String>::new());
        assert!(
            identity
                .register(ACCOUNT, |key| {
                    sent.lock().unwrap().push(key.into());
                    Err("lost".into())
                })
                .is_err()
        );
        let owner = identity
            .register(ACCOUNT, |key| {
                sent.lock().unwrap().push(key.into());
                Ok(DEVICE.into())
            })
            .unwrap();
        let sent = sent.into_inner().unwrap();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0], sent[1], "the same key after a lost reply");
        assert_eq!(identity.existing_for(ACCOUNT), Some(owner.clone()));
        // Registered: no new request.
        assert_eq!(
            identity
                .register(ACCOUNT, |_| panic!("registered"))
                .unwrap(),
            owner
        );
        let signature = STANDARD
            .decode(identity.sign(&owner, "puppyone-device-v1\nx").unwrap())
            .unwrap();
        let public: [u8; 32] = STANDARD.decode(&sent[0]).unwrap().try_into().unwrap();
        let verifying = russh::keys::ssh_key::public::Ed25519PublicKey(public);
        let signature = russh::keys::ssh_key::Signature::new(
            russh::keys::ssh_key::Algorithm::Ed25519,
            signature,
        )
        .unwrap();
        assert!(
            verifying
                .verify(b"puppyone-device-v1\nx", &signature)
                .is_ok()
        );
        let text = std::fs::read_to_string(temp.path().join("host-device-identity.json")).unwrap();
        assert!(!text.contains("private"), "only public parts on disk");
        assert!(identity.forget(&owner));
        assert!(identity.existing_for(ACCOUNT).is_none());
        assert!(identity.key(&owner).is_err());
    }
}
