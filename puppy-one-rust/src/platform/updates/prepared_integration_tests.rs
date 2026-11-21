//! Real signed throwaway apps, filesystem swaps and owned relaunch processes.
use super::*;
use std::{
    os::unix::{fs::PermissionsExt, process::ExitStatusExt},
    process::{Child, ExitStatus, Stdio},
    time::{Duration, Instant, SystemTime},
};

const IDENTIFIER: &str = "ai.puppyone.update.integration";

fn original_mtime() -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(946_684_800)
}

struct OwnedChild(Child);
impl OwnedChild {
    fn finish(&mut self) -> ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "owned update process did not exit"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn quit(&mut self) {
        // SAFETY: this PID belongs to the live child held by this guard.
        assert_eq!(
            unsafe { libc::kill(self.0.id() as libc::pid_t, libc::SIGTERM) },
            0
        );
        self.finish();
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct PermissionsGuard(PathBuf, std::fs::Permissions);
impl PermissionsGuard {
    fn read_only(path: &Path) -> Self {
        let permissions = std::fs::metadata(path).unwrap().permissions();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o555)).unwrap();
        Self(path.to_path_buf(), permissions)
    }
}
impl Drop for PermissionsGuard {
    fn drop(&mut self) {
        let _ = std::fs::set_permissions(&self.0, self.1.clone());
    }
}

struct World {
    root: tempfile::TempDir,
    app: PathBuf,
    staging: PathBuf,
}
impl World {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("Applications/Prepared Test.app");
        build_app(&app, "1.0.0", IDENTIFIER, "gpui");
        Self {
            staging: root.path().join("Caches/prepared"),
            root,
            app,
        }
    }

    fn prepared(&self) -> PreparedUpdate {
        PreparedUpdate::new(self.app.clone(), self.staging.clone()).unwrap()
    }

    fn archive(&self, version: &str, identifier: &str, runtime: &str, tamper: bool) -> PathBuf {
        let build = self.root.path().join(format!(
            "build-{version}-{identifier}-{runtime}-{tamper}/Prepared Test.app"
        ));
        build_app(&build, version, identifier, runtime);
        if tamper {
            use std::io::Write as _;
            std::fs::OpenOptions::new()
                .append(true)
                .open(build.join("Contents/Resources/build-info.json"))
                .unwrap()
                .write_all(b" ")
                .unwrap();
        }
        let archive = build.parent().unwrap().with_extension("zip");
        run(
            "/usr/bin/ditto",
            &[
                os("-c"),
                os("-k"),
                os("--keepParent"),
                build.as_os_str(),
                archive.as_os_str(),
            ],
        )
        .unwrap();
        archive
    }

    fn ready(&self) -> PreparedUpdate {
        let mut prepared = self.prepared();
        prepared
            .prepare(&self.archive("2.0.0", IDENTIFIER, "gpui", false), "2.0.0")
            .unwrap();
        prepared
    }

    /// The app's process, owned by the test. The updater acts on the process
    /// id alone: spawning `/bin/sleep` directly stays outside the bundle (so
    /// macOS App Management does not refuse the relaunch's `touch` on a bundle
    /// whose own executable ran) and preserves Apple's platform signature on
    /// arm64e `/bin/sleep` (an ad-hoc re-signed copy of `/bin/sleep` is killed
    /// with `SIGILL` on macOS 15 Apple Silicon).
    fn running(&self) -> OwnedChild {
        OwnedChild(
            Command::new("/bin/sleep")
                .arg("60")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        )
    }

    fn target(&self, child: &OwnedChild, grace_ms: u64) -> RelaunchTarget {
        RelaunchTarget {
            process_id: child.0.id(),
            open: "/usr/bin/touch",
            grace_ms,
        }
    }

    fn version(&self) -> String {
        let info: serde_json::Value = serde_json::from_slice(
            &std::fs::read(self.app.join("Contents/Resources/build-info.json")).unwrap(),
        )
        .unwrap();
        info["version"].as_str().unwrap().into()
    }

    fn opened(&self) -> bool {
        std::fs::metadata(&self.app).unwrap().modified().unwrap() > original_mtime()
    }
}

