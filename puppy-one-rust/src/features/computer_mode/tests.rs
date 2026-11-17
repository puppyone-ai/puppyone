use super::*;
use core::prelude::v1::test;
use gpui::TestAppContext;
use std::time::Duration;

/// An engine that answers at once and remembers what it was asked.
#[derive(Default)]
struct Engine(Mutex<Vec<String>>);
impl Limactl for Engine {
    fn run(&self, args: &[&str], _: Duration) -> Result<(), String> {
        self.0.lock().unwrap().push(args[0].to_owned());
        Ok(())
    }
}

fn computers(
    cx: &mut TestAppContext,
    engine: Option<Arc<dyn Limactl>>,
) -> (
    Entity<PreferencesStore>,
    Entity<LocalComputers>,
    tempfile::TempDir,
) {
    let dir = tempfile::tempdir().unwrap();
    let registry = dir.path().join("registry");
    let (preferences, computers) = cx.update(|cx| {
        let preferences = cx.new(|_| PreferencesStore::memory());
        preferences.update(cx, |p, cx| {
            p.change(|p| p.experimental.computer_mode = true, cx)
        });
        let computers = install_fixture(registry, engine, &preferences, cx);
        (preferences, computers)
    });
    (preferences, computers, dir)
}

fn record(computers: &Entity<LocalComputers>, cx: &mut TestAppContext) -> Record {
    computers.read_with(cx, |c, _| c.computers()[0].clone())
}

/// A workspace registered with Computer Mode on runs; turning the mode off
/// puts it to sleep, its folder untouched.
#[gpui::test]
fn turning_computer_mode_off_puts_every_computer_to_sleep(cx: &mut TestAppContext) {
    let (preferences, computers, dir) = computers(cx, None);
    let workspace = dir.path().join("Lab");
    std::fs::create_dir(&workspace).unwrap();
    computers.update(cx, |c, cx| c.register(&workspace, Some("Lab"), cx));
    let lab = record(&computers, cx);
    assert_eq!((lab.name.as_str(), lab.status), ("Lab", Status::Running));
    computers.read_with(cx, |c, _| {
        assert_eq!(c.for_path(&workspace).map(|r| r.id), Some(lab.id.clone()));
        // No engine here: a workspace, with nothing to start.
        assert_eq!(c.screen(&lab), Screen::Workspace { can_start: false });
    });
    cx.update(|cx| {
        preferences.update(cx, |p, cx| {
            p.change(|p| p.experimental.computer_mode = false, cx)
        })
    });
    cx.run_until_parked();
    assert_eq!(record(&computers, cx).status, Status::Asleep);
    assert!(workspace.is_dir());
}

/// With Lima, a computer's desktop is provisioned on a loopback port; it
/// sleeps (its instance stopped) and wakes (started again) on request.
#[gpui::test]
fn a_desktop_is_provisioned_put_to_sleep_and_woken(cx: &mut TestAppContext) {
    let engine = Arc::new(Engine::default());
    let (_, computers, dir) = computers(cx, Some(engine.clone()));
    computers.update(cx, |c, cx| c.register(dir.path(), None, cx));
    let id = record(&computers, cx).id;
    computers.read_with(cx, |c, _| {
        assert_eq!(
            c.screen(&c.computers()[0]),
            Screen::Workspace { can_start: true }
        )
    });
    computers.update(cx, |c, cx| c.provision_desktop(&id, cx));
    assert_eq!(record(&computers, cx).status, Status::Provisioning);
    computers.read_with(cx, |c, _| {
        assert_eq!(c.screen(&c.computers()[0]), Screen::Starting);
    });
    cx.run_until_parked();
    let ready = record(&computers, cx);
    assert!(ready.desktop_ready && ready.status == Status::Running);
    let port = ready.vnc_port.unwrap();
    computers.read_with(cx, |c, _| {
        assert_eq!(c.screen(&ready), Screen::Desktop { port })
    });
    computers.update(cx, |c, cx| c.sleep(&id, cx));
    cx.run_until_parked();
    assert_eq!(record(&computers, cx).status, Status::Asleep);
    computers.read_with(cx, |c, _| {
        assert_eq!(c.screen(&c.computers()[0]), Screen::Asleep)
    });
    computers.update(cx, |c, cx| c.wake(&id, cx));
    cx.run_until_parked();
    assert_eq!(record(&computers, cx).status, Status::Running);
    assert_eq!(*engine.0.lock().unwrap(), ["start", "stop", "start"]);
}

/// Without Lima a desktop cannot start; the computer says why and runs on.
#[gpui::test]
fn without_the_engine_a_computer_stays_a_workspace(cx: &mut TestAppContext) {
    let (_, computers, dir) = computers(cx, None);
    computers.update(cx, |c, cx| c.register(dir.path(), None, cx));
    let id = record(&computers, cx).id;
    computers.update(cx, |c, cx| c.provision_desktop(&id, cx));
    let after = record(&computers, cx);
    assert_eq!(after.status, Status::Running);
    assert!(!after.desktop_ready);
    assert_eq!(after.status_detail.as_deref(), Some("limactl-unavailable"));
}
