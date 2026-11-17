//! A detached desktop may outlive the terminal that owns its diagnostic pipes.
//! Preserve other IO errors and panics; only broken stdio writes are harmless.
use std::io::{self, Write};

pub fn is_broken_stdio_write_error(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::BrokenPipe || {
        #[cfg(unix)]
        {
            error.raw_os_error() == Some(libc::EIO)
        }
        #[cfg(not(unix))]
        {
            false
        }
    }
}

pub fn write_line(writer: &mut impl Write, args: std::fmt::Arguments<'_>) -> io::Result<()> {
    match writer.write_fmt(format_args!("{args}\n")) {
        Err(error) if is_broken_stdio_write_error(&error) => Ok(()),
        result => result,
    }
}

/// Like `eprintln!`, but a closed terminal cannot crash the desktop.
#[macro_export]
macro_rules! diagnosticln {
    ($($argument:tt)*) => {{
        $crate::platform::stdio_guard::write_line(&mut std::io::stderr().lock(), format_args!($($argument)*))
            .expect("failed to write diagnostic");
    }};
}

/// The stdout equivalent for diagnostic/CLI output.
#[macro_export]
macro_rules! outputln {
    ($($argument:tt)*) => {{
        $crate::platform::stdio_guard::write_line(&mut std::io::stdout().lock(), format_args!($($argument)*))
            .expect("failed to write output");
    }};
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn broken_pipe_and_io_writes_are_ignored_but_other_errors_are_preserved() {
        struct Fails(i32);
        impl Write for Fails {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::from_raw_os_error(self.0))
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        for error in [libc::EIO, libc::EPIPE] {
            assert!(is_broken_stdio_write_error(&io::Error::from_raw_os_error(
                error
            )));
            write_line(&mut Fails(error), format_args!("diagnostic")).unwrap();
        }
        for error in [libc::ENOENT, libc::EACCES] {
            assert!(!is_broken_stdio_write_error(&io::Error::from_raw_os_error(
                error
            )));
            assert_eq!(
                write_line(&mut Fails(error), format_args!("diagnostic"))
                    .unwrap_err()
                    .raw_os_error(),
                Some(error)
            );
        }
        let mut output = Vec::new();
        write_line(&mut output, format_args!("event {}", 7)).unwrap();
        assert_eq!(output, b"event 7\n");
    }

    #[test]
    fn closed_stdio_child_entrypoint() {
        if std::env::var_os("PUPPYONE_TEST_CLOSED_STDIO_CHILD").is_none() {
            return;
        }
        use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
        struct Redirect {
            original: OwnedFd,
            target: i32,
        }
        impl Drop for Redirect {
            fn drop(&mut self) {
                assert_eq!(
                    unsafe { libc::dup2(self.original.as_raw_fd(), self.target) },
                    self.target
                );
            }
        }
        fn close_pipe(target: i32) -> Redirect {
            let original = unsafe { libc::dup(target) };
            assert!(original >= 0);
            let mut fds = [0; 2];
            assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
            let (read, write) =
                unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
            drop(read);
            assert_eq!(unsafe { libc::dup2(write.as_raw_fd(), target) }, target);
            Redirect {
                original: unsafe { OwnedFd::from_raw_fd(original) },
                target,
            }
        }
        // Only redirect in this isolated subprocess, after libtest's own banner.
        let _stdout = close_pipe(libc::STDOUT_FILENO);
        let _stderr = close_pipe(libc::STDERR_FILENO);
        crate::diagnosticln!("replyWithError simulated");
        crate::outputln!("output after inherited pipe closed");
    }

    #[test]
    fn closed_real_stdout_and_stderr_do_not_crash_the_desktop() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "platform::stdio_guard::tests::closed_stdio_child_entrypoint",
                "--exact",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("PUPPYONE_TEST_CLOSED_STDIO_CHILD", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "stdio diagnostics crashed the child: {} {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    }
}
