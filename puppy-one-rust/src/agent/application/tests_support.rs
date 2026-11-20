//! Async test runners on the Agent host's single-threaded runtime.
use std::future::Future;

/// One async test with a paused clock (`vi.useFakeTimers()`).
pub fn run_paused_local<F: Future>(future: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .expect("test runtime");
    tokio::task::LocalSet::new().block_on(&runtime, future)
}

/// One async test on a real clock.
pub fn run_local<F: Future>(future: F) -> F::Output {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime");
    tokio::task::LocalSet::new().block_on(&runtime, future)
}

/// Prepare a real installed shell fixture before measuring its probe budget.
/// A newly written executable may spend seconds in the host loader on its first
/// exec, even when its entire body is `echo`. The private preparation argument
/// exits before the fixture body, so no version/help/status calls or side effects
/// are consumed. Actual probes still use the production runner and deadlines.
#[cfg(unix)]
pub fn installed_shell_fixture(path: &std::path::Path, script: &str) {
    use std::os::unix::fs::PermissionsExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let body = script
        .strip_prefix("#!/bin/sh\n")
        .expect("shell fixture shebang");
    std::fs::create_dir_all(path.parent().expect("fixture parent")).unwrap();
    std::fs::write(
        path,
        format!("#!/bin/sh\nif [ \"$1\" = --puppyone-fixture-ready ]; then exit 0; fi\n{body}"),
    )
    .unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut child = Command::new(path)
        .arg("--puppyone-fixture-ready")
        .current_dir(path.parent().expect("fixture parent"))
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("start fixture preparation");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                assert!(status.success(), "fixture preparation failed: {status}");
                break;
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("fixture preparation did not finish: {result:?}");
            }
        }
    }
}
