//! Bounded, cancellable child processes. No process or pipe is owned by a view.
mod pipes;
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
pub fn isolate(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}
#[cfg(not(unix))]
pub fn isolate(_: &mut Command) {}

pub fn terminate(child: &mut std::process::Child) {
    #[cfg(unix)]
    // Only signal the process group created by isolate(), never the GUI's group.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(100));
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn bounded_read(mut reader: impl Read, max: usize) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buf = [0; 8192];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            return Ok(bytes);
        }
        if bytes.len() + n > max {
            return Err(std::io::Error::other("Process output exceeded its limit"));
        }
        bytes.extend_from_slice(&buf[..n]);
    }
}

pub fn run(
    executable: &Path,
    args: &[&str],
    root: &Path,
    input: Option<&[u8]>,
    timeout: Duration,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    const CANCELLED: &str = "Command cancelled, timed out, or exceeded its output limit";
    if cancel.load(Ordering::Acquire) || timeout.is_zero() {
        return Err(CANCELLED.into());
    }
    let started = Instant::now();
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(root)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    isolate(&mut command);
    let child = command.spawn().map_err(|e| e.to_string())?;
    thread::scope(move |scope| {
        // The owner lives inside the scope: any worker-start failure terminates
        // the child before scoped threads are joined, including blocked stdin.
        let stop = Arc::new(AtomicBool::new(false));
        let overflow = Arc::new(AtomicBool::new(false));
        let mut owner = ProcessOwner {
            child,
            stop: stop.clone(),
            settled: false,
        };
        let stdin = owner.child.stdin.take().expect("piped stdin");
        let stdout = owner.child.stdout.take().expect("piped stdout");
        let stderr = owner.child.stderr.take().expect("piped stderr");
        let stdin_ready = pipes::nonblocking(&stdin).map_err(|e| e.to_string())?;
        let stdout_ready = pipes::nonblocking(&stdout).map_err(|e| e.to_string())?;
        let stderr_ready = pipes::nonblocking(&stderr).map_err(|e| e.to_string())?;
        let out_stop = stop.clone();
        let out_limit = overflow.clone();
        let out = thread::Builder::new()
            .name("command-stdout".into())
            .spawn_scoped(scope, move || {
                let result = pipes::read(stdout, stdout_ready, 8 * 1024 * 1024, &out_stop);
                if result.is_err() {
                    out_limit.store(true, Ordering::Release);
                }
                result
            })
            .map_err(|e| e.to_string())?;
        let err_stop = stop.clone();
        let err_limit = overflow.clone();
        let err = thread::Builder::new()
            .name("command-stderr".into())
            .spawn_scoped(scope, move || {
                let result = pipes::read(stderr, stderr_ready, 256 * 1024, &err_stop);
                if result.is_err() {
                    err_limit.store(true, Ordering::Release);
                }
                result
            })
            .map_err(|e| e.to_string())?;
        let mut writer = Some(
            thread::Builder::new()
                .name("command-stdin".into())
                .spawn_scoped(scope, move || {
                    pipes::write(stdin, stdin_ready, input.unwrap_or_default(), &stop)
                })
                .map_err(|e| e.to_string())?,
        );
        let mut written = None;
        let mut exited = None;
        let mut result = loop {
            if cancel.load(Ordering::Acquire)
                || overflow.load(Ordering::Acquire)
                || started.elapsed() >= timeout
            {
                break Err(CANCELLED.to_owned());
            }
            if writer.as_ref().is_some_and(|writer| writer.is_finished()) {
                written = Some(
                    writer
                        .take()
                        .unwrap()
                        .join()
                        .map_err(|_| "Input writer failed".to_owned())
                        .and_then(|r| r.map_err(|e| e.to_string())),
                );
            }
            if let Some(Err(error)) = &written {
                break Err(error.clone());
            }
            if exited.is_none() {
                match owner.child.try_wait() {
                    Ok(status) => exited = status,
                    Err(error) => break Err(error.to_string()),
                }
            }
            // A reaped parent is not completion while descendants hold a pipe.
            if writer.is_none()
                && out.is_finished()
                && err.is_finished()
                && let Some(status) = exited
            {
                break Ok(status);
            }
            thread::sleep(Duration::from_millis(10));
        };
        if let Err(reason) = &result {
            if let Err(error) = owner.terminate() {
                result = Err(format!("{reason}; process cleanup failed: {error}"));
            }
        } else {
            owner.settled = true;
        }
        let output = out.join().map_err(|_| "Output reader failed".to_owned());
        let errors = err.join().map_err(|_| "Error reader failed".to_owned());
        if let Some(writer) = writer {
            let _ = writer.join();
        }
        // Cancellation owns its result even when stopping a pipe interrupts its
        // reader. All workers and the child are settled before returning it.
        let status = result?;
        let output = output?.map_err(|e| e.to_string())?;
        let errors = errors?.map_err(|e| e.to_string())?;
        if status.success() {
            Ok(output)
        } else {
            let error = String::from_utf8_lossy(&errors).trim().to_owned();
            Err(if error.is_empty() {
                String::from_utf8_lossy(&output).trim().to_owned()
            } else {
                error
            })
        }
    })
}
struct ProcessOwner {
    child: std::process::Child,
    stop: Arc<AtomicBool>,
    settled: bool,
}
impl ProcessOwner {
    fn terminate(&mut self) -> Result<(), String> {
        if self.settled {
            return Ok(());
        }
        self.stop.store(true, Ordering::Release);
        terminate(&mut self.child);
        self.settled = true;
        #[cfg(unix)]
        {
            // wait() only reaps the direct child. After its exit, SIGKILL can
            // still be pending for descendants holding sockets or pipes.
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                if unsafe { libc::kill(-(self.child.id() as i32), 0) } != 0 {
                    let error = std::io::Error::last_os_error();
                    return if error.raw_os_error() == Some(libc::ESRCH) {
                        Ok(())
                    } else {
                        Err(error.to_string())
                    };
                }
                if Instant::now() >= deadline {
                    return Err("Owned process group did not exit".into());
                }
                thread::sleep(Duration::from_millis(10));
            }
        }
        #[cfg(not(unix))]
        Ok(())
    }
}
impl Drop for ProcessOwner {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

#[cfg(all(test, unix))]
mod tests;
