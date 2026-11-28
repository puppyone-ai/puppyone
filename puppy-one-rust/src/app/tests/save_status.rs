//! The production save chip over a native editor and a controlled storage port.
use super::*;
use crate::{
    documents::{HostMessage, SaveStatus},
    workspace::testing::Memory,
};
use core::prelude::v1::test;
use std::sync::{Arc, atomic::Ordering, mpsc};
use std::time::{Duration, Instant};

// A scratch Working Copy has no project pane. Mount its real save chip over
// the Shell; every input, command, snapshot and write still uses its owners.
struct ChipHost(Entity<Shell>);
impl Render for ChipHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let shell = self.0.read(cx);
        let area = shell.editor.read(cx);
        div().relative().size_full().child(self.0.clone()).child(
            div()
                .absolute()
                .top(px(100.))
                .left(px(250.))
                .right_0()
                .bottom_0()
                .children(area.save_chip(0, cx)),
        )
    }
}

struct HeldCall {
    release: Option<mpsc::Sender<()>>,
    entered: mpsc::Receiver<()>,
}
impl HeldCall {
    fn new(memory: &Memory) -> Self {
        let (release, finish) = mpsc::channel();
        let (started, entered) = mpsc::channel();
        *memory.hook.lock().unwrap() = Some(Box::new(move || {
            let _ = started.send(());
            let _ = finish.recv_timeout(Duration::from_secs(15));
        }));
        Self {
            release: Some(release),
            entered,
        }
    }
    fn entered(&self) {
        self.entered.recv_timeout(Duration::from_secs(10)).unwrap();
    }
    fn finish(mut self) {
        let _ = self.release.take().unwrap().send(());
    }
}
impl Drop for HeldCall {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }
}

pub(super) fn hosted(
    cx: &mut TestAppContext,
) -> (Entity<Shell>, Arc<Memory>, &mut VisualTestContext) {
    cx.executor().allow_parking();
    cx.update(|cx| {
        bind_keys(cx);
        crate::ui::input::bind_keys(cx);
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        crate::editor::host::bind_keys(cx);
    });
    let mut shell = None;
    let (_, cx) = cx.add_window_view(|window, cx| {
        let view = cx.new(|cx| Shell::new(window, cx));
        shell = Some(view.clone());
        let host = cx.new(|cx| {
            cx.observe(&view, |_, _, cx| cx.notify()).detach();
            let area = view.read(cx).editor.clone();
            cx.observe(&area, |_, _, cx| cx.notify()).detach();
            ChipHost(view)
        });
        gpui_kit::base::Root::new(host, window, cx)
    });
    let shell = shell.unwrap();
    let memory = Arc::new(Memory::new("memory://native-save-chip/project/"));
    let workspace = crate::workspace::Workspace::from_provider(memory.clone()).unwrap();
    let document = workspace.read(std::path::Path::new("note.md")).unwrap();
    shell.update_in(cx, |s, window, cx| {
        s.session.docs.update(cx, |d, _| {
            d.replace(Documents::default());
            d.workspace = Some(workspace);
            d.document = Some(document.clone());
            d.outgoing.push(HostMessage::Open {
                id: document.id,
                name: "note.md".into(),
                text: document.text,
                revision: 0,
                external: false,
            });
        });
        s.sync_editor(window, cx);
    });
    draw(cx);
    (shell, memory, cx)
}

pub(super) fn type_text(view: &Entity<Shell>, cx: &mut VisualTestContext, text: &str) {
    let editor = view.read_with(cx, |s, cx| s.editor.read(cx).front.clone());
    let before = editor.read_with(cx, |e, cx| e.text(cx).unwrap());
    editor.update_in(cx, |e, window, cx| e.lab_type(text, window, cx));
    cx.run_until_parked();
    assert_eq!(
        editor.read_with(cx, |e, cx| e.text(cx).unwrap()),
        before + text
    );
    draw(cx);
}

fn poll(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    view.update_in(cx, |s, window, cx| s.receive(window, cx));
    cx.run_until_parked();
    draw(cx);
}

pub(super) fn until(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    done: impl Fn(&mut VisualTestContext) -> bool,
) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        poll(view, cx);
        if done(cx) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "save chip did not settle: {:?}",
            view.read_with(cx, |s, cx| s.files(cx).save_status())
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn no_chip(cx: &mut VisualTestContext) {
    for id in [
        "editor-save-saving-0",
        "editor-save-saved-0",
        "editor-save-failed-0",
    ] {
        assert!(cx.debug_bounds(id).is_none(), "unexpected {id}");
    }
}

