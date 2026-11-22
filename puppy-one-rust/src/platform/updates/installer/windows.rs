//! Windows out-of-process update installer (`release-and-ci.md`).
//!
//! Because Windows locks running `.exe` and `.dll` files, `prepare` stages the
//! SHA-512-verified NSIS installer (`.exe`) into the per-user update cache,
//! verifies its Authenticode signature via `WinVerifyTrust` and checks that
//! the signing certificate matches an expected publisher before accepting it.
//! On exit, `install_on_exit` spawns a detached PowerShell helper that waits
//! for this process PID to exit (aborting without installing and keeping the
//! staged installer if the process does not exit in time), runs the NSIS
//! installer silently (`/S`), and relaunches the installed executable only if
//! the installer exits with code 0. (NSIS performs an in-place overwrite with
//! no automatic binary rollback if the installer fails mid-run; failed runs do
//! not relaunch.)
use super::super::{Configuration, Signature, cache_path, disabled_reason};
use std::{
    ffi::c_void,
    os::windows::{ffi::OsStrExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use windows::{
    Win32::{
        Foundation::{HWND, INVALID_HANDLE_VALUE, TRUST_E_NOSIGNATURE},
        Security::{
            Cryptography::{
                CERT_CONTEXT, CERT_FIND_SUBJECT_CERT, CERT_INFO, CERT_NAME_ATTR_TYPE,
                CERT_NAME_SIMPLE_DISPLAY_TYPE, CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
                CERT_QUERY_ENCODING_TYPE, CERT_QUERY_FORMAT_FLAG_BINARY, CERT_QUERY_OBJECT_FILE,
                CMSG_SIGNER_INFO, CMSG_SIGNER_INFO_PARAM, CertCloseStore,
                CertFindCertificateInStore, CertFreeCertificateContext, CertGetNameStringW,
                CryptMsgClose, CryptMsgGetParam, CryptQueryObject, HCERTSTORE, PKCS_7_ASN_ENCODING,
                X509_ASN_ENCODING, szOID_COMMON_NAME, szOID_ORGANIZATION_NAME,
            },
            WinTrust::{
                WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
                WINTRUST_FILE_INFO, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
                WTD_STATEACTION_VERIFY, WTD_UI_NONE, WTD_UICONTEXT_EXECUTE, WinVerifyTrust,
            },
        },
        System::Threading::{CREATE_NO_WINDOW, DETACHED_PROCESS},
    },
    core::{PCSTR, PCWSTR},
};

/// The Authenticode publisher names (CN, O or display name) a release trusts,
/// stamped at build time by `tools/release/targets/windows.py` from the signing
/// certificate's subject (`WINDOWS_SIGNER_SUBJECT`). Entries are separated by
/// `;` or newlines so legal names may contain commas; list the old and new
/// names during a certificate rotation. A build without it trusts no publisher,
/// so its updates stay disabled.
const EXPECTED_PUBLISHERS: Option<&str> = option_env!("PUPPYONE_WIN_EXPECTED_PUBLISHERS");

/// Detached PowerShell helper script launched on quit.
///
/// Waits for `$PUPPYONE_UPDATE_PID` to exit for up to `PUPPYONE_UPDATE_MAX_WAIT_TICKS`
/// (default 200 × 100 ms = 20 s). If the process is still alive after the timeout,
/// aborts with exit code 1 without launching the installer and preserves the
/// staged payload for the next quit.
const INSTALL_HELPER_SCRIPT: &str = r#"
$pidToWait = [int]$env:PUPPYONE_UPDATE_PID
$payload = $env:PUPPYONE_UPDATE_PAYLOAD
$exe = $env:PUPPYONE_UPDATE_EXE
$relaunch = $env:PUPPYONE_UPDATE_RELAUNCH
$maxTicks = 200
if ($env:PUPPYONE_UPDATE_MAX_WAIT_TICKS) {
    $parsed = 0
    if ([int]::TryParse($env:PUPPYONE_UPDATE_MAX_WAIT_TICKS, [ref]$parsed) -and $parsed -gt 0) {
        $maxTicks = $parsed
    }
}
$exited = $false
for ($i = 0; $i -lt $maxTicks; $i++) {
    if (-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) {
        $exited = $true
        break
    }
    Start-Sleep -Milliseconds 100
}
if (-not $exited -and (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) {
    exit 1
}
if (-not $payload -or -not $payload.ToLower().EndsWith('.exe') -or -not (Test-Path -LiteralPath $payload)) {
    exit 1
}
$proc = Start-Process -FilePath $payload -ArgumentList '/S' -Wait -PassThru
if ($proc.ExitCode -eq 0) {
    Remove-Item -LiteralPath $payload -Force -ErrorAction SilentlyContinue
    if ($relaunch -eq '1' -and $exe -and (Test-Path -LiteralPath $exe)) {
        Start-Process -FilePath $exe
    }
    exit 0
}
exit $proc.ExitCode
"#;

pub(super) struct Backend {
    exe: PathBuf,
    staging: PathBuf,
    expected_publishers: Vec<String>,
    staged: Option<(PathBuf, String)>,
}

#[derive(Debug, PartialEq, Eq)]
enum AuthenticodeError {
    Unsigned,
    Untrusted(i32),
    WrongPublisher(Vec<String>),
    Unreadable(String),
}

fn expected_publishers() -> Vec<String> {
    parse_publishers(EXPECTED_PUBLISHERS)
}

fn parse_publishers(configured: Option<&str>) -> Vec<String> {
    configured
        .unwrap_or_default()
        .split([';', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}

fn publisher_matches(signer_names: &[String], expected: &[String]) -> Option<String> {
    for candidate in signer_names {
        if expected
            .iter()
            .any(|allowed| candidate.eq_ignore_ascii_case(allowed))
        {
            return Some(candidate.clone());
        }
    }
    None
}

fn wide_nul(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn read_cert_name(cert: *const CERT_CONTEXT, name_type: u32, oid: Option<PCSTR>) -> Option<String> {
    let param = oid.map(|o| o.as_ptr() as *const c_void);
    // SAFETY: `cert` is a valid certificate context; `None` queries buffer length.
    let len = unsafe { CertGetNameStringW(cert, name_type, 0, param, None) } as usize;
    if len <= 1 {
        return None;
    }
    let mut buf = vec![0u16; len];
    // SAFETY: `buf` is writable for `len` UTF-16 code units.
    let written = unsafe { CertGetNameStringW(cert, name_type, 0, param, Some(&mut buf)) } as usize;
    if written <= 1 {
        return None;
    }
    let end = buf
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(written.saturating_sub(1));
    let text = String::from_utf16_lossy(&buf[..end]).trim().to_owned();
    (!text.is_empty()).then_some(text)
}

fn extract_signer_names(wide: &[u16]) -> Result<Vec<String>, AuthenticodeError> {
    let mut store = HCERTSTORE::default();
    let mut msg: *mut c_void = std::ptr::null_mut();
    // SAFETY: `wide` is a NUL-terminated UTF-16 path; `store` and `msg` receive
    // owned handles cleaned up before returning.
    unsafe {
        CryptQueryObject(
            CERT_QUERY_OBJECT_FILE,
            wide.as_ptr() as *const c_void,
            CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
            CERT_QUERY_FORMAT_FLAG_BINARY,
            0,
            None,
            None,
            None,
            Some(&mut store),
            Some(&mut msg),
            None,
        )
    }
    .map_err(|e| AuthenticodeError::Unreadable(format!("CryptQueryObject failed: {e}")))?;

    let result = (|| -> Result<Vec<String>, AuthenticodeError> {
        if store.0.is_null() || msg.is_null() {
            return Err(AuthenticodeError::Unreadable(
                "Missing PKCS#7 signature store or message".into(),
            ));
        }
        let mut size = 0u32;
        // SAFETY: `msg` is an open CryptMsg handle; queries required buffer size.
        unsafe { CryptMsgGetParam(msg, CMSG_SIGNER_INFO_PARAM, 0, None, &mut size) }
            .map_err(|e| AuthenticodeError::Unreadable(format!("CryptMsgGetParam size: {e}")))?;
        if (size as usize) < std::mem::size_of::<CMSG_SIGNER_INFO>() {
            return Err(AuthenticodeError::Unreadable(
                "Truncated CMSG_SIGNER_INFO payload".into(),
            ));
        }
        let mut buf = vec![0u8; size as usize];
        // SAFETY: `buf` is writable for `size` bytes.
        unsafe {
            CryptMsgGetParam(
                msg,
                CMSG_SIGNER_INFO_PARAM,
                0,
                Some(buf.as_mut_ptr() as *mut c_void),
                &mut size,
            )
        }
        .map_err(|e| AuthenticodeError::Unreadable(format!("CryptMsgGetParam data: {e}")))?;
        // SAFETY: `buf` holds a valid `CMSG_SIGNER_INFO` at offset 0.
        let signer = unsafe { std::ptr::read_unaligned(buf.as_ptr() as *const CMSG_SIGNER_INFO) };
        let cert_info = CERT_INFO {
            Issuer: signer.Issuer,
            SerialNumber: signer.SerialNumber,
            ..Default::default()
        };
        let encoding = CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0);
        // SAFETY: `store` is valid and `cert_info` borrows slices living in `buf`.
        let cert = unsafe {
            CertFindCertificateInStore(
                store,
                encoding,
                0,
                CERT_FIND_SUBJECT_CERT,
                Some(&cert_info as *const CERT_INFO as *const c_void),
                None,
            )
        };
        if cert.is_null() {
            return Err(AuthenticodeError::Unreadable(
                "Signer certificate not found in embedded PKCS#7 store".into(),
            ));
        }
        let mut names = Vec::new();
        for candidate in [
            read_cert_name(cert, CERT_NAME_ATTR_TYPE, Some(szOID_COMMON_NAME)),
            read_cert_name(cert, CERT_NAME_ATTR_TYPE, Some(szOID_ORGANIZATION_NAME)),
            read_cert_name(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, None),
        ]
        .into_iter()
        .flatten()
        {
            if !names
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(&candidate))
            {
                names.push(candidate);
            }
        }
        // SAFETY: `cert` was returned by `CertFindCertificateInStore`.
        unsafe {
            let _ = CertFreeCertificateContext(Some(cert));
        }
        Ok(names)
    })();

    if !store.0.is_null() {
        // SAFETY: `store` was returned by `CryptQueryObject`.
        unsafe {
            let _ = CertCloseStore(Some(store), 0);
        }
    }
    if !msg.is_null() {
        // SAFETY: `msg` was returned by `CryptQueryObject`.
        unsafe {
            let _ = CryptMsgClose(Some(msg));
        }
    }
    result
}

fn verify_authenticode(path: &Path, expected: &[String]) -> Result<String, AuthenticodeError> {
    let wide = wide_nul(path);
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(wide.as_ptr()),
        ..Default::default()
    };
    let mut action_guid = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let mut trust_data = WINTRUST_DATA {
        cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        dwUIContext: WTD_UICONTEXT_EXECUTE,
        ..Default::default()
    };
    // SAFETY: `trust_data` and `file_info` remain live for both the VERIFY and
    // CLOSE calls; `wide` stays live for the entire duration.
    let status = unsafe {
        WinVerifyTrust(
            HWND(INVALID_HANDLE_VALUE.0),
            &mut action_guid,
            &mut trust_data as *mut WINTRUST_DATA as *mut c_void,
        )
    };
    trust_data.dwStateAction = WTD_STATEACTION_CLOSE;
    unsafe {
        let _ = WinVerifyTrust(
            HWND(INVALID_HANDLE_VALUE.0),
            &mut action_guid,
            &mut trust_data as *mut WINTRUST_DATA as *mut c_void,
        );
    }
    if status == TRUST_E_NOSIGNATURE.0 {
        return Err(AuthenticodeError::Unsigned);
    }
    if status != 0 {
        return Err(AuthenticodeError::Untrusted(status));
    }
    let names = extract_signer_names(&wide)?;
    publisher_matches(&names, expected).ok_or(AuthenticodeError::WrongPublisher(names))
}

fn running_signature(exe: &Path, expected: &[String]) -> Signature {
    match verify_authenticode(exe, expected) {
        Ok(_) => Signature::Release,
        Err(AuthenticodeError::Unsigned) => Signature::Unsigned,
        Err(AuthenticodeError::WrongPublisher(_) | AuthenticodeError::Untrusted(_)) => {
            Signature::OtherCertificate
        }
        Err(AuthenticodeError::Unreadable(error)) => Signature::Unreadable(error),
    }
}

pub(super) fn open(config: &Configuration, packaged: bool) -> (Option<Backend>, Option<String>) {
    open_with(config, packaged, expected_publishers())
}

fn open_with(
    config: &Configuration,
    packaged: bool,
    expected: Vec<String>,
) -> (Option<Backend>, Option<String>) {
    let Ok(exe) = std::env::current_exe() else {
        return (
            None,
            Some("Auto updates are unavailable: unable to locate current executable.".into()),
        );
    };
    // A build that names no publisher trusts no certificate, its own included.
    let reason = disabled_reason(config, packaged, || {
        if expected.is_empty() {
            Signature::OtherCertificate
        } else {
            running_signature(&exe, &expected)
        }
    });
    if reason.is_some() {
        return (None, reason);
    }
    let staging = cache_path("prepared-update");
    if let Err(err) = std::fs::create_dir_all(&staging) {
        return (
            None,
            Some(format!("Auto updates are unavailable here: {err}")),
        );
    }
    (
        Some(Backend {
            exe,
            staging,
            expected_publishers: expected,
            staged: None,
        }),
        None,
    )
}

impl Backend {
    pub(super) fn prepare(&mut self, archive: &Path, version: &str) -> Result<(), String> {
        self.discard();
        let ext = archive
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if ext != "exe" {
            return Err(format!(
                "Unsupported Windows update payload '.{ext}': only signed .exe installers are accepted."
            ));
        }
        std::fs::create_dir_all(&self.staging).map_err(|e| e.to_string())?;
        let dest = self.staging.join(format!("puppyone-update-{version}.exe"));
        std::fs::copy(archive, &dest).map_err(|e| e.to_string())?;
        if let Err(err) = verify_authenticode(&dest, &self.expected_publishers) {
            let _ = std::fs::remove_file(&dest);
            return Err(match err {
                AuthenticodeError::Unsigned => {
                    "Refused Windows update installer: payload is not Authenticode signed.".into()
                }
                AuthenticodeError::Untrusted(code) => format!(
                    "Refused Windows update installer: Authenticode trust verification failed (0x{:08x}).",
                    code as u32
                ),
                AuthenticodeError::WrongPublisher(found) => format!(
                    "Refused Windows update installer: signer ({}) does not match expected publisher.",
                    if found.is_empty() {
                        "unknown".to_owned()
                    } else {
                        found.join(", ")
                    }
                ),
                AuthenticodeError::Unreadable(msg) => {
                    format!("Refused Windows update installer: {msg}")
                }
            });
        }
        self.staged = Some((dest, version.to_owned()));
        Ok(())
    }

    pub(super) fn discard(&mut self) {
        if let Some((path, _)) = self.staged.take() {
            let _ = std::fs::remove_file(path);
        }
    }

    pub(super) fn install_on_exit(&mut self, relaunch: bool) -> bool {
        let Some((payload, _version)) = self.staged.take() else {
            return false;
        };
        let pid = std::process::id();
        let relaunch_flag = if relaunch { "1" } else { "0" };
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                INSTALL_HELPER_SCRIPT,
            ])
            .env("PUPPYONE_UPDATE_PID", pid.to_string())
            .env("PUPPYONE_UPDATE_PAYLOAD", &payload)
            .env("PUPPYONE_UPDATE_EXE", &self.exe)
            .env("PUPPYONE_UPDATE_RELAUNCH", relaunch_flag)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags((CREATE_NO_WINDOW | DETACHED_PROCESS).0)
            .spawn()
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::build_identity::Channel;

    fn test_backend(staging: PathBuf, expected_publishers: Vec<String>) -> Backend {
        Backend {
            exe: std::env::current_exe().unwrap(),
            staging,
            expected_publishers,
            staged: None,
        }
    }

    #[test]
    fn unsigned_payload_is_refused_and_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let payload = dir.path().join("puppyone-0.5.0-win-x64-setup.exe");
        std::fs::write(&payload, b"MZ-unsigned-installer").unwrap();
        let staging = dir.path().join("staging");
        let mut backend = test_backend(staging.clone(), vec!["PuppyOne".into()]);
        let err = backend.prepare(&payload, "0.5.0").unwrap_err();
        assert!(
            err.contains("not Authenticode signed") || err.contains("trust verification failed"),
            "{err}"
        );
        assert!(backend.staged.is_none());
        assert!(
            !staging.join("puppyone-update-0.5.0.exe").exists(),
            "rejected unsigned payload must be deleted from staging"
        );
    }

    fn find_trusted_third_party_signed_exe() -> Option<PathBuf> {
        let mut candidates = Vec::new();
        if let Some(path_var) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path_var) {
                for name in ["node.exe", "git.exe", "pwsh.exe", "dotnet.exe"] {
                    let candidate = dir.join(name);
                    if candidate.is_file() {
                        candidates.push(candidate);
                    }
                }
            }
        }
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        for rel in [
            r"explorer.exe",
            r"System32\WindowsPowerShell\v1.0\powershell.exe",
            r"System32\msiexec.exe",
            r"System32\cmd.exe",
        ] {
            let candidate = system_root.join(rel);
            if candidate.is_file() {
                candidates.push(candidate);
            }
        }
        candidates.into_iter().find(|path| {
            matches!(
                verify_authenticode(path, &[]),
                Err(AuthenticodeError::WrongPublisher(names)) if !names.is_empty()
            )
        })
    }

    #[test]
    fn wrong_publisher_payload_is_refused_and_deleted() {
        // Locate a validly Authenticode-signed third-party binary on this
        // Windows host (e.g. `node.exe`, `git.exe`, or `pwsh.exe`) so the test
        // exercises both WinVerifyTrust success and publisher-mismatch refusal.
        let signed_exe = find_trusted_third_party_signed_exe()
            .expect("expected an embedded Authenticode-signed third-party executable on host");
        let dir = tempfile::tempdir().unwrap();
        let staging = dir.path().join("staging");
        let mut backend = test_backend(staging.clone(), vec!["PuppyOne".into()]);
        let err = backend.prepare(&signed_exe, "0.5.0").unwrap_err();
        assert!(
            err.contains("does not match expected publisher"),
            "expected publisher mismatch refusal, got: {err}"
        );
        assert!(backend.staged.is_none());
        assert!(
            !staging.join("puppyone-update-0.5.0.exe").exists(),
            "rejected wrong-publisher payload must be deleted from staging"
        );
    }

    #[test]
    fn zip_payload_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let zip_payload = dir.path().join("puppyone-0.5.0-win-x64.zip");
        std::fs::write(&zip_payload, b"PK\x03\x04").unwrap();
        let staging = dir.path().join("staging");
        let mut backend = test_backend(staging.clone(), vec!["PuppyOne".into()]);
        let err = backend.prepare(&zip_payload, "0.5.0").unwrap_err();
        assert!(
            err.contains("only signed .exe installers are accepted"),
            "{err}"
        );
        assert!(backend.staged.is_none());
        assert!(!staging.exists());
    }

    #[test]
    fn helper_aborts_without_installing_and_preserves_payload_when_pid_does_not_exit() {
        let dir = tempfile::tempdir().unwrap();
        let payload = dir.path().join("puppyone-update-0.5.0.exe");
        std::fs::write(&payload, b"MZ-staged-installer").unwrap();
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                INSTALL_HELPER_SCRIPT,
            ])
            .env("PUPPYONE_UPDATE_PID", std::process::id().to_string())
            .env("PUPPYONE_UPDATE_PAYLOAD", &payload)
            .env("PUPPYONE_UPDATE_EXE", std::env::current_exe().unwrap())
            .env("PUPPYONE_UPDATE_RELAUNCH", "0")
            .env("PUPPYONE_UPDATE_MAX_WAIT_TICKS", "3")
            .output()
            .unwrap();
        assert!(
            !output.status.success(),
            "helper must abort when target PID is still alive"
        );
        assert!(
            payload.is_file(),
            "aborted helper must keep the staged payload for the next quit"
        );
    }

    #[test]
    fn unsigned_running_build_reports_disabled_reason() {
        let config = Configuration {
            channel: Channel::Stable,
            current_version: "0.4.5".into(),
            feed: Some(
                url::Url::parse("https://updates.puppyone.ai/desktop/stable/win/latest").unwrap(),
            ),
            update_channel: Some("stable"),
            force_dev: false,
        };
        let (backend, reason) = open_with(&config, true, vec!["PuppyOne".into()]);
        assert!(
            backend.is_none(),
            "unsigned test binary must not enable auto-update"
        );
        let reason = reason.expect("unsigned running build must explain why updates are disabled");
        assert!(
            reason.contains("not code signed") || reason.contains("release certificate"),
            "{reason}"
        );
    }

    #[test]
    fn a_build_naming_no_publisher_keeps_updates_disabled() {
        assert!(parse_publishers(None).is_empty());
        assert!(parse_publishers(Some(" ; \n ")).is_empty());
        let config = Configuration {
            channel: Channel::Stable,
            current_version: "0.4.5".into(),
            feed: Some(
                url::Url::parse("https://updates.puppyone.ai/desktop/stable/win/latest").unwrap(),
            ),
            update_channel: Some("stable"),
            force_dev: false,
        };
        let (backend, reason) = open_with(&config, true, Vec::new());
        assert!(backend.is_none());
        assert!(
            reason
                .expect("a build without publishers must explain why updates are disabled")
                .contains("trusted release certificate")
        );
    }

    #[test]
    fn publisher_rotation_accepts_both_old_and_new_names() {
        let parsed = parse_publishers(Some("PuppyOne Legacy; PuppyOne, Inc.\n"));
        assert_eq!(parsed, vec!["PuppyOne Legacy", "PuppyOne, Inc."]);
        assert_eq!(
            publisher_matches(&["puppyone, inc.".into()], &parsed).as_deref(),
            Some("puppyone, inc.")
        );
        let parsed = parse_publishers(Some("PuppyOne Legacy; PuppyOne Inc."));
        assert_eq!(
            publisher_matches(&["puppyone inc.".into()], &parsed).as_deref(),
            Some("puppyone inc.")
        );
        assert_eq!(publisher_matches(&["Evil Corp".into()], &parsed), None);
    }

    /// Executed explicitly by `tools/release/smoke_windows_nsis.py` in Windows CI
    /// against real self-signed Authenticode NSIS installers served over local HTTP.
    #[test]
    #[ignore = "requires signed NSIS installer fixtures; run via tools/release/smoke_windows_nsis.py"]
    fn windows_local_feed_update_smoke_installs_signed_nsis_installer() {
        let feed_url =
            std::env::var("PUPPYONE_SMOKE_FEED_URL").expect("PUPPYONE_SMOKE_FEED_URL must be set");
        let installed_exe = PathBuf::from(
            std::env::var("PUPPYONE_SMOKE_INSTALLED_EXE")
                .expect("PUPPYONE_SMOKE_INSTALLED_EXE must be set"),
        );
        let current_version = std::env::var("PUPPYONE_SMOKE_CURRENT_VERSION")
            .expect("PUPPYONE_SMOKE_CURRENT_VERSION must be set");
        let expected_version = std::env::var("PUPPYONE_SMOKE_EXPECTED_VERSION")
            .expect("PUPPYONE_SMOKE_EXPECTED_VERSION must be set");
        let expected_pubs = parse_publishers(
            std::env::var("PUPPYONE_SMOKE_EXPECTED_PUBLISHERS")
                .ok()
                .as_deref(),
        );

        // 1. Verify the installed v1 executable passes Authenticode + publisher checks.
        assert_eq!(
            running_signature(&installed_exe, &expected_pubs),
            Signature::Release,
            "installed signed executable must verify as Signature::Release"
        );

        // 2. Check the local HTTP update feed and download the signed v2 NSIS installer.
        let config = Configuration {
            channel: Channel::Stable,
            current_version,
            feed: Some(url::Url::parse(&feed_url).unwrap()),
            update_channel: Some("stable"),
            force_dev: true,
        };
        let candidate = crate::platform::updates::check(&config)
            .expect("updates::check must parse local stable-win.yml feed");
        assert_eq!(candidate.version, expected_version);
        assert!(
            candidate.url.path().to_ascii_lowercase().ends_with(".exe"),
            "Windows feed candidate must be an .exe installer: {}",
            candidate.url
        );

        let work = tempfile::tempdir().unwrap();
        let downloads = work.path().join("downloads");
        let staging = work.path().join("staging");
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let downloaded =
            crate::platform::updates::download(&config, &candidate, &downloads, |_| {}, &cancel)
                .expect("updates::download must download and SHA-512 verify signed NSIS installer");
        assert_eq!(
            downloaded.extension().and_then(|e| e.to_str()),
            Some("exe"),
            "downloaded payload must preserve .exe extension: {}",
            downloaded.display()
        );

        // 3. Stage & verify Authenticode + expected publisher through Backend::prepare.
        let mut backend = Backend {
            exe: installed_exe.clone(),
            staging,
            expected_publishers: expected_pubs,
            staged: None,
        };
        backend
            .prepare(&downloaded, &candidate.version)
            .expect("Backend::prepare must accept validly signed NSIS installer");
        let (staged_payload, _) = backend.staged.take().expect("payload staged");

        // 4. Spawn a short-lived dummy process, let the real PowerShell helper wait
        // for it to exit, run the NSIS installer silently (/S), and verify cleanup.
        let mut dummy = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Milliseconds 300",
            ])
            .spawn()
            .unwrap();
        let dummy_pid = dummy.id();
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                INSTALL_HELPER_SCRIPT,
            ])
            .env("PUPPYONE_UPDATE_PID", dummy_pid.to_string())
            .env("PUPPYONE_UPDATE_PAYLOAD", &staged_payload)
            .env("PUPPYONE_UPDATE_EXE", &installed_exe)
            .env("PUPPYONE_UPDATE_RELAUNCH", "0")
            .output()
            .unwrap();
        let _ = dummy.wait();
        assert!(
            output.status.success(),
            "PowerShell update helper failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            !staged_payload.exists(),
            "staged installer should be removed after successful NSIS /S run"
        );
    }
}
