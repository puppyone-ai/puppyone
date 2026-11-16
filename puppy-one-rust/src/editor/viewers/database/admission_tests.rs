#![cfg(test)]
use super::*;
use crate::workspace::Workspace;
use crate::workspace::{contracts::*, ports::*, testing::Memory};
use core::prelude::v1::test;
use std::{
    cell::Cell,
    io::Cursor,
    path::Path,
    rc::Rc,
    sync::{Condvar, atomic::AtomicUsize},
    time::{Duration, Instant},
};

fn fixture(path: &Path, value: &str) {
    let db = rusqlite::Connection::open(path).unwrap();
    db.execute_batch("CREATE TABLE items (value TEXT)").unwrap();
    db.execute("INSERT INTO items VALUES (?1)", [value])
        .unwrap();
}
fn settle(view: &Entity<DatabaseView>, cx: &mut VisualTestContext) {
    until(cx, |cx| !view.read_with(cx, |view, _| view.busy));
}
fn until(cx: &mut VisualTestContext, mut ready: impl FnMut(&mut VisualTestContext) -> bool) {
    let until = Instant::now() + Duration::from_secs(5);
    while !ready(cx) {
        cx.run_until_parked();
        assert!(Instant::now() < until, "database did not settle");
        std::thread::yield_now();
    }
}

/// Blocks the first real provider read, allowing races to be ordered without
/// assuming a worker completes within a sleep or an executor tick.
#[derive(Default)]
struct Gate {
    entered: AtomicBool,
    released: Mutex<bool>,
    wake: Condvar,
    drops: AtomicUsize,
    timed_out: AtomicBool,
    block_validation: AtomicBool,
}
impl Gate {
    fn release(&self) {
        *self.released.lock().unwrap() = true;
        self.wake.notify_all();
    }
    fn arm_validation(&self) {
        *self.released.lock().unwrap() = false;
        self.entered.store(false, Ordering::Release);
        self.block_validation.store(true, Ordering::Release);
    }
    fn wait(&self) -> std::io::Result<()> {
        if !self.entered.swap(true, Ordering::AcqRel) {
            let (released, waited) = self
                .wake
                .wait_timeout_while(
                    self.released.lock().unwrap(),
                    Duration::from_secs(5),
                    |released| !*released,
                )
                .unwrap();
            if waited.timed_out() && !*released {
                self.timed_out.store(true, Ordering::Release);
                return Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "test gate",
                ));
            }
        }
        Ok(())
    }
}
struct GatedReader {
    bytes: Cursor<Arc<[u8]>>,
    gate: Arc<Gate>,
}
impl std::io::Read for GatedReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        self.gate.wait()?;
        self.bytes.read(output)
    }
}
impl std::io::Seek for GatedReader {
    fn seek(&mut self, offset: std::io::SeekFrom) -> std::io::Result<u64> {
        self.bytes.seek(offset)
    }
}
impl Drop for GatedReader {
    fn drop(&mut self) {
        self.gate.drops.fetch_add(1, Ordering::AcqRel);
    }
}
struct Provider {
    memory: Memory,
    bytes: Arc<[u8]>,
    gate: Arc<Gate>,
}
impl DataPort for Provider {
    fn descriptor(&self) -> Descriptor {
        self.memory.descriptor()
    }
    fn list(&self, path: &RelativePath) -> crate::workspace::Result<Vec<Entry>> {
        self.memory.list(path)
    }
}
impl DocumentStoragePort for Provider {
    fn read(&self, path: &RelativePath) -> crate::workspace::Result<TextSnapshot> {
        self.memory.read(path)
    }
    fn write(
        &self,
        path: &RelativePath,
        revision: &Revision,
        text: &str,
    ) -> crate::workspace::Result<WriteResult> {
        self.memory.write(path, revision, text)
    }
}
impl ResourcePort for Provider {
    fn preview(&self, _: &RelativePath) -> crate::workspace::Result<PreviewData> {
        Ok(PreviewData::LocalFile(
            "/nonexistent/display-only.db".into(),
        ))
    }
    fn preview_session_reader(&self, _: &RelativePath) -> SessionReadResult<SessionReader> {
        let gate = self.gate.clone();
        Ok(SessionReader {
            source: ResourceReader {
                length: self.bytes.len() as u64,
                reader: Box::new(GatedReader {
                    bytes: Cursor::new(self.bytes.clone()),
                    gate: self.gate.clone(),
                }),
            },
            validate: Arc::new(move || {
                if gate.block_validation.swap(false, Ordering::AcqRel) {
                    gate.wait()
                        .map_err(|_| Error::new(ErrorKind::Io, "test gate expired"))?;
                }
                Ok(())
            }),
        })
    }
}
impl ResourceWatchPort for Provider {
    fn watch(
        &self,
        _: &RelativePath,
        _: &Revision,
        _: Notify,
    ) -> crate::workspace::Result<WatchSubscription> {
        Err(Error::unsupported())
    }
}
fn bytes(value: &str) -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.db");
    fixture(&path, value);
    std::fs::read(path).unwrap()
}
fn gated(value: &str) -> (Arc<Workspace>, Arc<Gate>) {
    gated_bytes(bytes(value))
}
fn gated_bytes(bytes: Vec<u8>) -> (Arc<Workspace>, Arc<Gate>) {
    let gate = Arc::new(Gate::default());
    let provider = Arc::new(Provider {
        memory: Memory::new("memory://database-lifecycle/"),
        bytes: bytes.into(),
        gate: gate.clone(),
    });
    (Workspace::from_provider(provider).unwrap(), gate)
}
fn hosted(value: &str) -> PreviewResource {
    let provider = Arc::new(crate::workspace::testing::Resources::default());
    provider
        .bytes
        .lock()
        .unwrap()
        .insert("fixture.db".into(), bytes(value));
    Workspace::from_provider(provider)
        .unwrap()
        .resource(Path::new("fixture.db"))
        .unwrap()
}

