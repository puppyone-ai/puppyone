use crate::platform::terminal::{
    Event, LaunchCommand, PTY_TEST_LOCK, PreparedLaunch, Terminal, write_bootstrap,
};
use crate::wake::Wake;
use core::prelude::v1::test;
use std::{
    io::{self, Write},
    sync::mpsc,
    time::Duration,
};
struct FailedWriter {
    flush: bool,
}
impl Write for FailedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.flush {
            Ok(bytes.len())
        } else {
            Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "private diagnostic",
            ))
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "private diagnostic",
        ))
    }
}
#[test]
fn a_failed_bootstrap_write_or_flush_waits_for_the_real_shell_and_releases_its_session() {
    let _exclusive = PTY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    for flush in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let owner = format!("bootstrap-failure-{}", uuid::Uuid::new_v4());
        let check_owner = owner.clone();
        let (child_tx, child_rx) = mpsc::channel();
        let terminal = Terminal::spawn_with_bootstrap_writer(
            directory.path().into(),
            "shell",
            Wake::default(),
            owner.clone(),
            || {
                Ok(PreparedLaunch {
                    command: Some(LaunchCommand {
                        executable: "/bin/sh".into(),
                        arguments: vec!["-i".into()],
                        environment: vec![],
                    }),
                    bootstrap: Some("'must-not-execute'\r".into()),
                    replace_environment: false,
                })
            },
            move |_, input| {
                let row = crate::platform::host_budget::Budget::global()
                    .snapshot()
                    .into_iter()
                    .find(|r| r.owner == check_owner)
                    .unwrap();
                child_tx
                    .send(row.pid.expect("host already started"))
                    .unwrap();
                write_bootstrap(&mut FailedWriter { flush }, input)
            },
        );
        let pid = child_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            match terminal
                .events
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .unwrap()
            {
                Event::Data(_) => (),
                Event::Exit(_) => panic!("bootstrap failure must be reported"),
                Event::Error(error) => {
                    assert_eq!(error, "TERMINAL_AGENT_START_FAILED");
                    break;
                }
            }
        }
        // Error publication is after child.wait and lease release, not a timed guess.
        assert_eq!(
            unsafe { libc::kill(pid as i32, 0) },
            -1,
            "shell survived bootstrap failure"
        );
        assert!(
            !crate::platform::host_budget::Budget::global()
                .snapshot()
                .iter()
                .any(|r| r.owner == owner)
        );
        drop(terminal);
    }
}
