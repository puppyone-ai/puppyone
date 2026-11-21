//! Actual failed storage, native close choices and the resulting window lifetime.
use super::*;
use core::prelude::v1::test;
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

fn wait_for_close(view: &Entity<Shell>, cx: &mut VisualTestContext) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        cx.run_until_parked();
        if cx.read(|app| app.windows().is_empty()) {
            return;
        }
        assert!(Instant::now() < deadline, "native window did not close");
        view.update_in(cx, |s, window, cx| s.receive(window, cx));
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[gpui::test]
fn dismissing_failed_close_keeps_the_draft_and_a_later_close_can_save(cx: &mut TestAppContext) {
    for dismiss in ["dialog-close", "dialog-command:KeepWindowOpen", "escape"] {
        let (view, memory, cx) = save_status::hosted(cx);
        memory.failing_writes.store(1, Ordering::SeqCst);
        save_status::type_text(&view, cx, " pending");
        cx.update(|_, cx| {
            windows::quit_all(cx);
            assert!(windows::quitting(cx));
        });
        save_status::until(&view, cx, |cx| {
            view.read_with(cx, |s, cx| {
                s.top_dialog(cx).as_deref() == Some("CloseAnyway")
            })
        });
        assert_eq!(*memory.text.lock().unwrap(), "original");
        if dismiss == "escape" {
            cx.simulate_keystrokes("escape");
        } else {
            let target = cx
                .debug_bounds(dismiss)
                .expect("close choice must be rendered")
                .center();
            cx.simulate_click(target, Modifiers::default());
        }
        cx.run_until_parked();
        assert_eq!(
            cx.read(|app| app.windows().len()),
            1,
            "dismissing {dismiss} must keep the window"
        );
        view.read_with(cx, |s, cx| {
            assert!(s.top_dialog(cx).is_none());
            assert!(s.files(cx).dirty && !s.files(cx).allow_quit);
            assert!(!windows::quitting(cx));
        });
        assert_eq!(*memory.text.lock().unwrap(), "original");
        save_status::type_text(&view, cx, " again");
        view.update_in(cx, |s, window, cx| s.command(Command::Quit, window, cx));
        wait_for_close(&view, cx);
        assert_eq!(*memory.text.lock().unwrap(), "original pending again");
    }
}

#[gpui::test]
fn close_anyway_click_closes_without_retrying_the_failed_draft(cx: &mut TestAppContext) {
    let (view, memory, cx) = save_status::hosted(cx);
    memory.failing_writes.store(1, Ordering::SeqCst);
    save_status::type_text(&view, cx, " abandoned");
    command(&view, cx, Command::Quit);
    save_status::until(&view, cx, |cx| {
        view.read_with(cx, |s, cx| {
            s.top_dialog(cx).as_deref() == Some("CloseAnyway")
        })
    });
    let calls = memory.calls.load(Ordering::SeqCst);
    let target = cx
        .debug_bounds("dialog-command:CloseAnyway")
        .unwrap()
        .center();
    cx.simulate_click(target, Modifiers::default());
    wait_for_close(&view, cx);
    assert_eq!(*memory.text.lock().unwrap(), "original");
    assert_eq!(memory.calls.load(Ordering::SeqCst), calls);
}

#[gpui::test]
fn native_close_waits_for_the_actual_storage_acknowledgement(cx: &mut TestAppContext) {
    let (view, memory, cx) = save_status::hosted(cx);
    let calls = memory.calls.load(Ordering::SeqCst);
    let (started, entered) = std::sync::mpsc::channel();
    let (release, finish) = std::sync::mpsc::channel();
    *memory.hook.lock().unwrap() = Some(Box::new(move || {
        let _ = started.send(());
        let _ = finish.recv_timeout(Duration::from_secs(10));
    }));
    save_status::type_text(&view, cx, " closing");
    command(&view, cx, Command::Quit);
    entered.recv_timeout(Duration::from_secs(10)).unwrap();
    cx.run_until_parked();
    assert_eq!(cx.read(|app| app.windows().len()), 1);
    assert_eq!(*memory.text.lock().unwrap(), "original");
    view.read_with(cx, |s, cx| {
        assert!(s.files(cx).dirty && !s.files(cx).allow_quit);
        assert!(s.top_dialog(cx).is_none());
    });
    release.send(()).unwrap();
    wait_for_close(&view, cx);
    assert_eq!(*memory.text.lock().unwrap(), "original closing");
    assert_eq!(memory.calls.load(Ordering::SeqCst), calls + 1);
}