#[gpui::test]
fn rebinding_during_a_provider_read_cancels_and_drops_the_old_session_without_replacing_the_new_page(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let (ws, gate) = gated("old");
    let resource = ws.resource(Path::new("fixture.db")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = DatabaseView::new(Some(resource), false, Scale::default());
        v.reload(cx);
        v
    });
    until(cx, |_| gate.entered.load(Ordering::Acquire));
    view.read_with(cx, |v, _| assert!(v.busy && v.page.is_none()));
    assert_eq!(gate.drops.load(Ordering::Acquire), 0);
    let cancel = view.read_with(cx, |v, _| v.cancel.clone());
    let new = hosted("current");
    cx.update(|_, cx| DatabaseSurface { view: view.clone() }.rebind_resource(&new, cx));
    assert!(cancel.load(Ordering::Acquire));
    settle(&view, cx);
    let previous = view.read_with(cx, |v, _| Arc::downgrade(v.session.as_ref().unwrap()));
    // Return to A with a new allocation before the first A finishes.
    let new = hosted("current A");
    cx.update(|_, cx| DatabaseSurface { view: view.clone() }.rebind_resource(&new, cx));
    settle(&view, cx);
    assert!(previous.upgrade().is_none());
    gate.release();
    until(cx, |_| gate.drops.load(Ordering::Acquire) == 1);
    assert!(!gate.timed_out.load(Ordering::Acquire));
    cx.run_until_parked();
    view.read_with(cx, |v, _| {
        assert_eq!(v.failure, None);
        assert_eq!(v.resource.as_ref(), Some(&new));
        assert_eq!(v.page.as_ref().unwrap().rows[0][0].text, "current A");
    });
}

#[gpui::test]
fn revoked_pending_and_cached_database_sessions_clear_rows_and_drop_the_reader(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    for pending in [true, false] {
        let (ws, gate) = gated("private");
        if !pending {
            gate.release();
        }
        let resource = ws.resource(Path::new("fixture.db")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut v = DatabaseView::new(Some(resource), false, Scale::default());
            v.reload(cx);
            v
        });
        until(cx, |_| gate.entered.load(Ordering::Acquire));
        if !pending {
            settle(&view, cx);
        }
        let cancel = view.read_with(cx, |v, _| v.cancel.clone());
        ws.revoke();
        cx.update(|window, cx| {
            let _ = window.draw(cx);
        });
        gate.release();
        until(cx, |_| gate.drops.load(Ordering::Acquire) == 1);
        assert!(!gate.timed_out.load(Ordering::Acquire));
        cx.run_until_parked();
        view.read_with(cx, |v, _| {
            assert!(cancel.load(Ordering::Acquire));
            assert_eq!(v.failure, Some(Failure::Permission));
            assert!(v.page.is_none() && v.objects.is_none() && v.session.is_none());
            assert!(!v.busy);
        });
    }
}