fn blur(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    cx.update(|window, _| window.activate_window());
    cx.deactivate_window();
    poll(view, cx);
}

#[gpui::test]
fn quick_hosted_save_never_renders_a_saving_or_saved_chip(cx: &mut TestAppContext) {
    let (view, memory, cx) = hosted(cx);
    type_text(&view, cx, " quick");
    no_chip(cx);
    until(&view, cx, |cx| {
        !view.read_with(cx, |s, cx| s.files(cx).saving())
    });
    assert_eq!(*memory.text.lock().unwrap(), "original quick");
    no_chip(cx);
    std::thread::sleep(Duration::from_millis(1600));
    poll(&view, cx);
    no_chip(cx);
}

#[gpui::test]
fn slow_hosted_save_renders_confirmation_expires_and_the_next_save_starts_quiet(
    cx: &mut TestAppContext,
) {
    let (view, memory, cx) = hosted(cx);
    let held = HeldCall::new(&memory);
    type_text(&view, cx, " slow");
    until(&view, cx, |cx| {
        view.read_with(cx, |s, cx| s.files(cx).snapshot_request_serial() == 1)
    });
    held.entered();
    no_chip(cx);
    until(&view, cx, |cx| {
        cx.debug_bounds("editor-save-saving-0").is_some()
    });
    assert_eq!(*memory.text.lock().unwrap(), "original");
    held.finish();
    until(&view, cx, |cx| {
        cx.debug_bounds("editor-save-saved-0").is_some()
    });
    assert_eq!(*memory.text.lock().unwrap(), "original slow");
    assert!(view.read_with(cx, |s, cx| s.editor.read(cx).saved_refresh.is_some()));
    // The state uses Instant and the native redraw timer uses GPUI's executor.
    // Cross both clocks without manually polling the document or notifying its
    // view: the production expiry task must cause the repaint itself.
    let expiry = crate::documents::SAVED_STATUS_DURATION + Duration::from_millis(20);
    std::thread::sleep(expiry);
    cx.executor().advance_clock(expiry);
    cx.run_until_parked();
    draw(cx);
    assert!(view.read_with(cx, |s, cx| s.editor.read(cx).saved_refresh.is_none()));
    no_chip(cx);
    let second = HeldCall::new(&memory);
    type_text(&view, cx, " next");
    blur(&view, cx);
    second.entered();
    no_chip(cx);
    second.finish();
    until(&view, cx, |cx| {
        !view.read_with(cx, |s, cx| s.files(cx).saving())
    });
    no_chip(cx);
    assert_eq!(*memory.text.lock().unwrap(), "original slow next");
}

#[gpui::test]
fn new_input_removes_saved_immediately_and_cmd_s_announces_the_explicit_write(
    cx: &mut TestAppContext,
) {
    let (view, memory, cx) = hosted(cx);
    let held = HeldCall::new(&memory);
    type_text(&view, cx, " explicit");
    cx.simulate_keystrokes("secondary-s");
    poll(&view, cx);
    held.entered();
    assert_eq!(
        view.read_with(cx, |s, cx| s.files(cx).save_status()),
        SaveStatus::Saving
    );
    assert!(cx.debug_bounds("editor-save-saving-0").is_some());
    held.finish();
    until(&view, cx, |cx| {
        cx.debug_bounds("editor-save-saved-0").is_some()
    });
    type_text(&view, cx, " newer");
    no_chip(cx);
    assert!(view.read_with(cx, |s, cx| s.files(cx).dirty));
    assert_eq!(*memory.text.lock().unwrap(), "original explicit");
    blur(&view, cx);
    until(&view, cx, |cx| {
        !view.read_with(cx, |s, cx| s.files(cx).saving())
    });
    no_chip(cx);
    assert_eq!(*memory.text.lock().unwrap(), "original explicit newer");
}

#[gpui::test]
fn a_second_save_keeps_its_own_expiry_after_the_first_confirmation_timer(cx: &mut TestAppContext) {
    let (view, memory, cx) = hosted(cx);
    type_text(&view, cx, " first");
    cx.simulate_keystrokes("secondary-s");
    until(&view, cx, |cx| {
        cx.debug_bounds("editor-save-saved-0").is_some()
    });
    std::thread::sleep(Duration::from_millis(900));
    cx.executor().advance_clock(Duration::from_millis(900));
    cx.run_until_parked();
    type_text(&view, cx, " second");
    cx.simulate_keystrokes("secondary-s");
    until(&view, cx, |cx| {
        cx.debug_bounds("editor-save-saved-0").is_some()
    });
    assert_eq!(*memory.text.lock().unwrap(), "original first second");
    assert_eq!(
        view.read_with(cx, |s, cx| s.files(cx).snapshot_request_serial()),
        2
    );

    // The old 1200 ms timer has elapsed; the latest confirmation still has
    // time remaining and must retain a task to repaint at its own deadline.
    std::thread::sleep(Duration::from_millis(400));
    cx.executor().advance_clock(Duration::from_millis(400));
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("editor-save-saved-0").is_some());
    assert!(
        view.read_with(cx, |s, cx| s.editor.read(cx).saved_refresh.is_some()),
        "the latest confirmation lost its expiry task"
    );
    std::thread::sleep(Duration::from_millis(850));
    cx.executor().advance_clock(Duration::from_millis(850));
    cx.run_until_parked();
    draw(cx);
    no_chip(cx);
    assert!(view.read_with(cx, |s, cx| s.editor.read(cx).saved_refresh.is_none()));
}

