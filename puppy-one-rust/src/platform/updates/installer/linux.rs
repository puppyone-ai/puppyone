//! Linux update installer (`release-and-ci.md`).
//!
//! - Release eligibility is derived from the compile-time
//!   `PUPPYONE_LINUX_RELEASE_MARKER` stamp embedded by `tools/release/targets/linux.py`
//!   so unsigned/dev builds cleanly report updates disabled.
//! - AppImage builds (`$APPIMAGE` points to a writable file): stages the
//!   verified AppImage, copies it into a temporary sibling on the destination
//!   AppImage's own filesystem before exit swap (preventing cross-device
//!   `EXDEV` rename failures when `$XDG_CACHE_HOME` is on a different mount),
//!   atomically swaps with backup + rollback on failure, and relaunches when
//!   requested.
//! - `.deb` / system-package installs: cleanly reports that updates are handled
//!   by the system package manager (`apt`).
use super::super::{Configuration, Signature, cache_path, disabled_reason};
use std::{
    io::Write as _,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub(super) struct Backend {
    appimage: PathBuf,
    staging: PathBuf,
    staged: Option<(PathBuf, String)>,
}

fn signature_for_marker(marker: Option<&str>) -> Signature {
    match marker.map(str::trim) {
        Some(value) if value.starts_with("release:") && value.len() > "release:".len() => {
            Signature::Release
        }
        _ => Signature::Unsigned,
    }
}

fn running_signature() -> Signature {
    signature_for_marker(option_env!("PUPPYONE_LINUX_RELEASE_MARKER"))
}

pub(super) fn open(config: &Configuration, packaged: bool) -> (Option<Backend>, Option<String>) {
    let reason = disabled_reason(config, packaged, running_signature);
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

fn copy_to_sibling_temp(staged: &Path, destination: &Path) -> std::io::Result<PathBuf> {
    let parent = destination
        .parent()
        .ok_or_else(|| std::io::Error::other("AppImage path has no parent directory"))?;
    let name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("puppyone.AppImage");
    let sibling = parent.join(format!(
        ".{name}.update-{}-{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut src = std::fs::File::open(staged)?;
        let mut dst = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&sibling)?;
        std::io::copy(&mut src, &mut dst)?;
        dst.flush()?;
        dst.sync_all()?;
        std::fs::set_permissions(&sibling, std::fs::Permissions::from_mode(0o755))?;
        Ok(())
    })();
    if let Err(err) = result {
        let _ = std::fs::remove_file(&sibling);
        return Err(err);
    }
    Ok(sibling)
}

impl Backend {
    pub(super) fn prepare(&mut self, archive: &Path, version: &str) -> Result<(), String> {
        self.discard();
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
        // Copy onto the destination filesystem first so the final swap never
        // fails with EXDEV when $XDG_CACHE_HOME and $APPIMAGE are on different
        // filesystems (e.g. tmpfs cache vs ext4 or external drive).
        let Ok(sibling) = copy_to_sibling_temp(&staged, &self.appimage) else {
            return false;
        };
        let backup = self.appimage.with_extension("AppImage.bak");
        let _ = std::fs::remove_file(&backup);
        let swapped = std::fs::rename(&self.appimage, &backup).and_then(|()| {
            std::fs::rename(&sibling, &self.appimage).inspect_err(|_| {
                let _ = std::fs::rename(&backup, &self.appimage);
            })
        });
        if swapped.is_err() {
            let _ = std::fs::remove_file(&sibling);
            return false;
        }
        let _ = std::fs::remove_file(&backup);
        let _ = std::fs::remove_file(&staged);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::build_identity::Channel;

    #[test]
    fn release_marker_distinguishes_signed_release_from_unsigned_dev_builds() {
        assert_eq!(signature_for_marker(None), Signature::Unsigned);
        assert_eq!(signature_for_marker(Some("")), Signature::Unsigned);
        assert_eq!(signature_for_marker(Some("dev")), Signature::Unsigned);
        assert_eq!(
            signature_for_marker(Some("release:stable:0.4.5")),
            Signature::Release
        );
    }

    #[test]
    fn unsigned_running_linux_build_reports_disabled_reason() {
        let config = Configuration {
            channel: Channel::Stable,
            current_version: "0.4.5".into(),
            feed: Some(
                url::Url::parse("https://updates.puppyone.ai/desktop/stable/linux/latest").unwrap(),
            ),
            update_channel: Some("stable"),
            force_dev: false,
        };
        let (backend, reason) = open(&config, true);
        if option_env!("PUPPYONE_LINUX_RELEASE_MARKER").is_none() {
            assert!(backend.is_none());
            assert!(
                reason
                    .as_deref()
                    .is_some_and(|r| r.contains("not a signed release build")),
                "{reason:?}"
            );
        }
    }

    #[test]
    fn appimage_swap_stages_sibling_atomically_and_preserves_executable_bits() {
        let cache_dir = tempfile::tempdir().unwrap();
        let install_dir = tempfile::tempdir().unwrap();
        let installed = install_dir.path().join("PuppyOne.AppImage");
        std::fs::write(&installed, b"old-appimage").unwrap();
        let downloaded = cache_dir.path().join("downloaded.AppImage");
        std::fs::write(&downloaded, b"new-appimage").unwrap();

        let mut backend = Backend {
            appimage: installed.clone(),
            staging: cache_dir.path().join("staging"),
            staged: None,
        };
        backend.prepare(&downloaded, "0.5.0").unwrap();
        assert!(backend.install_on_exit(false));
        assert_eq!(std::fs::read(&installed).unwrap(), b"new-appimage");
        let mode = std::fs::metadata(&installed).unwrap().permissions().mode();
        assert_ne!(mode & 0o111, 0, "installed AppImage must be executable");
        assert!(!installed.with_extension("AppImage.bak").exists());
    }
}
