//! User-private local async IPC transport for the workspace host control channel.
//!
//! Uses a `0600` Unix domain socket (falling back to `~/.puppyone-host/<hash>.sock`
//! when `dir/control.sock` exceeds the 104-byte `sun_path` limit) on Unix, and an
//! ephemeral `127.0.0.1` TCP listener whose port is written to `endpoint` on Windows.
use std::{
    io,
    path::{Path, PathBuf},
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
#[cfg(not(unix))]
use tokio::net::{TcpListener, TcpStream};
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};

#[cfg(unix)]
const MAX_SOCKET_PATH: usize = 100;

/// Resolves the local IPC endpoint path for `dir` (shortening into `~/.puppyone-host`
/// on Unix when the state directory path is too long for `sockaddr_un`).
pub fn endpoint_path(dir: &Path) -> PathBuf {
    let inside = dir.join("control.sock");
    #[cfg(not(unix))]
    {
        inside
    }
    #[cfg(unix)]
    {
        if inside.as_os_str().len() <= MAX_SOCKET_PATH {
            return inside;
        }
        let name = &blake3::hash(dir.as_os_str().as_encoded_bytes()).to_hex()[..24];
        let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
        home.join(".puppyone-host").join(format!("{name}.sock"))
    }
}

/// Async stream connected to a local user-private IPC listener.
pub struct Stream {
    #[cfg(unix)]
    inner: UnixStream,
    #[cfg(not(unix))]
    inner: TcpStream,
}

impl AsyncRead for Stream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for Stream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// Async listener bound to a user-private local endpoint.
pub struct Listener {
    #[cfg(unix)]
    inner: UnixListener,
    #[cfg(not(unix))]
    inner: TcpListener,
}

impl Listener {
    /// Binds a user-private local listener at `endpoint`.
    pub async fn bind(endpoint: &Path) -> io::Result<Self> {
        if let Some(parent) = endpoint.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let _ = std::fs::remove_file(endpoint);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let inner = UnixListener::bind(endpoint)?;
            let _ = std::fs::set_permissions(endpoint, std::fs::Permissions::from_mode(0o600));
            Ok(Self { inner })
        }
        #[cfg(not(unix))]
        {
            let inner = TcpListener::bind(("127.0.0.1", 0)).await?;
            let port = inner.local_addr()?.port();
            std::fs::write(endpoint, port.to_string())?;
            let _ = super::fs::set_private_file_permissions(endpoint);
            Ok(Self { inner })
        }
    }

    /// Accepts the next incoming local connection.
    pub async fn accept(&self) -> io::Result<Stream> {
        let (inner, _) = self.inner.accept().await?;
        Ok(Stream { inner })
    }
}

/// Connects to an existing local IPC listener at `endpoint`.
pub async fn connect(endpoint: &Path) -> io::Result<Stream> {
    #[cfg(unix)]
    {
        Ok(Stream {
            inner: UnixStream::connect(endpoint).await?,
        })
    }
    #[cfg(not(unix))]
    {
        let port_text = std::fs::read_to_string(endpoint)?;
        let port: u16 = port_text
            .trim()
            .parse()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid control port"))?;
        Ok(Stream {
            inner: TcpStream::connect(("127.0.0.1", port)).await?,
        })
    }
}