#[gpui::test]
fn each_retained_document_confirmation_repaints_at_its_own_deadline(cx: &mut TestAppContext) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    for name in ["first.txt", "second.txt"] {
        std::fs::write(root.join(name), "original").unwrap();
    }
    let (view, cx) = setup(cx);
    let editors = autosave::open_project_files(&view, cx, &root, &["first.txt", "second.txt"]);
    for (index, name) in ["first.txt", "second.txt"].iter().enumerate() {
        view.update(cx, |s, cx| {
            s.session
                .docs
                .update(cx, |d, _| d.begin(Intent::OpenFile((*name).into())))
        });
        poll(&view, cx);
        type_text(&view, cx, " saved");
        cx.simulate_keystrokes("secondary-s");
        until(&view, cx, |cx| {
            view.read_with(cx, |s, cx| s.files(cx).save_status() == SaveStatus::Saved)
        });
        if index == 0 {
            std::thread::sleep(Duration::from_millis(500));
            cx.executor().advance_clock(Duration::from_millis(500));
            cx.run_until_parked();
        }
    }
    let (first, second) = view.read_with(cx, |s, cx| {
        let first = s
            .files(cx)
            .slot(editors[0].0)
            .unwrap()
            .save_status_expiry()
            .unwrap();
        let second = s
            .files(cx)
            .slot(editors[1].0)
            .unwrap()
            .save_status_expiry()
            .unwrap();
        assert!(first < second);
        assert_eq!(s.editor.read(cx).saved_refresh.as_ref().unwrap().0, first);
        (first, second)
    });
    let wait_first = first.saturating_duration_since(Instant::now()) + Duration::from_millis(20);
    std::thread::sleep(wait_first);
    cx.executor().advance_clock(wait_first);
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.files(cx).slot(editors[0].0).unwrap().save_status(),
            SaveStatus::Clean
        );
        let second = s
            .files(cx)
            .slot(editors[1].0)
            .unwrap()
            .save_status_expiry()
            .unwrap();
        assert_eq!(s.editor.read(cx).saved_refresh.as_ref().unwrap().0, second);
    });
    let wait_second = second.saturating_duration_since(Instant::now()) + Duration::from_millis(20);
    std::thread::sleep(wait_second);
    cx.executor().advance_clock(wait_second);
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.editor.read(cx).saved_refresh.is_none());
        for (slot, _) in &editors {
            assert_eq!(
                s.files(cx).slot(*slot).unwrap().save_status(),
                SaveStatus::Clean
            );
        }
    });
    for name in ["first.txt", "second.txt"] {
        assert_eq!(
            std::fs::read_to_string(root.join(name)).unwrap(),
            "original saved"
        );
    }
}

#[gpui::test]
fn failed_hosted_save_remains_visible_and_its_real_retry_click_persists_the_draft(
    cx: &mut TestAppContext,
) {
    let (view, memory, cx) = hosted(cx);
    memory.failing_writes.store(1, Ordering::SeqCst);
    type_text(&view, cx, " retry");
    blur(&view, cx);
    until(&view, cx, |cx| {
        cx.debug_bounds("editor-save-failed-0").is_some()
    });
    assert_eq!(*memory.text.lock().unwrap(), "original");
    assert!(view.read_with(cx, |s, cx| s.files(cx).dirty && s.files(cx).error.is_none()));
    std::thread::sleep(Duration::from_millis(1600));
    poll(&view, cx);
    let retry = cx.debug_bounds("editor-save-failed-0").unwrap().center();
    cx.simulate_click(retry, Modifiers::default());
    until(&view, cx, |cx| {
        !view.read_with(cx, |s, cx| s.files(cx).saving())
    });
    no_chip(cx);
    assert_eq!(*memory.text.lock().unwrap(), "original retry");
}
