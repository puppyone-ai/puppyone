//! macOS update installer wrapping [`crate::platform::updates::prepared::PreparedUpdate`].
use super::super::{Configuration, Signature, cache_path, disabled_reason, prepared, signature};
use std::path::Path;

pub(super) struct Backend(prepared::PreparedUpdate);

#[cfg(any(test, feature = "test-support"))]
pub(super) fn from_prepared(prepared: prepared::PreparedUpdate) -> Backend {
    Backend(prepared)
}

pub(super) fn open(config: &Configuration, packaged: bool) -> (Option<Backend>, Option<String>) {
    let app_bundle = std::env::current_exe()
        .ok()
        .and_then(|e| e.ancestors().nth(3).map(Path::to_path_buf));
    let mut reason = disabled_reason(config, packaged, || {
        app_bundle
            .as_deref()
            .map(signature)
            .unwrap_or(Signature::Unsigned)
    });
    let backend = match (&reason, &app_bundle) {
        (None, Some(app)) => {
            match prepared::PreparedUpdate::new(app.clone(), cache_path("prepared-update")) {
                Ok(prepared) => Some(Backend(prepared)),
                Err(why) => {
                    reason = Some(format!("Auto updates are unavailable here: {why}"));
                    None
                }
            }
        }
        _ => None,
    };
    (backend, reason)
}

impl Backend {
    pub(super) fn prepare(&mut self, archive: &Path, version: &str) -> Result<(), String> {
        self.0.prepare(archive, version)
    }

    pub(super) fn discard(&mut self) {
        self.0.discard();
    }

    pub(super) fn install_on_exit(&mut self, relaunch: bool) -> bool {
        self.0.install_on_exit(relaunch)
    }
}
