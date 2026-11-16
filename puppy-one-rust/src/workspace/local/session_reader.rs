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
        let before = Version::new(&[], &before);
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
            if !current.is_file()
                || current.len() != size
                || opened.len() != size
                || Version::new(&[], &current) != before
                || Version::new(&[], &opened) != before
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
