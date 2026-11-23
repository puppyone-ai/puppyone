//! Process ownership is checked against real OS groups (Unix) and Job Objects (Windows).
use super::managed_agent_process::create_managed_agent_process;
#[cfg(unix)]
use super::managed_agent_process::terminate_managed_agent_process;
use crate::agent::application::tests_support::run_local;
use core::prelude::v1::test;
use std::time::Duration;

#[cfg(unix)]
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
        let pid = process.pid().unwrap();
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
                if let Ok(text) = std::fs::read_to_string(&ready)
                    && let Ok(pid) = text.trim().parse::<i32>()
                {
                    break pid;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(process.grouped());
        assert_eq!(unsafe { libc::getpgid(pid as i32) }, pid as i32);
        assert_eq!(unsafe { libc::getpgid(descendant) }, pid as i32);
        assert_ne!(unsafe { libc::getpgrp() }, pid as i32);
        assert!(process.terminate(false));
        let status = tokio::time::timeout(Duration::from_secs(3), process.child_mut().wait())
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

#[cfg(windows)]
mod windows_tests {
    use super::*;
    use std::net::{TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use tokio::io::AsyncReadExt;

    fn powershell_exe() -> PathBuf {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        Path::new(&root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    #[test]
    fn windows_managed_process_stays_alive_and_terminates_descendants() {
        run_local(async {
            let directory = tempfile::tempdir().unwrap();
            let ready = directory.path().join("port.txt");
            let child_script = directory.path().join("grandchild.ps1");
            let parent_script = directory.path().join("parent.ps1");
            std::fs::write(
                &child_script,
                format!(
                    "$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)\n\
                     $listener.Start()\n\
                     $port = $listener.LocalEndpoint.Port\n\
                     [System.IO.File]::WriteAllText('{}', $port.ToString())\n\
                     Start-Sleep -Seconds 30\n",
                    ready.to_string_lossy().replace('\'', "''")
                ),
            )
            .unwrap();
            std::fs::write(
                &parent_script,
                format!(
                    "Start-Process -FilePath '{}' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','{}') -WindowStyle Hidden\n\
                     Start-Sleep -Seconds 30\n",
                    powershell_exe().to_string_lossy().replace('\'', "''"),
                    child_script.to_string_lossy().replace('\'', "''")
                ),
            )
            .unwrap();
            let mut process = create_managed_agent_process(
                &powershell_exe(),
                &[
                    "-NoProfile".into(),
                    "-ExecutionPolicy".into(),
                    "Bypass".into(),
                    "-File".into(),
                    parent_script.to_string_lossy().into(),
                ],
                directory.path(),
                None,
                None,
            )
            .unwrap();
            assert!(process.grouped());
            assert!(process.pid().is_some());
            let port: u16 = tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    if let Ok(text) = std::fs::read_to_string(&ready)
                        && let Ok(port) = text.trim().parse::<u16>()
                    {
                        break port;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            assert!(
                TcpStream::connect(("127.0.0.1", port)).is_ok(),
                "descendant must remain reachable while ManagedAgentProcess is held"
            );
            assert!(process.terminate(false));
            let _status = tokio::time::timeout(Duration::from_secs(5), process.child_mut().wait())
                .await
                .unwrap()
                .unwrap();
            let released = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if TcpListener::bind(("127.0.0.1", port)).is_ok() {
                        break true;
                    }
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .unwrap_or(false);
            assert!(
                released,
                "ManagedAgentProcess::terminate must reap Windows descendants"
            );
        });
    }

    #[test]
    fn windows_managed_process_launches_batch_wrapper_with_spaces_in_path_and_args() {
        run_local(async {
            let directory = tempfile::tempdir().unwrap();
            let nested = directory.path().join("space dir");
            std::fs::create_dir_all(&nested).unwrap();
            let script = nested.join("agent wrapper.cmd");
            std::fs::write(&script, "@echo off\r\necho [%~1][%~2]\r\n").unwrap();
            let parts = create_managed_agent_process(
                &script,
                &["--listen".into(), "stdio:// value".into()],
                directory.path(),
                None,
                None,
            )
            .unwrap()
            .into_parts();
            let mut child = parts.child;
            let _subtree = parts.subtree;
            let mut stdout = child.stdout.take().unwrap();
            let mut output = String::new();
            stdout.read_to_string(&mut output).await.unwrap();
            let status = tokio::time::timeout(Duration::from_secs(5), child.wait())
                .await
                .unwrap()
                .unwrap();
            assert!(status.success(), "{status}");
            assert_eq!(output.trim(), "[--listen][stdio:// value]");
        });
    }
}
