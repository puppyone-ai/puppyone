//! Unix process-group isolation, termination, and fd-3 bootstrap pipes.
use std::{
    io::Write,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::process::CommandExt,
    },
    process::{Child, Command},
    thread,
    time::{Duration, Instant},
};

pub(super) struct BootstrapPipe {
    read: OwnedFd,
    write: OwnedFd,
}

impl BootstrapPipe {
    pub(super) fn deliver_async(self, payload: Vec<u8>) {
        drop(self.read);
        let write = self.write;
        std::thread::spawn(move || {
            let mut pipe = std::fs::File::from(write);
            let _ = pipe.write_all(&payload);
        });
    }
}

pub(super) fn attach_bootstrap_pipe(
    command: &mut tokio::process::Command,
) -> std::io::Result<BootstrapPipe> {
    let mut fds = [0; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    for fd in [read.as_raw_fd(), write.as_raw_fd()] {
        unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    let source = read.as_raw_fd();
    unsafe {
        command.pre_exec(move || {
            if source == 3 {
                if libc::fcntl(3, libc::F_SETFD, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }
            } else if libc::dup2(source, 3) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    Ok(BootstrapPipe { read, write })
}

pub(super) fn isolate_std(command: &mut Command) {
    command.process_group(0);
}

pub(super) fn isolate_tokio(command: &mut tokio::process::Command) {
    command.process_group(0);
}

pub(super) fn terminate_child(child: &mut Child) {
    // Only signal the process group created by isolate(), never the GUI's group.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(100));
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    thread::sleep(Duration::from_millis(20));
    let _ = child.kill();
    let _ = child.wait();
}

pub(super) fn is_alive(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 only checks that the process exists.
    let signalled = unsafe { libc::kill(pid, 0) } == 0;
    signalled || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

pub(super) fn terminate_pid(pid: u32, grouped: bool, force: bool) -> bool {
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    if grouped && unsafe { libc::kill(-(pid as i32), signal) } == 0 {
        return true;
    }
    unsafe { libc::kill(pid as i32, signal) == 0 }
}

pub(super) fn wait_process_group_gone(pid: u32) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        if unsafe { libc::kill(-(pid as i32), 0) } != 0 {
            let error = std::io::Error::last_os_error();
            return match error.raw_os_error() {
                Some(libc::ESRCH) => Ok(()),
                // On macOS, probing a process group whose leader has already
                // been reaped can yield EPERM instead of ESRCH.
                Some(libc::EPERM) if unsafe { libc::kill(pid as i32, 0) } != 0 => Ok(()),
                _ => Err(error.to_string()),
            };
        }
        if Instant::now() >= deadline {
            return Err("Owned process group did not exit".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
}

pub(super) fn signal_name(signal: i32) -> String {
    match signal {
        libc::SIGTERM => "SIGTERM".into(),
        libc::SIGKILL => "SIGKILL".into(),
        libc::SIGINT => "SIGINT".into(),
        libc::SIGHUP => "SIGHUP".into(),
        libc::SIGPIPE => "SIGPIPE".into(),
        other => format!("SIG{other}"),
    }
}
