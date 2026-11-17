use super::*;
use std::{
    fs,
    net::{TcpListener, TcpStream},
    sync::mpsc,
};

const CANCELLED: &str = "Command cancelled, timed out, or exceeded its output limit";

fn fixture(directory: &Path, name: &str, body: &str) -> std::path::PathBuf {
    let file = directory.join(name);
    fs::write(&file, body).unwrap();
    file
}
fn wait_file(path: &Path) -> String {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(value) = fs::read_to_string(path)
            && !value.is_empty()
        {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "process fixture did not announce readiness"
        );
        thread::sleep(Duration::from_millis(2));
    }
}
fn kill_owned_group(pid: i32) {
    // Tests only use PIDs announced by their own isolated fixture; always clean
    // up even on RED, before asserting that cancellation/deadline had worked.
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
    }
}
#[test]
fn precancellation_is_observed_before_executable_or_working_directory_lookup() {
    let directory = tempfile::tempdir().unwrap();
    let result = run(
        &directory.path().join("does-not-exist"),
        &[],
        &directory.path().join("also-missing"),
        None,
        Duration::from_secs(1),
        &AtomicBool::new(true),
    );
    assert_eq!(result, Err(CANCELLED.into()));
}
#[test]
fn stdin_backpressure_cannot_disable_the_process_deadline() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().to_path_buf();
    let pid_file = root.join("pid");
    let script = fixture(
        &root,
        "blocked.sh",
        "printf '%s' \"$$\" > pid\nexec /bin/sleep 30\n",
    );
    let (sent, received) = mpsc::channel();
    let worker = thread::spawn(move || {
        let data = vec![b'x'; 2 * 1024 * 1024];
        sent.send(run(
            Path::new("/bin/sh"),
            &[script.to_str().unwrap()],
            &root,
            Some(&data),
            Duration::from_millis(80),
            &AtomicBool::new(false),
        ))
        .unwrap();
    });
    let pid = wait_file(&pid_file).parse::<i32>().unwrap();
    let acknowledged = received.recv_timeout(Duration::from_secs(2));
    kill_owned_group(pid);
    worker.join().unwrap();
    assert_eq!(
        acknowledged.expect("stdin blocked the deadline"),
        Err(CANCELLED.into())
    );
}
#[test]
fn stdout_is_drained_while_large_stdin_is_still_being_written() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().to_path_buf();
    let pid_file = root.join("pid");
    let script = fixture(
        &root,
        "duplex.sh",
        "printf '%s' \"$$\" > pid\n/bin/dd if=/dev/zero bs=65536 count=32 2>/dev/null\n/bin/cat >/dev/null\nprintf 'done'\n",
    );
    let (sent, received) = mpsc::channel();
    let worker = thread::spawn(move || {
        let data = vec![b'x'; 2 * 1024 * 1024];
        sent.send(run(
            Path::new("/bin/sh"),
            &[script.to_str().unwrap()],
            &root,
            Some(&data),
            Duration::from_secs(3),
            &AtomicBool::new(false),
        ))
        .unwrap();
    });
    let pid = wait_file(&pid_file).parse::<i32>().unwrap();
    let acknowledged = received.recv_timeout(Duration::from_secs(5));
    kill_owned_group(pid);
    worker.join().unwrap();
    let output = acknowledged
        .expect("stdout and stdin blocked one another")
        .unwrap();
    assert_eq!(output.len(), 2 * 1024 * 1024 + 4);
    assert!(output.ends_with(b"done"));
}
#[test]
fn cancellation_after_parent_exit_reaps_pipe_holding_descendants_and_preserves_unrelated_servers() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().to_path_buf();
    let receipt = root.join("children");
    let script = fixture(
        &root,
        "descendant.py",
        r#"import os, signal, socket, time
listener = socket.socket()
listener.bind(('127.0.0.1', 0))
listener.listen()
child = os.fork()
if child == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while True:
        time.sleep(30)
else:
    with open('children', 'w') as output:
        output.write('%d %d %d' % (os.getpid(), child, listener.getsockname()[1]))
    print('parent output', flush=True)
    os._exit(0)
"#,
    );
    let unrelated = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancel.clone();
    let (sent, received) = mpsc::channel();
    let worker = thread::spawn(move || {
        sent.send(run(
            Path::new("/usr/bin/python3"),
            &[script.to_str().unwrap()],
            &root,
            None,
            Duration::from_secs(10),
            &worker_cancel,
        ))
        .unwrap();
    });
    let ids: Vec<i32> = wait_file(&receipt)
        .split_whitespace()
        .map(|v| v.parse().unwrap())
        .collect();
    let parent = ids[0];
    let deadline = Instant::now() + Duration::from_secs(5);
    while unsafe { libc::kill(parent, 0) } == 0 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(2));
    }
    let reaped = unsafe { libc::kill(parent, 0) } != 0;
    cancel.store(true, Ordering::SeqCst);
    let acknowledged = received.recv_timeout(Duration::from_secs(2));
    // Observe cleanup BEFORE the fixture's emergency cleanup, otherwise that
    // cleanup could conceal a leaked server in the production implementation.
    let released = TcpListener::bind(("127.0.0.1", ids[2] as u16));
    let unrelated_alive = TcpStream::connect(unrelated.local_addr().unwrap()).is_ok();
    kill_owned_group(parent);
    worker.join().unwrap();
    assert!(
        reaped,
        "test must cancel after the real parent has been reaped"
    );
    assert_eq!(
        acknowledged.expect("a descendant-held pipe disabled cancellation"),
        Err(CANCELLED.into())
    );
    assert!(released.is_ok(), "owned server port was not released");
    assert!(unrelated_alive);
}