#[gpui::test]
fn closing_a_database_preview_cancels_pending_work_and_releases_open_cached_sessions(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    for pending in [true, false] {
        let (ws, gate) = gated("private");
        if !pending {
            gate.release();
        }
        let resource = ws.resource(Path::new("fixture.db")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut v = DatabaseView::new(Some(resource), false, Scale::default());
            v.reload(cx);
            v
        });
        until(cx, |_| gate.entered.load(Ordering::Acquire));
        if !pending {
            settle(&view, cx);
        }
        let cancel = view.read_with(cx, |v, _| v.cancel.clone());
        let weak = view.downgrade();
        cx.update(|window, _| window.remove_window());
        drop(view);
        cx.cx.update(|_| {});
        cx.run_until_parked();
        assert!(weak.upgrade().is_none());
        assert!(cancel.load(Ordering::Acquire));
        gate.release();
        until(cx, |_| gate.drops.load(Ordering::Acquire) == 1);
        assert!(!gate.timed_out.load(Ordering::Acquire));
    }
}

#[gpui::test]
fn database_retry_and_reload_clicks_request_fresh_input_and_display_the_rebound_snapshot(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("fixture.db"), b"broken database").unwrap();
    let ws = Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("fixture.db")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = DatabaseView::new(Some(resource), false, Scale::default());
        v.reload(cx);
        v
    });
    let retries = Rc::new(Cell::new(0));
    let count = retries.clone();
    let _subscription = cx.update(|_, cx| {
        DatabaseSurface { view: view.clone() }.subscribe(
            Rc::new(move |event, _| {
                if matches!(event, SurfaceEvent::RetryInput) {
                    count.set(count.get() + 1);
                }
            }),
            cx,
        )
    });
    settle(&view, cx);
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    let retry = cx.debug_bounds("database-retry").unwrap();
    cx.simulate_click(retry.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(retries.get(), 1);
    let new = hosted("fresh snapshot");
    cx.update(|_, cx| DatabaseSurface { view: view.clone() }.rebind_resource(&new, cx));
    settle(&view, cx);
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    assert!(cx.debug_bounds("database-retry").is_none());
    view.read_with(cx, |v, _| {
        assert_eq!(v.page.as_ref().unwrap().rows[0][0].text, "fresh snapshot")
    });
    let reload = cx.debug_bounds("database-reload").unwrap();
    cx.simulate_click(reload.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(retries.get(), 2);
}

#[gpui::test]
fn database_queries_use_the_admitted_provider_root_after_the_display_path_is_replaced(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    fixture(&root.join("example.db"), "authorized");
    let ws = Workspace::open(&root).unwrap();
    let resource = ws.resource(Path::new("example.db")).unwrap();
    std::fs::rename(&root, temp.path().join("admitted")).unwrap();
    std::fs::create_dir(&root).unwrap();
    fixture(&root.join("example.db"), "foreign");
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut view = DatabaseView::new(Some(resource), false, Scale::default());
        view.reload(cx);
        view
    });
    settle(&view, cx);
    view.read_with(cx, |view, _| {
        assert_eq!(view.failure, None);
        assert_eq!(view.page.as_ref().unwrap().rows[0][0].text, "authorized");
    });
}

fn click(selector: &'static str, cx: &mut VisualTestContext) {
    cx.update(|window, cx| {
        let _ = window.draw(cx);
    });
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing {selector}"));
    cx.simulate_click(bounds.center(), Modifiers::none());
    cx.run_until_parked();
}

