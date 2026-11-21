//! Linux update installer (`release-and-ci.md`).
//!
//! - AppImage builds (`$APPIMAGE` points to a writable file): stages the
//!   verified AppImage, sets `0o755`, atomically swaps on exit with backup +
//!   rollback on failure, and relaunches when requested.
//! - `.deb` / system-package installs: cleanly reports that updates are handled
//!   by the system package manager (`apt`).
use super::super::{Configuration, Signature, cache_path, disabled_reason};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub(super) struct Backend {
    appimage: PathBuf,
    staging: PathBuf,
    staged: Option<(PathBuf, String)>,
}

pub(super) fn open(config: &Configuration, packaged: bool) -> (Option<Backend>, Option<String>) {
    let reason = disabled_reason(config, packaged, || Signature::Release);
    if reason.is_some() {
        return (None, reason);
    }
    let Some(appimage) = std::env::var_os("APPIMAGE")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_file())
    else {
        return (
            None,
            Some("Updates for package-managed Linux builds are installed via your system package manager.".into()),
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
            appimage,
            staging,
            staged: None,
        }),
        None,
    )
}

impl Backend {
    pub(super) fn prepare(&mut self, archive: &Path, version: &str) -> Result<(), String> {
        std::fs::create_dir_all(&self.staging).map_err(|e| e.to_string())?;
        let dest = self.staging.join(format!("puppyone-{version}.AppImage"));
        std::fs::copy(archive, &dest).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
        self.staged = Some((dest, version.to_owned()));
        Ok(())
    }

    pub(super) fn discard(&mut self) {
        if let Some((path, _)) = self.staged.take() {
            let _ = std::fs::remove_file(path);
        }
    }

    pub(super) fn install_on_exit(&mut self, relaunch: bool) -> bool {
        let Some((staged, _version)) = self.staged.take() else {
            return false;
        };
        let backup = self.appimage.with_extension("AppImage.bak");
        let _ = std::fs::remove_file(&backup);
        let swapped = std::fs::rename(&self.appimage, &backup).and_then(|()| {
            std::fs::rename(&staged, &self.appimage).inspect_err(|_| {
                let _ = std::fs::rename(&backup, &self.appimage);
            })
        });
        if swapped.is_err() {
            return false;
        }
        let _ = std::fs::remove_file(&backup);
        if relaunch {
            let _ = Command::new(&self.appimage)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
        }
        true
    }
}
