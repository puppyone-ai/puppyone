//! Windows out-of-process update installer (`release-and-ci.md`).
//!
//! Because Windows locks running `.exe` and `.dll` files, `prepare` stages the
//! SHA-512-verified NSIS installer (`.exe`) into the per-user update cache, and
//! `install_on_exit` spawns a detached PowerShell helper that waits for this
//! process PID to exit, runs the NSIS installer silently (`/S`) with rollback
//! logging, and relaunches the installed executable when requested.
use super::super::{Configuration, Signature, cache_path, disabled_reason};
use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use windows::Win32::System::Threading::{CREATE_NO_WINDOW, DETACHED_PROCESS};

pub(super) struct Backend {
    exe: PathBuf,
    staging: PathBuf,
    staged: Option<(PathBuf, String)>,
}

pub(super) fn open(config: &Configuration, packaged: bool) -> (Option<Backend>, Option<String>) {
    let reason = disabled_reason(config, packaged, || Signature::Release);
    if reason.is_some() {
        return (None, reason);
    }
    let Ok(exe) = std::env::current_exe() else {
        return (
            None,
            Some("Auto updates are unavailable: unable to locate current executable.".into()),
        );
    };
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
            staged: None,
        }),
        None,
    )
}

impl Backend {
    pub(super) fn prepare(&mut self, archive: &Path, version: &str) -> Result<(), String> {
        let ext = archive
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| "exe".into());
        if !matches!(ext.as_str(), "exe" | "zip") {
            return Err(format!("Unsupported Windows update payload: .{ext}"));
        }
        std::fs::create_dir_all(&self.staging).map_err(|e| e.to_string())?;
        let dest = self
            .staging
            .join(format!("puppyone-update-{version}.{ext}"));
        std::fs::copy(archive, &dest).map_err(|e| e.to_string())?;
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
        // Detached helper waits for this process PID to exit (releasing locked
        // `.exe`/`.dll` handles), runs the silent NSIS update, and optionally
        // relaunches the app.
        let script = r#"
$pidToWait = [int]$env:PUPPYONE_UPDATE_PID
$payload = $env:PUPPYONE_UPDATE_PAYLOAD
$exe = $env:PUPPYONE_UPDATE_EXE
$relaunch = $env:PUPPYONE_UPDATE_RELAUNCH
for ($i = 0; $i -lt 200; $i++) {
    if (-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 100
}
if ($payload.ToLower().EndsWith('.exe')) {
    $proc = Start-Process -FilePath $payload -ArgumentList '/S' -Wait -PassThru
    if ($proc.ExitCode -eq 0 -and $relaunch -eq '1' -and (Test-Path $exe)) {
        Start-Process -FilePath $exe
    }
}
"#;
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                script,
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
