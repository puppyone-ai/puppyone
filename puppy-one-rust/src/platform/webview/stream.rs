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

/// A prepared response owns its admitted reader but does not read any body
/// bytes until the transport asks. Metadata is separate from the body so a
/// native transport never needs to collect a whole selected range.
pub struct PreparedResponse {
    pub metadata: ProtocolResponse,
    pub body: ResponseBody,
}
impl PreparedResponse {
    pub(super) fn bytes(content: &PreparedContent, mut metadata: ProtocolResponse) -> Self {
        let bytes = std::mem::take(&mut metadata.body);
        let length = bytes.len() as u64;
        Self::reader(content, metadata, Box::new(io::Cursor::new(bytes)), length)
    }
    fn reader(
        content: &PreparedContent,
        metadata: ProtocolResponse,
        reader: Box<dyn Read + Send>,
        length: u64,
    ) -> Self {
        Self {
            metadata,
            body: ResponseBody {
                content: content.clone(),
                reader: Some(reader),
                remaining: length,
            },
        }
    }
    /// Compatibility for transports that only accept a complete body. Native
    /// streaming adapters consume `body` directly instead.
    pub fn collect(mut self) -> ProtocolResponse {
        let mut bytes = Vec::new();
        let mut buffer = [0; CHUNK_BYTES];
        loop {
            match self.body.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => bytes.extend_from_slice(&buffer[..n]),
                Err(reason) => {
                    let mut response = error(reason);
                    response.cors = self.metadata.cors;
                    return response;
                }
            }
        }
        self.metadata.body = bytes;
        self.metadata
    }
}
pub const CHUNK_BYTES: usize = 64 * 1024;

/// The fixed admitted extent and owner authority are checked around every
/// read. An error is terminal, clears the caller's buffer and closes the
/// reader; even a misbehaving provider cannot leak a revoked chunk.
pub struct ResponseBody {
    content: PreparedContent,
    reader: Option<Box<dyn Read + Send>>,
    remaining: u64,
}
impl Read for ResponseBody {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let result = (|| {
            if !self.content.is_live() {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            if self.remaining == 0 || buffer.is_empty() {
                return Ok(0);
            }
            let wanted = self.remaining.min(buffer.len().min(CHUNK_BYTES) as u64) as usize;
            let reader = self.reader.as_mut().ok_or(io::ErrorKind::BrokenPipe)?;
            let n = reader.read(&mut buffer[..wanted])?;
            if !self.content.is_live() {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
            if n > wanted {
                return Err(io::Error::other("Provider exceeded the requested range"));
            }
            if n == 0 {
                return Err(io::ErrorKind::UnexpectedEof.into());
            }
            self.remaining -= n as u64;
            Ok(n)
        })();
        if result.is_err() {
            buffer.fill(0);
            self.reader.take();
        } else if self.remaining == 0 {
            self.reader.take();
        }
        result
    }
}

pub(super) fn response(
    content: &PreparedContent,
    mut stream: ResourceStream,
    mime: &'static str,
    head: bool,
    range: Option<&str>,
    max: u64,
) -> PreparedResponse {
    let size = stream.length;
    let mut metadata = ProtocolResponse::metadata(mime, size);
    if head {
        return PreparedResponse::bytes(content, metadata);
    }
    let (start, length) = match ByteRange::parse(range, size) {
        ByteRange::Whole => (0, size),
        ByteRange::Part { start, end } => {
            metadata.partial(start, end, size);
            (start, end - start + 1)
        }
        ByteRange::Unsatisfiable => {
            metadata.unsatisfiable(size);
            return PreparedResponse::bytes(content, metadata);
        }
    };
    if length > max {
        return PreparedResponse::bytes(content, error(io::ErrorKind::FileTooLarge.into()));
    }
    match stream.reader.seek(SeekFrom::Start(start)) {
        Ok(actual) if actual == start => {
            PreparedResponse::reader(content, metadata, stream.reader, length)
        }
        Ok(_) => PreparedResponse::bytes(
            content,
            error(io::Error::other(
                "Provider did not seek to the selected range",
            )),
        ),
        Err(reason) => PreparedResponse::bytes(content, error(reason)),
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