fn build_app(app: &Path, version: &str, identifier: &str, runtime: &str) {
    let contents = app.join("Contents");
    std::fs::create_dir_all(contents.join("MacOS")).unwrap();
    std::fs::create_dir_all(contents.join("Resources")).unwrap();
    std::fs::copy("/bin/sleep", contents.join("MacOS/prepared-test")).unwrap();
    std::fs::write(contents.join("Info.plist"), format!(r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>{identifier}</string><key>CFBundleExecutable</key><string>prepared-test</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>"#)).unwrap();
    std::fs::write(
        contents.join("Resources/build-info.json"),
        serde_json::json!({"version": version, "runtime": runtime}).to_string(),
    )
    .unwrap();
    let requirement = format!("=designated => identifier \"{IDENTIFIER}\"");
    run(
        "/usr/bin/codesign",
        &[
            os("--force"),
            os("--sign"),
            os("-"),
            os("--requirements"),
            os(&requirement),
            app.as_os_str(),
        ],
    )
    .unwrap();
    std::fs::File::open(app)
        .unwrap()
        .set_modified(original_mtime())
        .unwrap();
}

#[test]
fn verified_swap_reopens_once_after_the_owned_app_exits_and_next_launch_retires_the_backup() {
    let world = World::new();
    let mut old = world.running();
    let target = world.target(&old, 5000);
    let mut prepared = world.ready();
    assert_eq!(world.version(), "1.0.0");
    let started = Instant::now();
    let (installed, helper) = prepared.install(true, &target);
    assert!(installed);
    let mut helper = OwnedChild(helper.unwrap());
    assert!(
        started.elapsed() < Duration::from_millis(200),
        "exit swaps an already prepared app"
    );
    let (again, duplicate) = prepared.install(true, &target);
    assert!(!again && duplicate.is_none());
    assert_eq!(world.version(), "2.0.0");
    std::thread::sleep(Duration::from_millis(300));
    assert!(!world.opened(), "relaunch waits for the old process");
    assert!(old.0.try_wait().unwrap().is_none());
    // SAFETY: query the session of the still-running helper owned above.
    assert_eq!(
        unsafe { libc::getsid(helper.0.id() as libc::pid_t) },
        helper.0.id() as libc::pid_t,
        "relaunch must outlive the parent's process session"
    );
    let exited = Instant::now();
    old.quit();
    assert!(helper.finish().success());
    assert!(exited.elapsed() < Duration::from_secs(1));
    assert!(world.opened());
    let previous = world.staging.join("previous");
    assert_eq!(std::fs::read_dir(&previous).unwrap().count(), 1);
    assert!(previous.join("Prepared Test.app").is_dir());
    world.prepared();
    assert!(!previous.exists());
}

#[test]
fn relaunch_ends_only_the_owned_process_after_its_exit_grace_period() {
    let world = World::new();
    let mut old = world.running();
    let target = world.target(&old, 300);
    let mut prepared = world.ready();
    let started = Instant::now();
    let (installed, helper) = prepared.install(true, &target);
    assert!(installed);
    let mut helper = OwnedChild(helper.unwrap());
    assert_eq!(old.finish().signal(), Some(libc::SIGKILL));
    assert!(helper.finish().success());
    assert!(started.elapsed() >= Duration::from_millis(300));
    assert!(started.elapsed() < Duration::from_millis(1500));
    assert!(world.opened());
    assert_eq!(world.version(), "2.0.0");
    assert!(
        std::fs::read_to_string(PreparedUpdate::beside(&world.staging, ".log"))
            .unwrap()
            .contains("ending it to reopen the update")
    );
}

#[test]
fn ordinary_exit_swaps_without_spawning_a_relaunch_helper() {
    let world = World::new();
    let mut old = world.running();
    let mut prepared = world.ready();
    let (installed, helper) = prepared.install(false, &world.target(&old, 5000));
    assert!(installed && helper.is_none());
    assert_eq!(world.version(), "2.0.0");
    old.quit();
    std::thread::sleep(Duration::from_millis(300));
    assert!(!world.opened());
    assert!(!PreparedUpdate::beside(&world.staging, ".log").exists());
}

#[test]
fn either_failed_rename_preserves_the_old_app_reopens_it_and_disables_future_swaps() {
    for fail_second in [false, true] {
        let world = World::new();
        let mut old = world.running();
        let mut prepared = world.ready();
        let permissions = if fail_second {
            std::fs::remove_dir_all(world.staging.join("next/Prepared Test.app")).unwrap();
            None
        } else {
            Some(PermissionsGuard::read_only(world.app.parent().unwrap()))
        };
        let (installed, helper) = prepared.install(true, &world.target(&old, 5000));
        let mut helper = OwnedChild(helper.unwrap());
        drop(permissions);
        assert!(!installed);
        assert_eq!(world.version(), "1.0.0");
        assert!(!world.opened());
        old.quit();
        assert!(helper.finish().success());
        assert!(world.opened());
        assert!(
            std::fs::read_to_string(PreparedUpdate::failure_marker(&world.staging))
                .unwrap()
                .contains("2.0.0")
        );
        let error = PreparedUpdate::new(world.app.clone(), world.staging.clone())
            .err()
            .unwrap();
        assert!(error.starts_with("A swap failed before"));
        let (again, duplicate) = prepared.install(true, &world.target(&old, 5000));
        assert!(!again && duplicate.is_none());
    }
}

#[test]
fn signature_version_tampering_and_runtime_rejections_never_authorize_a_swap() {
    let world = World::new();
    let mut prepared = world.ready();
    for (identifier, runtime, tamper, expected_version, message) in [
        (
            "ai.puppyone.someone-else",
            "gpui",
            false,
            "2.0.0",
            "not signed as this app is",
        ),
        (IDENTIFIER, "gpui", false, "2.0.1", "instead of 2.0.1"),
        (
            IDENTIFIER,
            "gpui",
            true,
            "2.0.0",
            "not signed as this app is",
        ),
        (IDENTIFIER, "electron", false, "2.0.0", "not a GPUI build"),
    ] {
        let error = prepared
            .prepare(
                &world.archive("2.0.0", identifier, runtime, tamper),
                expected_version,
            )
            .unwrap_err();
        assert!(error.contains(message), "{error}");
        assert!(
            !prepared.install_on_exit(false),
            "failure revokes previous readiness"
        );
        assert_eq!(world.version(), "1.0.0");
    }
}

#[test]
fn an_unwritable_app_or_parent_is_rejected_before_staging_or_signature_work() {
    for parent in [false, true] {
        let world = World::new();
        let _permissions = PermissionsGuard::read_only(if parent {
            world.app.parent().unwrap()
        } else {
            &world.app
        });
        let error = PreparedUpdate::new(world.app.clone(), world.staging.clone())
            .err()
            .unwrap();
        assert!(error.contains("may not be changed by this user"), "{error}");
        assert!(!world.staging.exists());
        assert_eq!(world.version(), "1.0.0");
    }
}
