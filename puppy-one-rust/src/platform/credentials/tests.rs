use super::*;
use core::prelude::v1::test;

#[test]
fn macos_service_names_match_upgrade_contract_verbatim() {
    assert_eq!(
        Namespace::CloudSignIn.service_name(),
        "Puppyone Native Cloud Auth"
    );
    assert_eq!(
        Namespace::CloudGit.service_name(),
        "PuppyOne Cloud Git credential"
    );
    assert_eq!(
        Namespace::HostDeviceKey.service_name(),
        "PuppyOne Host Device Key"
    );
    assert_eq!(
        Namespace::ModelConnection.service_name(),
        "PuppyOne GPUI Model Connections"
    );
}

#[test]
fn memory_store_isolates_namespaces_and_enforces_limits() {
    let store = memory::Store::new();
    assert!(store.availability().is_available());

    store
        .set(Namespace::CloudSignIn, "default", b"cloud-token")
        .unwrap();
    store
        .set(Namespace::CloudGit, "default", b"git-token")
        .unwrap();

    assert_eq!(
        store
            .get(Namespace::CloudSignIn, "default")
            .unwrap()
            .as_deref(),
        Some(b"cloud-token".as_slice())
    );
    assert_eq!(
        store
            .get(Namespace::CloudGit, "default")
            .unwrap()
            .as_deref(),
        Some(b"git-token".as_slice())
    );

    store.delete(Namespace::CloudSignIn, "default").unwrap();
    assert_eq!(store.get(Namespace::CloudSignIn, "default").unwrap(), None);
    assert_eq!(
        store
            .get(Namespace::CloudGit, "default")
            .unwrap()
            .as_deref(),
        Some(b"git-token".as_slice())
    );

    // Oversized secret returns TooLarge, never truncates.
    let huge = vec![b'x'; MAX_SECRET_BYTES + 1];
    assert_eq!(
        store.set(Namespace::CloudSignIn, "big", &huge),
        Err(Error::TooLarge {
            limit: MAX_SECRET_BYTES
        })
    );
    // Invalid account names rejected.
    assert!(store.set(Namespace::CloudSignIn, "", b"x").is_err());
    assert!(store.set(Namespace::CloudSignIn, "a\0b", b"x").is_err());
}

#[cfg(target_os = "linux")]
#[test]
fn linux_store_fails_closed_when_secret_service_is_absent() {
    // In headless CI without org.freedesktop.secrets, the store must report
    // Unavailable/Locked cleanly and never panic or write plaintext.
    let store = system();
    if !store.availability().is_available() {
        let res = store.get(Namespace::CloudSignIn, "ci-probe-account");
        assert!(matches!(
            res,
            Err(Error::Unavailable(_)) | Err(Error::Locked)
        ));
    }
}
