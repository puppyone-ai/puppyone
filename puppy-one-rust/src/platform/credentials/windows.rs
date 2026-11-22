//! Windows Credential Manager (`CredReadW`/`CredWriteW`/`CredDeleteW`) with
//! automatic DPAPI (`CryptProtectData`/`CryptUnprotectData`) overflow storage
//! for secrets exceeding `CRED_MAX_CREDENTIAL_BLOB_SIZE` (2,560 bytes, e.g.
//! Cloud sign-in records up to 24 KiB). Never writes plaintext to disk.
use super::{CredentialStore, Error, Namespace, validate_account, validate_secret};
use crate::platform::{paths, unsupported::Availability};
use std::{ffi::OsStr, os::windows::ffi::OsStrExt, path::PathBuf};
use windows::{
    Win32::{
        Foundation::{ERROR_NOT_FOUND, HLOCAL, LocalFree},
        Security::{
            Credentials::{
                CRED_MAX_CREDENTIAL_BLOB_SIZE, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
                CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
            },
            Cryptography::{
                CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
            },
        },
    },
    core::{PCWSTR, PWSTR},
};
use zeroize::Zeroize;

const DPAPI_MARKER_PREFIX: &[u8] = b"PUPPYONE_DPAPI_V1:";

pub(super) struct Store;

impl Store {
    pub(super) fn new() -> Self {
        Self
    }
}

fn target_name(ns: Namespace, account: &str) -> String {
    format!("PuppyOne:{}:{account}", ns.service_name())
}

fn wide_null(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

fn dpapi_file_for(target: &str) -> PathBuf {
    let hash = blake3::hash(target.as_bytes()).to_hex();
    paths::data_dir()
        .join("vault")
        .join(format!("{hash}.dpapi"))
}

fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>, Error> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(plaintext.len()).map_err(|_| Error::TooLarge {
            limit: super::MAX_SECRET_BYTES,
        })?,
        pbData: plaintext.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: `input` points to valid memory for the duration of the call;
    // `output.pbData` is allocated by DPAPI and freed below via `LocalFree`.
    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    }
    .map_err(|e| Error::Backend(format!("DPAPI protect failed: {e}")))?;
    let bytes = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let vec = slice.to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        vec
    };
    Ok(bytes)
}

fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, Error> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(ciphertext.len())
            .map_err(|_| Error::Backend("DPAPI ciphertext too large.".into()))?,
        pbData: ciphertext.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: `input` points to valid memory; `output.pbData` is freed via `LocalFree`.
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    }
    .map_err(|e| Error::Backend(format!("DPAPI unprotect failed: {e}")))?;
    let bytes = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let vec = slice.to_vec();
        // Zeroize DPAPI's plaintext buffer before freeing.
        std::ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        vec
    };
    Ok(bytes)
}

fn write_cred(target: &str, account: &str, blob: &[u8]) -> Result<(), Error> {
    let mut target_w = wide_null(target);
    let mut user_w = wide_null(account);
    let mut blob_copy = blob.to_vec();
    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target_w.as_mut_ptr()),
        CredentialBlobSize: blob_copy.len() as u32,
        CredentialBlob: blob_copy.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user_w.as_mut_ptr()),
        ..Default::default()
    };
    // SAFETY: pointers in `cred` remain valid through `CredWriteW`.
    let result = unsafe { CredWriteW(&cred, 0) };
    blob_copy.zeroize();
    result.map_err(|e| Error::Backend(format!("Windows Credential Manager write failed: {e}")))
}

fn read_cred(target: &str) -> Result<Option<Vec<u8>>, Error> {
    let target_w = wide_null(target);
    let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: `target_w` is NUL-terminated UTF-16; returned pointer is freed with `CredFree`.
    let result = unsafe { CredReadW(PCWSTR(target_w.as_ptr()), CRED_TYPE_GENERIC, None, &mut ptr) };
    match result {
        Ok(()) => {
            if ptr.is_null() {
                return Ok(None);
            }
            let bytes = unsafe {
                let cred = &*ptr;
                let data = if cred.CredentialBlob.is_null() || cred.CredentialBlobSize == 0 {
                    Vec::new()
                } else {
                    std::slice::from_raw_parts(
                        cred.CredentialBlob,
                        cred.CredentialBlobSize as usize,
                    )
                    .to_vec()
                };
                CredFree(ptr.cast());
                data
            };
            Ok(Some(bytes))
        }
        Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(None),
        Err(e) => Err(Error::Backend(format!(
            "Windows Credential Manager read failed: {e}"
        ))),
    }
}

impl CredentialStore for Store {
    fn get(&self, ns: Namespace, account: &str) -> Result<Option<Vec<u8>>, Error> {
        validate_account(account)?;
        let target = target_name(ns, account);
        let Some(blob) = read_cred(&target)? else {
            return Ok(None);
        };
        if blob.starts_with(DPAPI_MARKER_PREFIX) {
            let file = dpapi_file_for(&target);
            match std::fs::read(&file) {
                Ok(ciphertext) => Ok(Some(dpapi_unprotect(&ciphertext)?)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(Error::Backend(format!("DPAPI vault read failed: {e}"))),
            }
        } else {
            Ok(Some(blob))
        }
    }

    fn set(&self, ns: Namespace, account: &str, secret: &[u8]) -> Result<(), Error> {
        validate_account(account)?;
        validate_secret(secret)?;
        let target = target_name(ns, account);
        let dpapi_file = dpapi_file_for(&target);
        if secret.len() <= CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            write_cred(&target, account, secret)?;
            let _ = std::fs::remove_file(&dpapi_file);
            Ok(())
        } else {
            let ciphertext = dpapi_protect(secret)?;
            if let Some(parent) = dpapi_file.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| Error::Backend(format!("DPAPI vault dir failed: {e}")))?;
            }
            let tmp = dpapi_file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
            std::fs::write(&tmp, &ciphertext)
                .map_err(|e| Error::Backend(format!("DPAPI vault write failed: {e}")))?;
            if let Err(e) = std::fs::rename(&tmp, &dpapi_file) {
                let _ = std::fs::remove_file(&tmp);
                return Err(Error::Backend(format!("DPAPI vault commit failed: {e}")));
            }
            let mut marker = DPAPI_MARKER_PREFIX.to_vec();
            marker.extend_from_slice(blake3::hash(target.as_bytes()).to_hex().as_bytes());
            if let Err(e) = write_cred(&target, account, &marker) {
                let _ = std::fs::remove_file(&dpapi_file);
                return Err(e);
            }
            Ok(())
        }
    }

    fn delete(&self, ns: Namespace, account: &str) -> Result<(), Error> {
        validate_account(account)?;
        let target = target_name(ns, account);
        let _ = std::fs::remove_file(dpapi_file_for(&target));
        let target_w = wide_null(&target);
        // SAFETY: `target_w` is NUL-terminated UTF-16.
        match unsafe { CredDeleteW(PCWSTR(target_w.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(()),
            Err(e) => Err(Error::Backend(format!(
                "Windows Credential Manager delete failed: {e}"
            ))),
        }
    }

    fn availability(&self) -> Availability {
        Availability::Available
    }
}
