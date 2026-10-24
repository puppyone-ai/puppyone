//! Bounded, cancellable child processes. No process or pipe is owned by a view.
use std::{
    io::{Read, Write},
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
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().unwrap();
    if let Some(data) = input
        && let Err(e) = stdin.write_all(data)
    {
        terminate(&mut child);
        return Err(e.to_string());
    }
    drop(stdin);
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let overflow = Arc::new(AtomicBool::new(false));
    let flag = overflow.clone();
    let out = thread::spawn(move || {
        let r = bounded_read(stdout, 8 * 1024 * 1024);
        if r.is_err() {
            flag.store(true, Ordering::Relaxed);
        }
        r
    });
    let flag = overflow.clone();
    let err = thread::spawn(move || {
        let r = bounded_read(stderr, 256 * 1024);
        if r.is_err() {
            flag.store(true, Ordering::Relaxed);
        }
        r
    });
    let started = Instant::now();
    let result = loop {
        if cancel.load(Ordering::Relaxed)
            || overflow.load(Ordering::Relaxed)
            || started.elapsed() > timeout
        {
            terminate(&mut child);
            break Err("Command cancelled, timed out, or exceeded its output limit".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(15)),
            Err(e) => {
                terminate(&mut child);
                break Err(e.to_string());
            }
        }
    };
    let out = out
        .join()
        .map_err(|_| "Output reader failed")?
        .map_err(|e| e.to_string())?;
    let err = err
        .join()
        .map_err(|_| "Error reader failed")?
        .map_err(|e| e.to_string())?;
    if result?.success() {
        Ok(out)
    } else {
        Err(String::from_utf8_lossy(&err).trim().to_owned())
    }
}
