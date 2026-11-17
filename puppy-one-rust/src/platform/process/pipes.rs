//! Unix pipes are nonblocking so closing a command never depends on an escaped
//! descendant voluntarily releasing an inherited descriptor.
use std::{
    io::{self, Read, Write},
    sync::atomic::{AtomicBool, Ordering},
};
pub(super) struct Readiness {
    #[cfg(unix)]
    fd: std::os::fd::RawFd,
}
#[cfg(unix)]
pub(super) fn nonblocking(pipe: &impl std::os::fd::AsRawFd) -> io::Result<Readiness> {
    let fd = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags == -1 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(Readiness { fd })
}
#[cfg(not(unix))]
pub(super) fn nonblocking<T>(_: &T) -> io::Result<Readiness> {
    Ok(Readiness {})
}
impl Readiness {
    fn retry(&self, error: &io::Error, writing: bool) -> io::Result<bool> {
        match error.kind() {
            io::ErrorKind::Interrupted => Ok(true),
            io::ErrorKind::WouldBlock => {
                #[cfg(unix)]
                {
                    let mut descriptor = libc::pollfd {
                        fd: self.fd,
                        events: if writing { libc::POLLOUT } else { libc::POLLIN },
                        revents: 0,
                    };
                    // Bound cancellation latency without continuously polling
                    // idle pipes. The owning worker keeps this descriptor open.
                    if unsafe { libc::poll(&mut descriptor, 1, 25) } < 0 {
                        let error = io::Error::last_os_error();
                        if error.kind() != io::ErrorKind::Interrupted {
                            return Err(error);
                        }
                    }
                }
                #[cfg(not(unix))]
                {
                    let _ = writing;
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}
fn stopped(stop: &AtomicBool) -> io::Result<()> {
    if stop.load(Ordering::Acquire) {
        Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "Command stopped",
        ))
    } else {
        Ok(())
    }
}
pub(super) fn read(
    mut pipe: impl Read,
    readiness: Readiness,
    limit: usize,
    stop: &AtomicBool,
) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        stopped(stop)?;
        match pipe.read(&mut buffer) {
            Ok(0) => return Ok(bytes),
            Ok(length) => {
                if bytes.len() + length > limit {
                    return Err(io::Error::other("Process output exceeded its limit"));
                }
                bytes.extend_from_slice(&buffer[..length]);
            }
            Err(error) if readiness.retry(&error, false)? => (),
            Err(error) => return Err(error),
        }
    }
}
pub(super) fn write(
    mut pipe: impl Write,
    readiness: Readiness,
    mut input: &[u8],
    stop: &AtomicBool,
) -> io::Result<()> {
    while !input.is_empty() {
        stopped(stop)?;
        match pipe.write(input) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "Process input closed",
                ));
            }
            Ok(length) => input = &input[length..],
            Err(error) if readiness.retry(&error, true)? => (),
            Err(error) => return Err(error),
        }
    }
    pipe.flush()
}
