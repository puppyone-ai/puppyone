//! `requestSingleInstanceLock` / `second-instance`: one process per data
//! directory. A later launch hands its arguments and working directory to
//! the running one over a local socket and exits; the running one opens
//! what they name (`handleSecondInstanceLaunch`).
//!
//! The socket lives in the data directory, so a test or capture with its
//! own `PUPPYONE_RUST_DATA_DIR` never meets the app in daily use. A socket
//! left by a process that is gone is replaced.
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    io::{BufRead, BufReader, Write},
    os::unix::{
        ffi::{OsStrExt, OsStringExt},
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
};

/// What a later launch hands over.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Handoff {
    /// The arguments after the program, as bytes.
    args: Vec<Vec<u8>>,
    cwd: Vec<u8>,
}

pub enum Instance {
    /// This process holds the lock; later launches arrive here.
    Primary(async_channel::Receiver<(Vec<OsString>, PathBuf)>),
    /// Another process holds it and has the launch now.
    Forwarded,
}

fn socket_path(dir: &Path) -> PathBuf {
    dir.join("instance.sock")
}

/// Take the lock in `dir`, or hand `args` and `cwd` to its holder. `None`
/// when no lock can be had (an unwritable directory, a path too long for a
/// socket): the process then runs on its own.
pub fn acquire(dir: &Path, args: &[OsString], cwd: &Path) -> Option<Instance> {
    std::fs::create_dir_all(dir).ok()?;
    let path = socket_path(dir);
    for _ in 0..2 {
        if forward(&path, args, cwd) {
            return Some(Instance::Forwarded);
        }
        // Nobody answers: whatever is there is stale.
        let _ = std::fs::remove_file(&path);
        match UnixListener::bind(&path) {
            Ok(listener) => return Some(Instance::Primary(listen(listener))),
            // Another launch bound it first: hand over to that one.
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(_) => return None,
        }
    }
    None
}

fn forward(path: &Path, args: &[OsString], cwd: &Path) -> bool {
    let Ok(mut stream) = UnixStream::connect(path) else {
        return false;
    };
    // A holder that never answers is treated as gone.
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
    let handoff = Handoff {
        args: args.iter().map(|a| a.as_bytes().to_vec()).collect(),
        cwd: cwd.as_os_str().as_bytes().to_vec(),
    };
    let Ok(mut line) = serde_json::to_vec(&handoff) else {
        return false;
    };
    line.push(b'\n');
    // The holder acknowledges once it has the launch.
    let mut ack = String::new();
    stream.write_all(&line).is_ok()
        && BufReader::new(&stream).read_line(&mut ack).is_ok()
        && ack.trim() == "ok"
}

fn listen(listener: UnixListener) -> async_channel::Receiver<(Vec<OsString>, PathBuf)> {
    let (tx, rx) = async_channel::unbounded();
    std::thread::Builder::new()
        .name("single-instance".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut line = String::new();
                if BufReader::new(&stream).read_line(&mut line).is_err() {
                    continue;
                }
                let Ok(handoff) = serde_json::from_str::<Handoff>(line.trim()) else {
                    continue;
                };
                let args = handoff.args.into_iter().map(OsString::from_vec).collect();
                let cwd = PathBuf::from(OsString::from_vec(handoff.cwd));
                if tx.send_blocking((args, cwd)).is_err() {
                    break;
                }
                let _ = (&stream).write_all(b"ok\n");
            }
        })
        .ok();
    rx
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_later_launch_hands_its_arguments_to_the_first() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = PathBuf::from("/tmp/somewhere");
        let Some(Instance::Primary(rx)) = acquire(dir.path(), &[], &cwd) else {
            panic!("the first launch holds the lock");
        };
        let args = vec![OsString::from("notes.md"), OsString::from("--flag")];
        assert!(matches!(
            acquire(dir.path(), &args, &cwd),
            Some(Instance::Forwarded)
        ));
        assert_eq!(rx.recv_blocking().unwrap(), (args, cwd));
    }

    #[test]
    fn a_socket_left_behind_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        drop(UnixListener::bind(socket_path(dir.path())).unwrap());
        assert!(matches!(
            acquire(dir.path(), &[], Path::new("/")),
            Some(Instance::Primary(_))
        ));
    }
}