#[gpui::test]
fn database_idle_expiry_keeps_the_page_and_schema_then_reacquires_on_user_intent(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let (ws, gate) = gated("retained");
    gate.release();
    let resource = ws.resource(Path::new("fixture.db")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = DatabaseView::new(Some(resource), false, Scale::default());
        v.reload(cx);
        v
    });
    settle(&view, cx);
    cx.run_until_parked();
    let epoch = view.read_with(cx, |v, _| v.epoch);
    cx.update(|window, cx| {
        DatabaseSurface { view: view.clone() }.apply(true, true, Scale::default(), window, cx)
    });
    view.read_with(cx, |v, _| {
        assert_eq!(v.epoch, epoch);
        assert!(v.session.is_some());
    });
    cx.cx
        .executor()
        .advance_clock(IDLE + Duration::from_secs(1));
    cx.run_until_parked();
    view.read_with(cx, |v, _| {
        assert!(v.session.is_none() && v.failure.is_none());
        assert_eq!(v.page.as_ref().unwrap().rows[0][0].text, "retained");
    });
    assert_eq!(gate.drops.load(Ordering::Acquire), 1);
    click("database-schema", cx);
    view.read_with(cx, |v, _| {
        assert!(v.tab == Tab::Schema && v.session.is_none());
        assert_eq!(v.epoch, epoch);
    });
    // Generation changes invalidate even the retained, sleeping page.
    let replacement = hosted("replacement");
    cx.update(|_, cx| DatabaseSurface { view: view.clone() }.rebind_resource(&replacement, cx));
    settle(&view, cx);
    view.read_with(cx, |v, _| {
        assert!(v.epoch > epoch);
        assert_eq!(v.page.as_ref().unwrap().rows[0][0].text, "replacement");
    });
    cx.run_until_parked();
    cx.cx
        .executor()
        .advance_clock(IDLE + Duration::from_secs(1));
    cx.run_until_parked();
    let revoked = ws.resource(Path::new("fixture.db")).unwrap();
    ws.revoke();
    cx.update(|_, cx| DatabaseSurface { view: view.clone() }.rebind_resource(&revoked, cx));
    view.read_with(cx, |v, _| {
        assert_eq!(v.failure, Some(Failure::Permission));
        assert!(v.page.is_none() && v.session.is_none());
    });
}

#[gpui::test]
fn database_next_page_after_idle_restarts_and_table_intent_survives_object_reordering(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.db");
    fixture(&path, "row");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<60) INSERT INTO items SELECT 'row '||i FROM n; CREATE TABLE other(value TEXT); INSERT INTO other VALUES('other table');").unwrap();
    drop(db);
    let ws = Workspace::open(dir.path()).unwrap();
    let resource = ws.resource(Path::new("fixture.db")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = DatabaseView::new(Some(resource), false, Scale::default());
        v.remembered = ("items".into(), 0);
        v.reload(cx);
        v
    });
    settle(&view, cx);
    click("database-next", cx);
    settle(&view, cx);
    view.read_with(cx, |v, _| {
        assert_eq!(v.page.as_ref().unwrap().offset, 50);
        assert!(!v.restarted);
    });
    // First-page intent permits another Next after this short final page.
    click("database-first", cx);
    settle(&view, cx);
    cx.run_until_parked();
    cx.cx
        .executor()
        .advance_clock(IDLE + Duration::from_secs(1));
    cx.run_until_parked();
    view.read_with(cx, |v, _| assert!(v.session.is_none()));
    // A new object changes SQLite's object positions. The user's selection
    // must be restored by name, never the previous numeric object index.
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE newest(value TEXT); INSERT INTO newest VALUES('wrong table');")
        .unwrap();
    drop(db);
    click("database-next", cx);
    settle(&view, cx);
    view.read_with(cx, |v, _| {
        assert!(v.restarted);
        assert_eq!(v.page.as_ref().unwrap().offset, 0);
        assert_eq!(
            v.objects.as_ref().unwrap()[v.selected.unwrap()].name,
            "items"
        );
    });
    click("database-next", cx);
    settle(&view, cx);
    view.read_with(cx, |v, _| {
        assert!(!v.restarted);
        assert_eq!(v.page.as_ref().unwrap().offset, 50);
    });
    cx.run_until_parked();
    cx.cx
        .executor()
        .advance_clock(IDLE + Duration::from_secs(1));
    cx.run_until_parked();
    let other = view.read_with(cx, |v, _| {
        v.objects
            .as_ref()
            .unwrap()
            .iter()
            .position(|o| o.name == "other")
            .unwrap()
    });
    click(
        [
            "database-object-0",
            "database-object-1",
            "database-object-2",
        ][other],
        cx,
    );
    settle(&view, cx);
    view.read_with(cx, |v, _| {
        assert!(!v.restarted);
        assert_eq!(
            v.objects.as_ref().unwrap()[v.selected.unwrap()].name,
            "other"
        );
        assert_eq!(v.page.as_ref().unwrap().rows[0][0].text, "other table");
    });
}

