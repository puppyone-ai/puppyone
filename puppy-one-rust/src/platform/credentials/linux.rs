//! Linux Secret Service backend (`org.freedesktop.secrets`) using pure-Rust
//! `oo7` over `zbus` (no `libdbus` C dependency).
//!
//! Fail-closed rule: if no desktop D-Bus session or Secret Service daemon is
//! available, or the default keyring is locked, returns `Unavailable` / `Locked`
//! and never writes plaintext secrets to disk.
use super::{CredentialStore, Error, Namespace, validate_account, validate_secret};
use crate::platform::unsupported::Availability;
use std::collections::HashMap;

pub(super) struct Store;

impl Store {
    pub(super) fn new() -> Self {
        Self
    }
}

fn attributes(ns: Namespace, account: &str) -> HashMap<&'static str, String> {
    let mut map = HashMap::with_capacity(3);
    map.insert("application", "puppyone-gpui".to_owned());
    map.insert("service", ns.service_name().to_owned());
    map.insert("account", account.to_owned());
    map
}

fn map_dbus_error(err: oo7::dbus::Error) -> Error {
    match err {
        oo7::dbus::Error::Service(oo7::dbus::ServiceError::IsLocked(_))
        | oo7::dbus::Error::Dismissed => Error::Locked,
        oo7::dbus::Error::Service(
            oo7::dbus::ServiceError::ZBus(_) | oo7::dbus::ServiceError::NoSuchObject(_),
        )
        | oo7::dbus::Error::NotFound(_)
        | oo7::dbus::Error::ZBus(_)
        | oo7::dbus::Error::IO(_) => Error::Unavailable(format!(
            "No Secret Service keyring (org.freedesktop.secrets) is available: {err}"
        )),
        other => Error::Backend(other.to_string()),
    }
}

async fn open_unlocked_collection() -> Result<oo7::dbus::Collection, Error> {
    let service = oo7::dbus::Service::new().await.map_err(map_dbus_error)?;
    let collection = service.default_collection().await.map_err(map_dbus_error)?;
    if collection.is_locked().await.map_err(map_dbus_error)? {
        return Err(Error::Locked);
    }
    Ok(collection)
}

impl CredentialStore for Store {
    fn get(&self, ns: Namespace, account: &str) -> Result<Option<Vec<u8>>, Error> {
        validate_account(account)?;
        let attrs = attributes(ns, account);
        futures_lite::future::block_on(async move {
            let collection = open_unlocked_collection().await?;
            let items = collection
                .search_items(&attrs)
                .await
                .map_err(map_dbus_error)?;
            let Some(item) = items.into_iter().next() else {
                return Ok(None);
            };
            if item.is_locked().await.map_err(map_dbus_error)? {
                return Err(Error::Locked);
            }
            let secret = item.secret().await.map_err(map_dbus_error)?;
            Ok(Some(secret.as_bytes().to_vec()))
        })
    }

    fn set(&self, ns: Namespace, account: &str, secret: &[u8]) -> Result<(), Error> {
        validate_account(account)?;
        validate_secret(secret)?;
        let attrs = attributes(ns, account);
        let label = format!("{} ({account})", ns.service_name());
        let payload = oo7::Secret::blob(secret);
        futures_lite::future::block_on(async move {
            let collection = open_unlocked_collection().await?;
            collection
                .create_item(&label, &attrs, payload, true, None)
                .await
                .map_err(map_dbus_error)?;
            Ok(())
        })
    }

    fn delete(&self, ns: Namespace, account: &str) -> Result<(), Error> {
        validate_account(account)?;
        let attrs = attributes(ns, account);
        futures_lite::future::block_on(async move {
            let collection = open_unlocked_collection().await?;
            let items = collection
                .search_items(&attrs)
                .await
                .map_err(map_dbus_error)?;
            for item in items {
                item.delete(None).await.map_err(map_dbus_error)?;
            }
            Ok(())
        })
    }

    fn availability(&self) -> Availability {
        // Cheap check: require a D-Bus session bus address before probing Secret Service.
        if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none()
            && std::env::var_os("XDG_RUNTIME_DIR")
                .map(|dir| std::path::PathBuf::from(dir).join("bus").exists())
                != Some(true)
        {
            return Availability::unavailable_with_detail(
                "credentials",
                "native.credentials.unavailable",
                "No desktop Secret Service session is running.",
            );
        }
        match futures_lite::future::block_on(open_unlocked_collection()) {
            Ok(_) => Availability::Available,
            Err(Error::Locked) => Availability::unavailable_with_detail(
                "credentials",
                "native.credentials.locked",
                "The system keyring is locked.",
            ),
            Err(err) => Availability::unavailable_with_detail(
                "credentials",
                "native.credentials.unavailable",
                err.to_string(),
            ),
        }
    }
}
