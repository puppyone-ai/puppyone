use super::*;
use crate::agent::application::tests_support::{installed_shell_fixture, run_local};
use crate::agent::tasks::Canceller;
use std::path::Path;

async fn started_probe(
    pid_file: &Path,
    close_output: bool,
    signal: CancelSignal,
) -> (i32, tokio::task::JoinHandle<AgentResult<ProbeResult>>) {
    // Use the installed system interpreter: this test measures the running
    // process lifecycle, independently of a fresh executable's host admission.
    let args = vec![
        "-c".into(),
        format!(
            "{}printf '%s' $$ > \"$1\"; exec /bin/sleep 60",
            if close_output { "exec 1>&- 2>&-; " } else { "" }
        ),
        "probe-fixture".into(),
        pid_file.to_string_lossy().into_owned(),
    ];
    let task = tokio::task::spawn_local(async move {
        run_bounded_process_probe(
            "/bin/sh",
            &args,
            ProbeOptions {
                timeout_ms: 4_000,
                signal: Some(signal),
                ..Default::default()
            },
        )
        .await
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    let pid = loop {
        if let Ok(text) = std::fs::read_to_string(pid_file)
            && let Ok(pid) = text.parse::<i32>()
        {
            break pid;
        }
        assert!(
            !task.is_finished(),
            "probe exited before its readiness marker"
        );
        assert!(std::time::Instant::now() < deadline, "probe never started");
        tokio::time::sleep(Duration::from_millis(5)).await;
    };
    assert!(pid > 0);
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0, "owned child must be live");
    (pid, task)
}

fn assert_reaped(pid: i32) {
    assert_eq!(
        unsafe { libc::kill(pid, 0) },
        -1,
        "owned child still exists"
    );
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
}

#[test]
fn the_probe_deadline_reaps_a_running_child_before_or_after_output_eof() {
    for close_output in [false, true] {
        run_local(async {
            let directory = tempfile::tempdir().unwrap();
            let (pid, task) = started_probe(
                &directory.path().join("pid"),
                close_output,
                Canceller::new().signal(),
            )
            .await;
            assert!(!task.is_finished());
            // The real child has acknowledged startup. Only now advance the
            // production deadline; no slow machine needs to win a 4s race.
            tokio::time::pause();
            tokio::time::advance(Duration::from_secs(4)).await;
            let error = task.await.unwrap().unwrap_err();
            assert_eq!(error.message, "Desktop process probe timed out.");
            assert_reaped(pid);
        });
    }
}

#[test]
fn cancelling_a_probe_reaps_the_running_child_before_or_after_output_eof() {
    for close_output in [false, true] {
        run_local(async {
            let directory = tempfile::tempdir().unwrap();
            let cancel = Canceller::new();
            let (pid, task) =
                started_probe(&directory.path().join("pid"), close_output, cancel.signal()).await;
            cancel.cancel(AgentError::new("test owner closed"));
            let error = task.await.unwrap().unwrap_err();
            assert_eq!(error.message, "Desktop process probe was cancelled.");
            assert_reaped(pid);
        });
    }
}

#[test]
fn installed_probe_preparation_preserves_actual_arguments_environment_and_side_effects() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("installed agent");
        let marker = directory.path().join("called");
        installed_shell_fixture(
            &script,
            "#!/bin/sh\nprintf '%s\\n' \"$1\" \"$2\" \"$PROBE_VALUE\" > called\nprintf '工具 ready\\n'\nprintf 'diagnostic' >&2\nexit 7\n",
        );
        assert!(
            !marker.exists(),
            "preparation must not execute the fixture body"
        );
        let result = run_bounded_process_probe(
            script.to_str().unwrap(),
            &["--version".into(), "literal $HOME; '空间'".into()],
            ProbeOptions {
                cwd: Some(directory.path().to_path_buf()),
                env: Some(EnvMap::from([(
                    "PROBE_VALUE".into(),
                    "scoped value".into(),
                )])),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(result.code, Some(7));
        assert_eq!(result.stdout, "工具 ready\n");
        assert_eq!(result.stderr, "diagnostic");
        assert_eq!(
            std::fs::read_to_string(marker).unwrap(),
            "--version\nliteral $HOME; '空间'\nscoped value\n"
        );
    });
}