#[gpui::test]
fn changed_and_recovery_required_database_queries_clear_unsafe_pages_without_automatic_retry(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    for recovery in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.db");
        fixture(&path, "private row");
        let ws = Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(Path::new("fixture.db")).unwrap();
        let (view, cx) = cx.add_window_view(|_, cx| {
            let mut v = DatabaseView::new(Some(resource), false, Scale::default());
            v.reload(cx);
            v
        });
        settle(&view, cx);
        let (epoch, selected) = view.read_with(cx, |v, _| (v.epoch, v.selected.unwrap()));
        if recovery {
            std::fs::write(
                dir.path().join("fixture.db-wal"),
                b"not for preview to repair",
            )
            .unwrap();
        } else {
            let replacement = dir.path().join("replacement.db");
            fixture(&replacement, "replacement row");
            std::fs::rename(replacement, &path).unwrap();
        }
        view.update(cx, |v, cx| v.read(selected, 0, false, cx));
        settle(&view, cx);
        cx.run_until_parked();
        view.read_with(cx, |v, _| {
            assert_eq!(v.epoch, epoch);
            assert_eq!(
                v.failure,
                Some(if recovery {
                    Failure::Recovery
                } else {
                    Failure::Expired
                })
            );
            assert!(v.page.is_none() && v.session.is_none());
        });
        cx.update(|window, cx| {
            let _ = window.draw(cx);
        });
        assert!(cx.debug_bounds("database-retry").is_some());
    }
}

#[gpui::test]
fn a_pending_database_page_ignores_duplicate_next_clicks_and_the_previous_idle_deadline(
    cx: &mut TestAppContext,
) {
    cx.executor().allow_parking();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fixture.db");
    fixture(&path, "first");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<60) INSERT INTO items SELECT 'row '||i FROM n;").unwrap();
    drop(db);
    let (ws, gate) = gated_bytes(std::fs::read(path).unwrap());
    gate.release();
    let resource = ws.resource(Path::new("fixture.db")).unwrap();
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut v = DatabaseView::new(Some(resource), false, Scale::default());
        v.reload(cx);
        v
    });
    settle(&view, cx);
    cx.run_until_parked();
    let epoch = view.read_with(cx, |v, _| v.page.as_ref().unwrap().epoch);
    cx.cx.executor().advance_clock(Duration::from_secs(59));
    cx.run_until_parked();
    gate.arm_validation();
    click("database-next", cx);
    until(cx, |_| gate.entered.load(Ordering::Acquire));
    view.read_with(cx, |v, _| assert!(v.busy));
    click("database-next", cx);
    cx.cx.executor().advance_clock(Duration::from_secs(2));
    cx.run_until_parked();
    view.read_with(cx, |v, _| {
        assert!(v.busy && v.failure.is_none());
        assert!(!v.cancel.load(Ordering::Acquire));
        assert_eq!(v.page.as_ref().unwrap().offset, 0);
    });
    assert_eq!(gate.drops.load(Ordering::Acquire), 0);
    gate.release();
    settle(&view, cx);
    view.read_with(cx, |v, _| {
        let page = v.page.as_ref().unwrap();
        assert_eq!(page.epoch, epoch);
        assert_eq!(page.offset, 50);
        assert_eq!(page.rows.len(), 11);
        assert!(v.failure.is_none() && !v.restarted && v.session.is_some());
    });
    assert!(!gate.timed_out.load(Ordering::Acquire));
}
