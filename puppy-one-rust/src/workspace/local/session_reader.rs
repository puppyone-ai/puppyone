//! Retained provider authority for lazy database sessions. Only metadata and
//! sidecar existence are inspected; the engine reads pages from the one opened
//! descriptor. Replacing a display path cannot redirect it.
use super::*;
use crate::workspace::ports::{
    ResourceReader, SessionReadFailure, SessionReadResult, SessionReader,
};

impl Workspace {
    pub fn preview_session_reader(&self, relative: &Path) -> SessionReadResult<SessionReader> {
        let (dir, name) = self.parent(relative)?;
        let (file, before) = Self::open_regular(&dir, &name)?;
        let size = before.len();
        let before_id = crate::platform::fs::file_identity(&file);
        let before = StatFingerprint::from_metadata(&before);
        let observed = file.try_clone().map_err(io)?;
        let validate = Arc::new(move || {
            let current = dir.symlink_metadata(&name).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    SessionReadFailure::Changed
                } else {
                    io(error).into()
                }
            })?;
            let opened = observed.metadata().map_err(io)?;
            let identity_changed = before_id.is_some()
                && (crate::platform::fs::dir_entry_identity(&dir, &name) != before_id
                    || crate::platform::fs::file_identity(&observed) != before_id);
            if !current.is_file()
                || current.len() != size
                || opened.len() != size
                || identity_changed
                || StatFingerprint::from_metadata(&current) != before
                || StatFingerprint::from_metadata(&opened) != before
            {
                return Err(SessionReadFailure::Changed);
            }
            for suffix in ["-journal", "-wal", "-shm"] {
                let mut sidecar = name.as_os_str().to_owned();
                sidecar.push(suffix);
                match dir.symlink_metadata(&sidecar) {
                    Ok(_) => return Err(SessionReadFailure::Recovery),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(io(error).into()),
                }
            }
            Ok(())
        });
        validate()?;
        Ok(SessionReader {
            source: ResourceReader {
                length: size,
                reader: Box::new(file.into_std()),
            },
            validate,
        })
    }
}
