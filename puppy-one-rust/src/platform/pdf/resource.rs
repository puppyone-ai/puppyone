use super::Failure;
use pdfium_render::prelude::PdfiumReader;
use std::{
    io::{self, Cursor, Read, Seek, SeekFrom},
    path::PathBuf,
};

pub type Reader = Box<dyn PdfiumReader + Send>;
pub enum Source {
    /// An explicitly selected platform file; workspace viewers use Reader.
    File(PathBuf),
    Bytes(Vec<u8>),
    /// Invoked on the PDF worker, so capability admission never performs I/O
    /// on the UI thread. PDFium keeps this same reader until document close.
    Reader(Box<dyn FnOnce() -> Result<Reader, Failure> + Send>),
}

pub(super) struct Admitted {
    reader: Reader,
    size: u64,
    position: u64,
}
pub(super) fn admit(source: Source, max: u64) -> Result<Admitted, Failure> {
    let mut reader: Reader = match source {
        Source::Bytes(bytes) => Box::new(Cursor::new(bytes)),
        Source::Reader(open) => open()?,
        Source::File(path) => {
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
            }
            let file = options.open(path).map_err(|_| Failure::Resource)?;
            if !file.metadata().map_err(|_| Failure::Resource)?.is_file() {
                return Err(Failure::Resource);
            }
            Box::new(file)
        }
    };
    let size = reader
        .seek(SeekFrom::End(0))
        .map_err(|_| Failure::Resource)?;
    if size > max {
        return Err(Failure::Limit);
    }
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| Failure::Resource)?;
    let mut admitted = Admitted {
        reader,
        size,
        position: 0,
    };
    let mut head = [0; 1024];
    let length = size.min(head.len() as u64) as usize;
    admitted
        .read_exact(&mut head[..length])
        .map_err(|_| Failure::Resource)?;
    if !head[..length].windows(8).any(|w| {
        &w[..5] == b"%PDF-" && matches!(w[5], b'1' | b'2') && w[6] == b'.' && w[7].is_ascii_digit()
    }) {
        return Err(Failure::Resource);
    }
    admitted
        .seek(SeekFrom::Start(0))
        .map_err(|_| Failure::Resource)?;
    Ok(admitted)
}

impl Read for Admitted {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self
            .size
            .saturating_sub(self.position)
            .min(buffer.len() as u64) as usize;
        if count == 0 {
            return Ok(0);
        }
        let n = self.reader.read(&mut buffer[..count])?;
        if n > count {
            return Err(io::Error::other("PDF source exceeded its admitted extent"));
        }
        self.position += n as u64;
        Ok(n)
    }
}
impl Seek for Admitted {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let target = match from {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::Current(n) => self.position.checked_add_signed(n),
            SeekFrom::End(n) => self.size.checked_add_signed(n),
        }
        .filter(|n| *n <= self.size)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Seek outside admitted PDF"))?;
        let position = self.reader.seek(SeekFrom::Start(target))?;
        if position != target {
            return Err(io::Error::other(
                "PDF source did not seek to the requested offset",
            ));
        }
        self.position = target;
        Ok(target)
    }
}
