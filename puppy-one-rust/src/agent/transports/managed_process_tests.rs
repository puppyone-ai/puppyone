//! Process ownership is checked against real OS groups and descendants.
use super::managed_agent_process::{create_managed_agent_process, terminate_managed_agent_process};
use crate::agent::application::tests_support::run_local;
use core::prelude::v1::test;
use std::time::Duration;

#[test]
fn a_managed_posix_group_terminates_its_real_descendants_without_signalling_the_parent() {
    run_local(async {
        let directory = tempfile::tempdir().unwrap();
        let child_script = directory.path().join("descendant.sh");
        let parent_script = directory.path().join("parent.sh");
        let ready = directory.path().join("ready");
        let stopped = directory.path().join("stopped");
        std::fs::write(&child_script, "trap 'echo stopped > \"$2\"; exit 0' TERM\necho $$ > \"$1\"\nwhile :; do sleep 0.05; done\n").unwrap();
        std::fs::write(
            &parent_script,
            "trap 'wait; exit 0' TERM\n/bin/sh \"$1\" \"$2\" \"$3\" &\nwait\n",
        )
        .unwrap();
        let mut process = create_managed_agent_process(
            std::path::Path::new("/bin/sh"),
            &[
                parent_script.to_string_lossy().into(),
                child_script.to_string_lossy().into(),
                ready.to_string_lossy().into(),
                stopped.to_string_lossy().into(),
            ],
            directory.path(),
            None,
            None,
        )
        .unwrap();
        let pid = process.pid.unwrap();
        // Ensure an assertion failure cannot leave this test's group alive.
        struct Cleanup(u32);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                terminate_managed_agent_process(Some(self.0), true, true);
            }
        }
        let _cleanup = Cleanup(pid);
        let descendant = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Ok(text) = std::fs::read_to_string(&ready) {
                    if let Ok(pid) = text.trim().parse::<i32>() {
                        break pid;
                    }
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(process.grouped);
        assert_eq!(unsafe { libc::getpgid(pid as i32) }, pid as i32);
        assert_eq!(unsafe { libc::getpgid(descendant) }, pid as i32);
        assert_ne!(unsafe { libc::getpgrp() }, pid as i32);
        assert!(terminate_managed_agent_process(Some(pid), true, false));
        let status = tokio::time::timeout(Duration::from_secs(3), process.child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(status.success(), "{status}");
        assert_eq!(std::fs::read_to_string(&stopped).unwrap(), "stopped\n");
        assert_eq!(unsafe { libc::kill(descendant, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    });
}