#[test]
fn output_limits_stop_and_reap_the_actual_child_on_both_streams() {
    for (stream, limit) in [(1, 8 * 1024 * 1024), (2, 256 * 1024)] {
        let directory = tempfile::tempdir().unwrap();
        let script = fixture(
            directory.path(),
            "overflow.py",
            &format!(
                "import os, time\nwith open('pid', 'w') as f: f.write(str(os.getpid()))\ndata = b'x' * 8192\nfor _ in range({}): os.write({stream}, data)\ntime.sleep(30)\n",
                limit / 8192 + 1
            ),
        );
        let started = Instant::now();
        let result = run(
            Path::new("/usr/bin/python3"),
            &[script.to_str().unwrap()],
            directory.path(),
            None,
            Duration::from_secs(5),
            &AtomicBool::new(false),
        );
        let elapsed = started.elapsed();
        let pid = wait_file(&directory.path().join("pid"))
            .parse::<i32>()
            .unwrap();
        let reaped = unsafe { libc::kill(pid, 0) } != 0;
        kill_owned_group(pid);
        assert_eq!(result, Err(CANCELLED.into()));
        assert!(
            elapsed < Duration::from_secs(2),
            "output limit must precede timeout"
        );
        assert!(
            reaped,
            "overflowing process must be reaped before returning"
        );
    }
}

#[test]
fn output_at_each_limit_is_preserved_without_truncation() {
    let directory = tempfile::tempdir().unwrap();
    for (stream, limit, exit_code) in [(1, 8 * 1024 * 1024, 0), (2, 256 * 1024, 7)] {
        let script = format!(
            "import os\ndata = b'x' * 8192\nfor _ in range({}): os.write({stream}, data)\nos._exit({exit_code})",
            limit / 8192
        );
        let result = run(
            Path::new("/usr/bin/python3"),
            &["-c", &script],
            directory.path(),
            None,
            Duration::from_secs(5),
            &AtomicBool::new(false),
        );
        if exit_code == 0 {
            assert_eq!(result.unwrap(), vec![b'x'; limit]);
        } else {
            assert_eq!(result.unwrap_err(), "x".repeat(limit));
        }
    }
}

#[test]
fn successful_input_closes_stdin_and_preserves_cwd_and_noninteractive_environment() {
    let directory = tempfile::tempdir().unwrap();
    let output = run(
        Path::new("/bin/sh"),
        &["-c", "cat > payload; printf '%s|%s|%s' \"$LC_ALL\" \"$GIT_TERMINAL_PROMPT\" \"$GIT_OPTIONAL_LOCKS\""],
        directory.path(),
        Some(b"literal stdin\0with newline\n"),
        Duration::from_secs(2),
        &AtomicBool::new(false),
    ).unwrap();
    let inherited = std::env::var("GIT_OPTIONAL_LOCKS").unwrap_or_default();
    assert_eq!(output, format!("C|0|{inherited}").as_bytes());
    assert_eq!(
        fs::read(directory.path().join("payload")).unwrap(),
        b"literal stdin\0with newline\n"
    );
}

#[test]
fn failed_exit_prefers_trimmed_stderr_then_stdout_and_preserves_invalid_utf8_lossily() {
    let directory = tempfile::tempdir().unwrap();
    for (script, expected) in [
        (
            "printf ' ignored '; printf ' error\\n' >&2; exit 7",
            "error",
        ),
        (
            "printf ' fallback\\n'; printf ' \\n' >&2; exit 1",
            "fallback",
        ),
        ("printf '\\377bad' >&2; exit 1", "\u{fffd}bad"),
    ] {
        assert_eq!(
            run(
                Path::new("/bin/sh"),
                &["-c", script],
                directory.path(),
                None,
                Duration::from_secs(2),
                &AtomicBool::new(false)
            ),
            Err(expected.into())
        );
    }
}

#[test]
fn precancelled_and_zero_deadline_commands_never_create_launch_side_effects() {
    let directory = tempfile::tempdir().unwrap();
    for (cancel, timeout) in [(true, Duration::from_secs(2)), (false, Duration::ZERO)] {
        let result = run(
            Path::new("/bin/sh"),
            &["-c", "touch launched"],
            directory.path(),
            None,
            timeout,
            &AtomicBool::new(cancel),
        );
        assert_eq!(result, Err(CANCELLED.into()));
        assert!(!directory.path().join("launched").exists());
    }
}
