//! A request owns one reader and its admitted extent. Range selection happens
//! before body reads; HEAD opens metadata but never consumes the body.
use super::{PreparedContent, ProtocolResponse, range::ByteRange};
use std::{
    collections::HashSet,
    io::{self, Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub trait ReadSeek: Read + Seek + Send {}
impl<T: Read + Seek + Send> ReadSeek for T {}
pub struct ResourceStream {
    pub length: u64,
    pub reader: Box<dyn ReadSeek>,
}

pub(super) fn error(error: io::Error) -> ProtocolResponse {
    match error.kind() {
        io::ErrorKind::PermissionDenied => ProtocolResponse::error(403, "Forbidden"),
        io::ErrorKind::FileTooLarge => {
            ProtocolResponse::error(413, "Resource exceeds its preview budget")
        }
        io::ErrorKind::Unsupported => ProtocolResponse::error(501, "Provider stream unavailable"),
        _ => ProtocolResponse::error(404, "Resource unavailable"),
    }
}

pub(super) fn response(
    content: &PreparedContent,
    mut stream: ResourceStream,
    mime: &'static str,
    head: bool,
    range: Option<&str>,
) -> ProtocolResponse {
    let size = stream.length;
    let mut response = ProtocolResponse::metadata(mime, size);
    if head {
        return response;
    }
    let (start, length) = match ByteRange::parse(range, size) {
        ByteRange::Whole => (0, size),
        ByteRange::Part { start, end } => {
            response.partial(start, end, size);
            (start, end - start + 1)
        }
        ByteRange::Unsatisfiable => {
            response.unsatisfiable(size);
            return response;
        }
    };
    if length > content.max_bytes {
        return error(io::ErrorKind::FileTooLarge.into());
    }
    let bytes = (|| -> io::Result<Vec<u8>> {
        if stream.reader.seek(SeekFrom::Start(start))? != start {
            return Err(io::Error::other(
                "Provider did not seek to the selected range",
            ));
        }
        let mut bytes = Vec::new();
        let mut buffer = [0; 64 * 1024];
        while bytes.len() as u64 != length {
            if !content.is_live() {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            let wanted = (length - bytes.len() as u64).min(buffer.len() as u64) as usize;
            let n = stream.reader.read(&mut buffer[..wanted])?;
            if n > wanted {
                return Err(io::Error::other("Provider exceeded the requested range"));
            }
            if !content.is_live() {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            if n == 0 {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            bytes.extend_from_slice(&buffer[..n]);
        }
        Ok(bytes)
    })();
    match bytes {
        Ok(bytes) => {
            response.body = bytes;
            response
        }
        Err(reason) => error(reason),
    }
}

type Usage = Arc<Mutex<(HashSet<PathBuf>, u64)>>;
struct BudgetReader {
    inner: Box<dyn ReadSeek>,
    used: Usage,
    max: u64,
}
impl Read for BudgetReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        let remaining = self.max.saturating_sub(
            self.used
                .lock()
                .map_err(|_| io::Error::other("Budget lock unavailable"))?
                .1,
        );
        let allowed = remaining.min(bytes.len() as u64) as usize;
        if allowed == 0 {
            return Err(io::ErrorKind::FileTooLarge.into());
        }
        let n = self.inner.read(&mut bytes[..allowed])?;
        if n > allowed {
            return Err(io::Error::other("Provider exceeded its read budget"));
        }
        let mut used = self
            .used
            .lock()
            .map_err(|_| io::Error::other("Budget lock unavailable"))?;
        if n as u64 > self.max.saturating_sub(used.1) {
            return Err(io::ErrorKind::FileTooLarge.into());
        }
        used.1 += n as u64;
        Ok(n)
    }
}
impl Seek for BudgetReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        self.inner.seek(from)
    }
}
pub(super) fn budgeted(stream: ResourceStream, used: Usage, max: u64) -> ResourceStream {
    ResourceStream {
        length: stream.length,
        reader: Box::new(BudgetReader {
            inner: stream.reader,
            used,
            max,
        }),
    }
}
