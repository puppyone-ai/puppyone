//! Read authority is a retained directory handle, never a canonical path that
//! can be replaced before a later ambient open.
use cap_std::fs::{Dir, OpenOptions};
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    ffi::OsString,
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug)]
pub(crate) struct LocalRoot(Arc<Dir>);

pub(crate) struct OpenedFile {
    pub file: File,
    pub relative: PathBuf,
    pub size: u64,
}

fn refused() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "A regular resource inside the granted directory is required",
    )
}

impl LocalRoot {
    pub fn open(root: &Path) -> io::Result<Self> {
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map(|dir| Self(Arc::new(dir)))
    }

    pub fn file(&self, relative: &Path) -> io::Result<OpenedFile> {
        self.open_file(relative, true)
    }

    /// Git paths are exact repository names, never Unicode display aliases.
    pub(crate) fn file_exact(&self, relative: &Path) -> io::Result<OpenedFile> {
        self.open_file(relative, false)
    }

    pub(crate) fn metadata_exact(&self, relative: &Path) -> io::Result<cap_std::fs::Metadata> {
        if relative.as_os_str().is_empty()
            || !relative
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            return Err(refused());
        }
        self.0.symlink_metadata(relative)
    }

    fn open_file(&self, relative: &Path, display_alias: bool) -> io::Result<OpenedFile> {
        let mut parts = relative.components().peekable();
        if parts.peek().is_none()
            || !parts
                .clone()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            return Err(refused());
        }
        let mut dir = self.0.try_clone()?;
        let mut resolved = PathBuf::new();
        while let Some(part) = parts.next() {
            let name = if display_alias {
                display_name(&dir, Path::new(part.as_os_str()))?
            } else {
                part.as_os_str().to_owned()
            };
            resolved.push(&name);
            let metadata = dir.symlink_metadata(&name)?;
            let directory = parts.peek().is_some();
            if (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
                return Err(refused());
            }
            let mut options = OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use cap_std::fs::OpenOptionsExt;
                options.custom_flags(
                    libc::O_NOFOLLOW
                        | libc::O_NONBLOCK
                        | if directory { libc::O_DIRECTORY } else { 0 },
                );
            }
            if directory {
                #[cfg(unix)]
                {
                    dir = Dir::from_std_file(dir.open_with(&name, &options)?.into_std());
                }
                #[cfg(not(unix))]
                {
                    dir = dir.open_dir(&name)?;
                }
            } else {
                let file = dir.open_with(&name, &options)?.into_std();
                let opened = file.metadata()?;
                if !opened.is_file() {
                    return Err(refused());
                }
                return Ok(OpenedFile {
                    file,
                    relative: resolved,
                    size: opened.len(),
                });
            }
        }
        Err(refused())
    }
}

/// Exact names remain authoritative, even if they are denied links. Only an
/// absent name may resolve through one unique NFC/Unicode-space display alias.
fn display_name(dir: &Dir, requested: &Path) -> io::Result<OsString> {
    match dir.symlink_metadata(requested) {
        Ok(_) => return Ok(requested.as_os_str().to_owned()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let key = display_key(requested.to_str().ok_or_else(refused)?);
    let mut matched = None;
    for entry in dir.entries()? {
        let name = entry?.file_name();
        if name.to_str().is_some_and(|name| display_key(name) == key) {
            if matched.is_some() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Ambiguous Unicode display name",
                ));
            }
            matched = Some(name);
        }
    }
    matched.ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Resource not found"))
}

fn display_key(value: &str) -> String {
    value
        .nfc()
        .map(|c| match c {
            '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}' => ' ',
            other => other,
        })
        .collect()
}

impl OpenedFile {
    pub(super) fn reader(self) -> io::Result<SnapshotReader> {
        let before = self.file.metadata()?;
        Ok(SnapshotReader {
            file: self.file,
            before,
        })
    }
    /// Own the admitted descriptor, seek once and cap each subsequent read at
    /// the admitted end. Appends cannot extend this stream. Dropping it closes
    /// the file; revocation prevents subsequent chunks from being delivered.
    #[cfg(test)]
    pub(super) fn stream(
        mut self,
        start: u64,
        length: u64,
        live: Arc<AtomicBool>,
    ) -> io::Result<FileStream> {
        if !live.load(Ordering::Acquire) || start > self.size || length > self.size - start {
            return Err(refused());
        }
        self.file.seek(SeekFrom::Start(start))?;
        Ok(FileStream {
            reader: self.file.take(length),
            live,
        })
    }

    pub(crate) fn read_bounded(self, max: u64) -> io::Result<Vec<u8>> {
        if self.size > max {
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "Resource exceeds its preview budget",
            ));
        }
        let before = self.file.metadata()?;
        let mut reader = self.file.take(max.saturating_add(1));
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes)?;
        if bytes.len() as u64 > max {
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "Resource exceeds its preview budget",
            ));
        }
        let after = reader.get_ref().metadata()?;
        if before.len() != after.len()
            || before.modified().ok() != after.modified().ok()
            || bytes.len() as u64 != after.len()
        {
            return Err(io::Error::other("Resource changed while reading"));
        }
        Ok(bytes)
    }
}

#[cfg(test)]
pub(super) struct FileStream {
    reader: io::Take<File>,
    live: Arc<AtomicBool>,
}
#[cfg(test)]
impl Read for FileStream {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if !self.live.load(Ordering::Acquire) {
            return Err(refused());
        }
        let read = self.reader.read(buffer)?;
        if !self.live.load(Ordering::Acquire) {
            return Err(refused());
        }
        Ok(read)
    }
}

/// The descriptor remains authoritative across path replacement. In-place
/// truncation or writes invalidate it rather than silently completing a body
/// whose Content-Length or bytes no longer match the admitted file.
pub(super) struct SnapshotReader {
    file: File,
    before: std::fs::Metadata,
}
impl SnapshotReader {
    fn validate(&self) -> io::Result<()> {
        let now = self.file.metadata()?;
        if now.len() != self.before.len() || now.modified().ok() != self.before.modified().ok() {
            Err(io::Error::other("Resource changed while reading"))
        } else {
            Ok(())
        }
    }
}
impl Read for SnapshotReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.validate()?;
        let n = self.file.read(buffer)?;
        self.validate()?;
        Ok(n)
    }
}
impl Seek for SnapshotReader {
    fn seek(&mut self, seek: SeekFrom) -> io::Result<u64> {
        self.validate()?;
        self.file.seek(seek)
    }
}
