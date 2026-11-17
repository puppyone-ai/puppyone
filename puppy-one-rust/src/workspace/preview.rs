//! A preview reader owns its admitted provider stream. A path is never read
//! authority, and cached bytes do not bypass lease checks after acquisition.
use super::{
    Lease, PreviewData, PreviewResource, Result,
    ports::{ResourceReader, SessionReadResult, SessionReader},
};
use std::io::{self, Cursor, Read, Seek, SeekFrom};

pub struct PreviewReader {
    source: ResourceReader,
    lease: Lease,
    position: u64,
}
impl PreviewResource {
    /// A lazy, read-only database session. Local inputs must be opened by
    /// their provider with sidecar and identity validation; hosted bytes
    /// remain the already admitted snapshot without another full copy.
    pub fn session_reader(&self) -> SessionReadResult<SessionReader> {
        let SessionReader {
            mut source,
            validate,
        } = match self.data()? {
            PreviewData::Bytes { bytes, .. } => SessionReader {
                source: ResourceReader {
                    length: bytes.len() as u64,
                    reader: Box::new(Cursor::new(bytes.clone())),
                },
                validate: std::sync::Arc::new(|| Ok(())),
            },
            PreviewData::LocalFile(_) => self
                .lease
                .provider
                .preview_session_reader(&self.binding.path)?,
        };
        let lease = self.lease.clone();
        let validate: std::sync::Arc<dyn Fn() -> SessionReadResult<()> + Send + Sync> =
            std::sync::Arc::new(move || {
                lease.check()?;
                validate()?;
                lease.check()?;
                Ok(())
            });
        validate()?;
        if source
            .reader
            .seek(SeekFrom::Start(0))
            .map_err(|error| super::Error::new(super::ErrorKind::Io, error.to_string()))?
            != 0
        {
            return Err(super::Error::new(
                super::ErrorKind::Io,
                "Provider did not rewind the session",
            )
            .into());
        }
        validate()?;
        Ok(SessionReader {
            source: ResourceReader {
                length: source.length,
                reader: Box::new(PreviewReader {
                    source,
                    lease: self.lease.clone(),
                    position: 0,
                }),
            },
            validate,
        })
    }
    /// Open without buffering. Consumers check `len()` against their format's
    /// budget before reading. The admitted extent cannot grow after opening.
    pub fn reader(&self) -> Result<PreviewReader> {
        let mut source = match self.data()? {
            PreviewData::Bytes { bytes, .. } => ResourceReader {
                length: bytes.len() as u64,
                reader: Box::new(Cursor::new(bytes.clone())),
            },
            PreviewData::LocalFile(_) => self.lease.provider.preview_reader(&self.binding.path)?,
        };
        self.lease.check()?;
        if source
            .reader
            .seek(SeekFrom::Start(0))
            .map_err(|error| super::Error::new(super::ErrorKind::Io, error.to_string()))?
            != 0
        {
            return Err(super::Error::new(
                super::ErrorKind::Io,
                "Provider did not rewind the preview",
            ));
        }
        self.lease.check()?;
        Ok(PreviewReader {
            source,
            lease: self.lease.clone(),
            position: 0,
        })
    }
}
impl PreviewReader {
    pub fn len(&self) -> u64 {
        self.source.length
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    fn check(&self) -> io::Result<()> {
        self.lease
            .check()
            .map_err(|e| io::Error::new(io::ErrorKind::PermissionDenied, e))
    }
}
impl Read for PreviewReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.check()?;
        let available = self
            .len()
            .saturating_sub(self.position)
            .min(bytes.len() as u64) as usize;
        if available == 0 {
            return Ok(0);
        }
        let read = self.source.reader.read(&mut bytes[..available]);
        if let Err(error) = self.check() {
            bytes[..available].fill(0);
            return Err(error);
        }
        let n = read?;
        if n > available {
            return Err(io::Error::other("Provider exceeded its admitted extent"));
        }
        self.position += n as u64;
        Ok(n)
    }
}
impl Seek for PreviewReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.check()?;
        let target = match from {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::Current(n) => self.position.checked_add_signed(n),
            SeekFrom::End(n) => self.len().checked_add_signed(n),
        }
        .filter(|n| *n <= self.len())
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Seek outside admitted preview")
        })?;
        let actual = self.source.reader.seek(SeekFrom::Start(target))?;
        self.check()?;
        if actual != target {
            return Err(io::Error::other(
                "Provider did not seek to the requested offset",
            ));
        }
        self.position = actual;
        Ok(actual)
    }
}

#[cfg(test)]
mod tests;
