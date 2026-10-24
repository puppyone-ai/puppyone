//! Native model connections. Credentials live in the OS keychain, never JSON or command arguments.
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelConnection {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub model: String,
    pub images: bool,
    pub authenticated: bool,
    #[serde(default)]
    pub credential_id: Option<String>,
    pub generation: String,
}
impl ModelConnection {
    fn credential_reference(&self) -> Option<&str> {
        self.credential_id
            .as_deref()
            .or_else(|| self.authenticated.then_some(self.id.as_str()))
    }
    pub fn validate(&self) -> Result<(), String> {
        uuid::Uuid::parse_str(&self.id)
            .map_err(|_| crate::localization::t("native.modelConnections.invalidIdentity"))?;
        if self.name.trim().is_empty() || self.model.trim().is_empty() || self.model.len() > 256 {
            return Err(crate::localization::t("native.modelConnections.nameModelRequired").into());
        }
        let u = reqwest::Url::parse(&self.endpoint)
            .map_err(|_| crate::localization::t("native.modelConnections.invalidUrl"))?;
        let local = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if (u.scheme() != "https" && !(u.scheme() == "http" && local))
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
        {
            return Err(crate::localization::t("native.modelConnections.insecureUrl").into());
        }
        Ok(())
    }
    pub fn route(&self) -> String {
        format!("{}/{}", self.id, self.model)
    }
    pub fn credential(&self) -> Result<Option<String>, String> {
        if !self.authenticated {
            return Ok(None);
        }
        #[cfg(target_os = "macos")]
        {
            let value = security_framework::passwords::get_generic_password(
                "PuppyOne GPUI Model Connections",
                self.credential_id.as_deref().unwrap_or(&self.id),
            )
            .map_err(|_| crate::localization::t("native.modelConnections.credentialUnavailable"))?;
            String::from_utf8(value).map(Some).map_err(|_| {
                crate::localization::t("native.modelConnections.credentialInvalid").into()
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err(crate::localization::t("native.modelConnections.noCredentialStorage").into())
        }
    }
}
pub fn data_dir() -> PathBuf {
    std::env::var_os("PUPPYONE_RUST_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                .join("Library/Application Support/PuppyOne GPUI")
        })
}
pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> Result<T, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = vec![];
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(crate::localization::t("native.modelConnections.readLimit").into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or(crate::localization::t(
        "native.modelConnections.missingStorage",
    ))?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        serde_json::to_writer(&mut file, value)?;
        file.flush()?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })()
    .map_err(|e| e.to_string());
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}
pub fn load() -> Result<Vec<ModelConnection>, String> {
    let path = data_dir().join("model-connections.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let connections: Vec<ModelConnection> = read_json(&path, 256 * 1024)?;
    if connections.len() > 32 {
        return Err(crate::localization::t("native.modelConnections.tooMany").into());
    }
    let mut identities = std::collections::HashSet::new();
    for c in &connections {
        c.validate()?;
        if !identities.insert(&c.id) {
            return Err(crate::localization::t("native.modelConnections.duplicate").into());
        }
    }
    Ok(connections)
}
static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
fn check_generation(existing: Option<&ModelConnection>, generation: &str) -> Result<(), String> {
    match existing {
        Some(existing) if existing.generation != generation => {
            Err(crate::localization::t("native.modelConnections.editedElsewhere").into())
        }
        None if !generation.is_empty() => {
            Err(crate::localization::t("native.modelConnections.removedElsewhere").into())
        }
        _ => Ok(()),
    }
}
fn retired_credential<'a>(
    previous: Option<&'a ModelConnection>,
    connections: &[ModelConnection],
) -> Option<&'a str> {
    let reference = previous?.credential_reference()?;
    (!connections
        .iter()
        .any(|c| c.credential_reference() == Some(reference)))
    .then_some(reference)
}
fn delete_credential(id: &str) {
    #[cfg(target_os = "macos")]
    let _ = security_framework::passwords::delete_generic_password(
        "PuppyOne GPUI Model Connections",
        id,
    );
    #[cfg(not(target_os = "macos"))]
    let _ = id;
}
pub fn save(mut connection: ModelConnection, secret: Option<String>) -> Result<(), String> {
    let _guard = WRITES
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    connection.validate()?;
    let mut connections = load()?;
    let previous = connections.iter().find(|c| c.id == connection.id).cloned();
    check_generation(previous.as_ref(), &connection.generation)?;
    // The caller cannot select an arbitrary Keychain item. Keep only the persisted
    // reference, or allocate a fresh one below when explicitly replacing the key.
    connection.credential_id = previous.as_ref().and_then(|c| c.credential_id.clone());
    if !connection.authenticated {
        connection.credential_id = None;
    } else if secret.is_none() && !previous.as_ref().is_some_and(|c| c.authenticated) {
        return Err(crate::localization::t("native.modelConnections.keyRequiredForAuth").into());
    }
    let mut staged_credential: Option<String> = None;
    if connections.len() >= 32 && !connections.iter().any(|c| c.id == connection.id) {
        return Err(crate::localization::t("native.modelConnections.limitReached").into());
    }
    if let Some(secret) = secret {
        if secret.trim().is_empty() || secret.len() > 16384 || secret.contains(['\r', '\n']) {
            return Err(crate::localization::t("native.modelConnections.invalidKey").into());
        }
        let credential_id = uuid::Uuid::new_v4().to_string();
        #[cfg(target_os = "macos")]
        security_framework::passwords::set_generic_password(
            "PuppyOne GPUI Model Connections",
            &credential_id,
            secret.trim().as_bytes(),
        )
        .map_err(|_| crate::localization::t("native.modelConnections.keychainSaveFailed"))?;
        #[cfg(not(target_os = "macos"))]
        return Err(crate::localization::t("native.modelConnections.noCredentialStorage").into());
        connection.authenticated = true;
        connection.credential_id = Some(credential_id.clone());
        staged_credential = Some(credential_id);
    }
    connection.generation = uuid::Uuid::new_v4().to_string();
    connections.retain(|c| c.id != connection.id);
    connections.push(connection);
    let result = write_json(&data_dir().join("model-connections.json"), &connections);
    if result.is_err() {
        if let Some(id) = staged_credential {
            delete_credential(&id);
        }
    } else if let Some(id) = retired_credential(previous.as_ref(), &connections) {
        // Retire only after publishing the new configuration, never before it.
        delete_credential(id);
    }
    result
}
pub fn remove(id: &str, generation: &str) -> Result<(), String> {
    let _guard = WRITES
        .lock()
        .map_err(|_| crate::localization::t("native.modelConnections.lockFailed"))?;
    let mut connections = load()?;
    let index = connections
        .iter()
        .position(|c| c.id == id)
        .ok_or(crate::localization::t("native.modelConnections.missing"))?;
    if connections[index].generation != generation {
        return Err(crate::localization::t("native.modelConnections.changedBeforeRemove").into());
    }
    let connection = connections.remove(index);
    write_json(&data_dir().join("model-connections.json"), &connections)?;
    if let Some(id) = retired_credential(Some(&connection), &connections) {
        delete_credential(id);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_edit_and_delete_do_not_resurrect_or_retire_active_credentials() {
        let mut old = ModelConnection {
            id: uuid::Uuid::new_v4().to_string(),
            name: "local".into(),
            endpoint: "https://example.com/v1".into(),
            model: "model".into(),
            images: false,
            authenticated: true,
            credential_id: Some("old-key".into()),
            generation: "revision-1".into(),
        };
        assert!(check_generation(Some(&old), "revision-1").is_ok());
        assert!(check_generation(Some(&old), "revision-0").is_err());
        assert!(check_generation(None, "revision-1").is_err());
        assert!(check_generation(None, "").is_ok());
        assert_eq!(retired_credential(Some(&old), &[old.clone()]), None);
        let mut replacement = old.clone();
        replacement.credential_id = Some("new-key".into());
        assert_eq!(
            retired_credential(Some(&old), &[replacement]),
            Some("old-key")
        );
        assert_eq!(retired_credential(Some(&old), &[]), Some("old-key"));
        old.credential_id = None; // Legacy credentials were keyed by connection ID.
        assert_eq!(retired_credential(Some(&old), &[]), Some(old.id.as_str()));
        old.authenticated = false;
        assert_eq!(retired_credential(Some(&old), &[]), None);
    }
    #[test]
    fn endpoint_boundary_rejects_credentials_redirect_shapes_and_remote_http() {
        let mut c = ModelConnection {
            id: uuid::Uuid::new_v4().to_string(),
            name: "local".into(),
            endpoint: "http://127.0.0.1:9000/v1".into(),
            model: "model".into(),
            images: false,
            authenticated: false,
            credential_id: None,
            generation: "g".into(),
        };
        assert!(c.validate().is_ok());
        for endpoint in [
            "http://example.com/v1",
            "https://user:pass@example.com",
            "https://example.com?key=secret",
            "file:///tmp/key",
        ] {
            c.endpoint = endpoint.into();
            assert!(c.validate().is_err());
        }
    }
}
