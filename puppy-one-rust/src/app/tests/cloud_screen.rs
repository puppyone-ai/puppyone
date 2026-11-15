//! End-to-end GPUI integration tests for Cloud Computer Screen
//! (`CloudComputerScreen`, `VncScreenViewer`, `CloudComputerSettings`).
use super::*;
use crate::cloud::auth::{
    Error as AuthError, Responder, ScreenResponder, ScreenSocket, responding_screen_account_fixture,
};
use crate::features::settings::Page;
use crate::workspace::cloud::sandbox::ScreenAvailability;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::Duration;

fn click_selector(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing selector `{selector}`"));
    cx.simulate_click(bounds.center(), Modifiers::none());
    draw(cx);
}

fn repository_context_json() -> Value {
    json!({
        "code": 0,
        "data": {
            "target": {"kind": "project_root", "project_id": "project-a"},
            "project": {
                "id": "project-a",
                "name": "Fixture Cloud",
                "capabilities": ["content.read", "content.write"],
            },
            "scope_path": null,
        }
    })
}

fn sandbox_json(desktop_on: bool, desktop_installed: bool, stream_on: bool) -> Value {
    let profile = if desktop_installed { "desktop" } else { "base" };
    let next_profile = if desktop_on { "desktop" } else { "base" };
    let (stream_enabled, stream_reason) = if !desktop_installed {
        (false, Value::String("requires".into()))
    } else if !stream_on {
        (false, Value::String("user_disabled".into()))
    } else {
        (true, Value::Null)
    };
    json!({
        "profile": profile,
        "next_profile": next_profile,
        "settings": {
            "desktop": desktop_on,
            "screen_stream": stream_on,
        },
        "features": [
            {
                "id": "desktop",
                "enabled": desktop_on && desktop_installed,
                "installed": desktop_installed,
                "preview": false,
                "requires": [],
            },
            {
                "id": "screen_stream",
                "enabled": stream_enabled,
                "installed": desktop_installed,
                "preview": false,
                "reason": stream_reason,
                "transport": "vnc",
                "requires": ["desktop"],
            }
        ]
    })
}

fn settle_screen(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    what: &str,
    ready: &dyn Fn(&Shell, &App) -> bool,
) {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        cx.executor().advance_clock(Duration::from_millis(20));
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        draw(cx);
        if cx.update(|_, cx| ready(view.read(cx), cx)) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{what} did not settle"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn block_on_rfb<F: std::future::Future>(fut: F) -> F::Output {
    struct ThreadWaker(std::thread::Thread);
    impl std::task::Wake for ThreadWaker {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = std::task::Waker::from(Arc::new(ThreadWaker(std::thread::current())));
    let mut cx = std::task::Context::from_waker(&waker);
    let mut fut = std::pin::pin!(fut);
    loop {
        match fut.as_mut().poll(&mut cx) {
            std::task::Poll::Ready(out) => return out,
            std::task::Poll::Pending => std::thread::park(),
        }
    }
}

fn spawn_rfb_frame_server(server_sock: ScreenSocket, hold_open: Arc<AtomicBool>) {
    std::thread::spawn(move || {
        block_on_rfb(async move {
            if server_sock.send(b"RFB 003.008\n".to_vec()).await.is_err() {
                return;
            }
            if server_sock.recv().await.is_none() {
                return;
            }
            if server_sock.send(vec![1, 1]).await.is_err() {
                return;
            }
            if server_sock.recv().await.is_none() {
                return;
            }
            if server_sock.send(0u32.to_be_bytes().to_vec()).await.is_err() {
                return;
            }
            if server_sock.recv().await.is_none() {
                return;
            }

            // ServerInit: 4x2 desktop named "po".
            let mut init = Vec::new();
            init.extend_from_slice(&4u16.to_be_bytes());
            init.extend_from_slice(&2u16.to_be_bytes());
            init.extend_from_slice(&[32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
            init.extend_from_slice(&2u32.to_be_bytes());
            init.extend_from_slice(b"po");
            if server_sock.send(init).await.is_err() {
                return;
            }
            if server_sock.recv().await.is_none() {
                return;
            }

            // Send one 4x2 Raw FramebufferUpdate (8 pixels * 4 bytes = 32 bytes).
            let mut update = vec![0, 0];
            update.extend_from_slice(&1u16.to_be_bytes());
            update.extend_from_slice(&0u16.to_be_bytes());
            update.extend_from_slice(&0u16.to_be_bytes());
            update.extend_from_slice(&4u16.to_be_bytes());
            update.extend_from_slice(&2u16.to_be_bytes());
            update.extend_from_slice(&0i32.to_be_bytes());
            for _ in 0..8 {
                update.extend_from_slice(&[0x33, 0x66, 0x99, 0xff]);
            }
            let _ = server_sock.send(update).await;

            while hold_open.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(5));
            }
        });
    });
}

fn open_cloud_project_window(
    cx: &mut TestAppContext,
    enable_screen_flag: bool,
    api: Responder,
    screen: ScreenResponder,
) -> (Entity<Shell>, &mut VisualTestContext) {
    let (view, cx) = setup(cx);
    let (broker, browser) = responding_screen_account_fixture(with_catalog(api), screen);
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.cloud_computer_screen = enable_screen_flag;
        });
        let screen = s.cloud.read(cx).screen.clone();
        screen.update(cx, |sc, _| {
            sc.set_reconnect_delay_for_test(Duration::from_millis(10))
        });
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "account sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| s.open_cloud("project-a".into(), cx));
    settle_cloud(&view, cx, "hosted project-a", &|s, cx| {
        s.hosted_project(cx).as_deref() == Some("project-a")
    });
    draw(cx);
    (view, cx)
}

fn sync_sandbox(view: &Entity<Shell>, cx: &mut VisualTestContext, sandbox: &Value) {
    let parsed = crate::workspace::cloud::sandbox::read_sandbox(sandbox);
    view.update(cx, |s, cx| {
        s.cloud
            .update(cx, |c, cx| c.sync_sandbox("project-a", parsed, cx));
    });
    draw(cx);
}

#[gpui::test]
fn experiment_flag_and_a_present_screen_gate_sidebar_thumbnail_settings_tab_and_live_screen(
    cx: &mut TestAppContext,
) {
    let sandbox = Arc::new(Mutex::new(sandbox_json(false, false, true)));
    let sandbox_api = sandbox.clone();
    let api: Responder = Arc::new(move |req| {
        let path = req.path.as_str();
        Ok(if path.ends_with("/repository-context") {
            repository_context_json()
        } else if path.ends_with("/workbench/files") {
            json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 5}]})
        } else if path.ends_with("/workbench") {
            json!({
                "workspace": {
                    "id": "ws-a",
                    "project_id": "project-a",
                    "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859",
                    "state": "running",
                    "target_ref": "refs/heads/main",
                    "sandbox": sandbox_api.lock().unwrap().clone(),
                }
            })
        } else {
            json!({})
        })
    });
    let screen_ws: ScreenResponder = Arc::new(|_, _| Err(AuthError::Http(502)));

    let (view, cx) = open_cloud_project_window(cx, false, api, screen_ws);

    // Off by default: neither thumbnail nor Computer settings page is available.
    assert!(cx.debug_bounds("cloud-screen-thumbnail").is_none());
    view.read_with(cx, |s, cx| {
        assert!(!s.cloud.read(cx).screen_shown(cx));
        let settings = s.dialogs.read(cx).settings.read(cx);
        assert!(!settings.page_available(Page::CloudComputer, cx));
    });

    // Turning the experiment on exposes the settings page, but a computer
    // without a desktop has no screen to offer.
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|st| st.experimental.cloud_computer_screen = true, cx);
        });
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-screen-thumbnail").is_none());
    view.read_with(cx, |s, cx| {
        let settings = s.dialogs.read(cx).settings.read(cx);
        assert!(settings.page_available(Page::CloudComputer, cx));
    });

    // A computer with a desktop offers the companion entry pinned at the top of
    // the left sidebar, even with its stream turned off (the screen then offers to turn it on).
    sync_sandbox(&view, cx, &sandbox_json(true, true, false));
    let thumb = cx.debug_bounds("cloud-screen-thumbnail").unwrap();
    assert!(f32::from(thumb.origin.y) < 110.);

    // Clicking the sidebar monitor icon opens the Cloud Computer screen in the main area
    // and gates the underlying editor area.
    click_selector(cx, "cloud-screen-thumbnail");
    view.read_with(cx, |s, cx| {
        assert!(s.cloud.read(cx).screen_shown(cx));
        assert!(s.editor_gate(cx).modal);
    });
    assert!(cx.debug_bounds("cloud-screen-stream-on").is_some());

    // The screen goes away with the desktop: it closes, and the shell hears it.
    let changes = Arc::new(AtomicUsize::new(0));
    let heard = changes.clone();
    let screen = view.read_with(cx, |s, cx| s.cloud.read(cx).screen.clone());
    let _subscription = cx.update(|_, cx| {
        cx.subscribe(&screen, move |_, event, _| {
            if *event == crate::features::cloud::CloudScreenEvent::VisibilityChanged {
                heard.fetch_add(1, Ordering::AcqRel);
            }
        })
    });
    sync_sandbox(&view, cx, &sandbox_json(true, false, true));
    assert_eq!(changes.load(Ordering::Acquire), 1);
    assert!(cx.debug_bounds("cloud-screen-thumbnail").is_none());
    view.read_with(cx, |s, cx| {
        assert!(!s.cloud.read(cx).screen_shown(cx));
        assert!(!s.editor_gate(cx).modal);
    });

    // A preview of the screen is offered too.
    sync_sandbox(
        &view,
        cx,
        &json!({
            "profile": "base",
            "next_profile": "base",
            "features": [{
                "id": "screen_stream", "installed": false, "enabled": true,
                "preview": true, "transport": "vnc",
            }]
        }),
    );
    assert!(cx.debug_bounds("cloud-screen-thumbnail").is_some());
    click_selector(cx, "cloud-screen-thumbnail");
    assert!(cx.debug_bounds("cloud-screen-notice").is_some());

    // Turning the experiment off immediately closes the screen and hides the thumbnail.
    view.update(cx, |s, cx| {
        s.prefs.store.update(cx, |p, cx| {
            p.change(|st| st.experimental.cloud_computer_screen = false, cx);
        });
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-screen-thumbnail").is_none());
    view.read_with(cx, |s, cx| {
        assert!(!s.cloud.read(cx).screen_shown(cx));
        assert!(!s.editor_gate(cx).modal);
    });
}

#[gpui::test]
fn screen_notices_drive_stream_toggle_and_asleep_wake(cx: &mut TestAppContext) {
    let sandbox = Arc::new(Mutex::new(sandbox_json(true, true, false)));
    let asleep = Arc::new(AtomicBool::new(true));
    let patches: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let workbench_opens = Arc::new(AtomicUsize::new(0));

    let sandbox_api = sandbox.clone();
    let asleep_api = asleep.clone();
    let patches_api = patches.clone();
    let opens_api = workbench_opens.clone();
    let api: Responder = Arc::new(move |req| {
        let path = req.path.as_str();
        if path.ends_with("/workbench/sandbox") {
            let body = req.body.clone().unwrap_or_default();
            patches_api.lock().unwrap().push(body.clone());
            let next = if body.get("desktop") == Some(&Value::Bool(true)) {
                // Desktop requested, image still rebuilding (pending = true).
                sandbox_json(true, false, true)
            } else if body.get("screen_stream") == Some(&Value::Bool(true)) {
                sandbox_json(true, true, true)
            } else {
                sandbox_api.lock().unwrap().clone()
            };
            *sandbox_api.lock().unwrap() = next.clone();
            return Ok(next);
        }
        if path.ends_with("/workbench/screen/session") {
            if asleep_api.load(Ordering::Acquire) {
                return Err(AuthError::Http(409));
            }
            return Ok(json!({
                "ticket": "tok-1",
                "protocol": "puppyone.screen.v1",
                "ticket_protocol_prefix": "puppyone.screen.ticket.",
                "transport": "vnc",
            }));
        }
        if path.ends_with("/repository-context") {
            return Ok(repository_context_json());
        }
        if path.ends_with("/workbench/files") {
            return Ok(json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 5}]}));
        }
        if path.ends_with("/workbench") {
            opens_api.fetch_add(1, Ordering::AcqRel);
            return Ok(json!({
                "workspace": {
                    "id": "ws-a",
                    "project_id": "project-a",
                    "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859",
                    "state": "running",
                    "target_ref": "refs/heads/main",
                    "sandbox": sandbox_api.lock().unwrap().clone(),
                }
            }));
        }
        Ok(json!({}))
    });

    let hold_open = Arc::new(AtomicBool::new(true));
    let hold_ws = hold_open.clone();
    let screen_ws: ScreenResponder = Arc::new(move |_, _| {
        let (client_sock, server_sock) = ScreenSocket::pair();
        spawn_rfb_frame_server(server_sock, hold_ws.clone());
        Ok(client_sock)
    });

    let (view, cx) = open_cloud_project_window(cx, true, api, screen_ws);
    click_selector(cx, "cloud-screen-thumbnail");

    // 1. A desktop with its stream off -> clicking "Show screen" sends {"screen_stream": true}
    //    and hits 409 Asleep -> shows "Wake it".
    assert!(cx.debug_bounds("cloud-screen-stream-on").is_some());

    click_selector(cx, "cloud-screen-stream-on");
    settle_screen(&view, cx, "asleep 409 state", &|s, cx| {
        s.cloud.read(cx).screen.read(cx).is_asleep_for_test()
    });
    assert_eq!(
        patches.lock().unwrap().last(),
        Some(&json!({"screen_stream": true}))
    );
    assert!(cx.debug_bounds("cloud-screen-wake").is_some());
    assert!(cx.debug_bounds("cloud-screen-sidebar-wake").is_some());

    // 2. Clicking the inline sidebar "Wake it" wakes/reopens the workspace and streams live RFB frames!
    let opens_before = workbench_opens.load(Ordering::Acquire);
    asleep.store(false, Ordering::Release);
    click_selector(cx, "cloud-screen-sidebar-wake");
    settle_screen(&view, cx, "woken live RFB frame", &|s, cx| {
        workbench_opens.load(Ordering::Acquire) > opens_before
            && s.cloud.read(cx).screen_shown(cx)
            && s.cloud.read(cx).screen.read(cx).has_live_frame()
    });
    assert!(cx.debug_bounds("cloud-screen-sidebar-wake").is_none());
    hold_open.store(false, Ordering::Release);
}

#[gpui::test]
fn live_rfb_stream_auto_reconnects_three_times_recovers_on_retry_and_closes_on_file_open(
    cx: &mut TestAppContext,
) {
    let tickets_minted = Arc::new(AtomicUsize::new(0));
    let tickets_api = tickets_minted.clone();
    let api: Responder = Arc::new(move |req| {
        let path = req.path.as_str();
        if path.ends_with("/workbench/screen/session") {
            let n = tickets_api.fetch_add(1, Ordering::AcqRel) + 1;
            return Ok(json!({
                "ticket": format!("single-use-{n}"),
                "protocol": "puppyone.screen.v1",
                "ticket_protocol_prefix": "puppyone.screen.ticket.",
                "transport": "vnc",
            }));
        }
        if path.ends_with("/repository-context") {
            return Ok(repository_context_json());
        }
        if path.ends_with("/workbench/files") {
            return Ok(json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 5}]}));
        }
        if path.ends_with("/workbench/file") {
            return Ok(json!({
                "name": "cloud.md", "kind": "file", "size": 8,
                "content_base64": "IyBDbG91ZAo=",
                "revision": "dbfd7f950eb43c7ee2e1118e160ea8c5f16a424c4a826563564a3af0dab88cd5",
            }));
        }
        if path.ends_with("/workbench") {
            return Ok(json!({
                "workspace": {
                    "id": "ws-a",
                    "project_id": "project-a",
                    "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859",
                    "state": "running",
                    "target_ref": "refs/heads/main",
                    "sandbox": sandbox_json(true, true, true),
                }
            }));
        }
        Ok(json!({}))
    });

    let healthy = Arc::new(AtomicBool::new(true));
    let hold_first = Arc::new(AtomicBool::new(true));
    let hold_recovered = Arc::new(AtomicBool::new(true));
    let seen_protocols: Arc<Mutex<Vec<Vec<String>>>> = Arc::new(Mutex::new(Vec::new()));

    let healthy_ws = healthy.clone();
    let hold_first_ws = hold_first.clone();
    let hold_rec_ws = hold_recovered.clone();
    let protos_ws = seen_protocols.clone();
    let ws_calls = Arc::new(AtomicUsize::new(0));
    let ws_calls_ref = ws_calls.clone();

    let screen_ws: ScreenResponder = Arc::new(move |_, protocols| {
        protos_ws
            .lock()
            .unwrap()
            .push(vec![protocols.0.to_owned(), protocols.1.to_owned()]);
        let call = ws_calls_ref.fetch_add(1, Ordering::AcqRel) + 1;
        if !healthy_ws.load(Ordering::Acquire) {
            // Immediate socket close before RFB handshake completes -> transient failure.
            let (client_sock, _dropped_server) = ScreenSocket::pair();
            return Ok(client_sock);
        }
        let (client_sock, server_sock) = ScreenSocket::pair();
        let hold = if call == 1 {
            hold_first_ws.clone()
        } else {
            hold_rec_ws.clone()
        };
        spawn_rfb_frame_server(server_sock, hold);
        Ok(client_sock)
    });

    let (view, cx) = open_cloud_project_window(cx, true, api, screen_ws);
    click_selector(cx, "cloud-screen-thumbnail");

    // Initial connection succeeds and renders a 4x2 frame.
    settle_screen(&view, cx, "initial RFB frame", &|s, cx| {
        s.cloud.read(cx).screen.read(cx).has_live_frame()
            && s.cloud.read(cx).screen.read(cx).frame_dimensions() == Some((4, 2))
    });
    assert_eq!(tickets_minted.load(Ordering::Acquire), 1);

    // Force disconnect and make subsequent attempts fail: CloudScreen must auto-reconnect
    // CLOUD_SCREEN_RECONNECTS (3) times with a fresh single-use ticket each time before Failed.
    healthy.store(false, Ordering::Release);
    hold_first.store(false, Ordering::Release);

    settle_screen(&view, cx, "3x auto-reconnect exhaustion", &|s, cx| {
        s.cloud.read(cx).screen.read(cx).is_failed_for_test()
    });
    assert_eq!(tickets_minted.load(Ordering::Acquire), 4);
    {
        let protos = seen_protocols.lock().unwrap();
        assert_eq!(protos.len(), 4);
        assert_eq!(
            protos[0],
            vec![
                "puppyone.screen.v1".to_owned(),
                "puppyone.screen.ticket.single-use-1".to_owned()
            ]
        );
        assert_eq!(
            protos[3],
            vec![
                "puppyone.screen.v1".to_owned(),
                "puppyone.screen.ticket.single-use-4".to_owned()
            ]
        );
    }

    // Clicking "Reconnect" mints ticket #5 and recovers the live VNC viewport!
    assert!(cx.debug_bounds("cloud-screen-retry").is_some());
    healthy.store(true, Ordering::Release);
    click_selector(cx, "cloud-screen-retry");
    settle_screen(&view, cx, "recovered RFB frame", &|s, cx| {
        s.cloud.read(cx).screen.read(cx).has_live_frame()
    });
    assert_eq!(tickets_minted.load(Ordering::Acquire), 5);

    // Opening a file from Explorer shrinks Full-Pane CloudScreen into bottom-right
    // PiP (`288x180`) while keeping the editor ungated and the RFB stream persistent!
    view.update_in(cx, |s, w, cx| {
        s.explorer_event(&ExplorerEvent::Open(PathBuf::from("cloud.md")), w, cx);
    });
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(!s.cloud.read(cx).screen_shown(cx));
        assert!(!s.editor_gate(cx).modal);
    });
    settle_screen(&view, cx, "opened cloud document", &|s, cx| {
        assert!(
            s.files(cx).error.is_none(),
            "file opening error: {:?}",
            s.files(cx).error
        );
        s.files(cx).document.is_some()
    });
    view.read_with(cx, |s, cx| {
        let files = s.files(cx);
        assert!(files.error.is_none(), "cloud file response must be valid");
        assert_eq!(files.document.as_ref().unwrap().text, "# Cloud\n");
    });
    let pip = cx.debug_bounds("cloud-screen-pip").unwrap();
    assert!((f32::from(pip.size.width) - 288.).abs() < 0.5);
    assert!((f32::from(pip.size.height) - 180.).abs() < 0.5);
    assert_eq!(tickets_minted.load(Ordering::Acquire), 5);

    // Clicking PiP's hide (`x`) button dismisses PiP until reopened from the sidebar,
    // and clicking PiP expands back to Full-Pane without minting another ticket.
    click_selector(cx, "cloud-screen-pip-close");
    assert!(cx.debug_bounds("cloud-screen-pip").is_none());
    click_selector(cx, "cloud-screen-thumbnail");
    view.read_with(cx, |s, cx| assert!(s.cloud.read(cx).screen_shown(cx)));
    view.update_in(cx, |s, w, cx| {
        s.explorer_event(&ExplorerEvent::Open(PathBuf::from("cloud.md")), w, cx);
    });
    draw(cx);
    assert!(cx.debug_bounds("cloud-screen-pip").is_some());
    click_selector(cx, "cloud-screen-pip-expand");
    view.read_with(cx, |s, cx| assert!(s.cloud.read(cx).screen_shown(cx)));
    assert_eq!(tickets_minted.load(Ordering::Acquire), 5);

    hold_recovered.store(false, Ordering::Release);
}

#[gpui::test]
fn explicit_take_control_gates_rfb_input_and_releases_on_escape_or_button(cx: &mut TestAppContext) {
    let api: Responder = Arc::new(move |req| {
        let path = req.path.as_str();
        if path.ends_with("/workbench/screen/session") {
            return Ok(json!({
                "ticket": "tok-takeover",
                "protocol": "puppyone.screen.v1",
                "ticket_protocol_prefix": "puppyone.screen.ticket.",
                "transport": "vnc",
            }));
        }
        if path.ends_with("/repository-context") {
            return Ok(repository_context_json());
        }
        if path.ends_with("/workbench/files") {
            return Ok(json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 5}]}));
        }
        if path.ends_with("/workbench") {
            return Ok(json!({
                "workspace": {
                    "id": "ws-a",
                    "project_id": "project-a",
                    "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859",
                    "state": "running",
                    "target_ref": "refs/heads/main",
                    "sandbox": sandbox_json(true, true, true),
                }
            }));
        }
        Ok(json!({}))
    });

    let hold_open = Arc::new(AtomicBool::new(true));
    let pointer_packets = Arc::new(AtomicUsize::new(0));
    let hold_ws = hold_open.clone();
    let pointer_ws = pointer_packets.clone();
    let screen_ws: ScreenResponder = Arc::new(move |_, _| {
        let (client_sock, server_sock) = ScreenSocket::pair();
        let hold = hold_ws.clone();
        let pointers = pointer_ws.clone();
        std::thread::spawn(move || {
            block_on_rfb(async move {
                if server_sock.send(b"RFB 003.008\n".to_vec()).await.is_err() {
                    return;
                }
                if server_sock.recv().await.is_none() {
                    return;
                }
                if server_sock.send(vec![1, 1]).await.is_err() {
                    return;
                }
                if server_sock.recv().await.is_none() {
                    return;
                }
                if server_sock.send(0u32.to_be_bytes().to_vec()).await.is_err() {
                    return;
                }
                if server_sock.recv().await.is_none() {
                    return;
                }
                let mut init = Vec::new();
                init.extend_from_slice(&4u16.to_be_bytes());
                init.extend_from_slice(&2u16.to_be_bytes());
                init.extend_from_slice(&[32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
                init.extend_from_slice(&2u32.to_be_bytes());
                init.extend_from_slice(b"po");
                if server_sock.send(init).await.is_err() {
                    return;
                }
                if server_sock.recv().await.is_none() {
                    return;
                }
                let mut update = vec![0, 0];
                update.extend_from_slice(&1u16.to_be_bytes());
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&4u16.to_be_bytes());
                update.extend_from_slice(&2u16.to_be_bytes());
                update.extend_from_slice(&0i32.to_be_bytes());
                for _ in 0..8 {
                    update.extend_from_slice(&[0x33, 0x66, 0x99, 0xff]);
                }
                let _ = server_sock.send(update).await;

                let (tx, rx) = server_sock.into_split();
                let _keep_tx = tx;
                while hold.load(Ordering::Acquire) {
                    let Some(pkt) = rx.recv().await else {
                        break;
                    };
                    if pkt.len() == 6 && pkt[0] == 5 {
                        pointers.fetch_add(1, Ordering::AcqRel);
                    }
                }
            });
        });
        Ok(client_sock)
    });

    let (view, cx) = open_cloud_project_window(cx, true, api, screen_ws);
    click_selector(cx, "cloud-screen-thumbnail");
    settle_screen(&view, cx, "live RFB frame", &|s, cx| {
        s.cloud.read(cx).screen.read(cx).has_live_frame()
    });
    draw(cx);

    // 1. Default view-only mode: `Take control` and `Full screen` pills exist,
    //    `interactive` is false, and clicking on the live stage sends NO RFB pointer packet.
    view.read_with(cx, |s, cx| {
        assert!(!s.cloud.read(cx).screen_interactive(cx));
    });
    assert!(cx.debug_bounds("cloud-screen-take-control").is_some());
    assert!(cx.debug_bounds("cloud-screen-fullscreen").is_some());
    let live = cx.debug_bounds("cloud-screen-live").unwrap();
    let probe_pt = point(live.origin.x + px(40.), live.center().y);
    cx.simulate_click(probe_pt, Modifiers::none());
    draw(cx);
    std::thread::sleep(Duration::from_millis(25));
    assert_eq!(pointer_packets.load(Ordering::Acquire), 0);

    // 2. Clicking `Take control` enables input forwarding and swaps to `Release control`.
    click_selector(cx, "cloud-screen-take-control");
    view.read_with(cx, |s, cx| {
        assert!(s.cloud.read(cx).screen_interactive(cx));
    });
    assert!(cx.debug_bounds("cloud-screen-release-control").is_some());
    assert!(cx.debug_bounds("cloud-screen-take-control").is_none());

    cx.simulate_click(probe_pt, Modifiers::none());
    settle_screen(&view, cx, "forwarded RFB pointer packet", &|_, _| {
        pointer_packets.load(Ordering::Acquire) >= 2
    });

    // 3. `Escape` exits takeover without closing Full-Pane screen.
    command(&view, cx, Command::Escape);
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.cloud.read(cx).screen_shown(cx));
        assert!(!s.cloud.read(cx).screen_interactive(cx));
    });
    assert!(cx.debug_bounds("cloud-screen-take-control").is_some());

    // 4. Re-taking control and clicking `Release control` also exits takeover cleanly.
    click_selector(cx, "cloud-screen-take-control");
    view.read_with(cx, |s, cx| assert!(s.cloud.read(cx).screen_interactive(cx)));
    click_selector(cx, "cloud-screen-release-control");
    view.read_with(cx, |s, cx| {
        assert!(!s.cloud.read(cx).screen_interactive(cx))
    });

    hold_open.store(false, Ordering::Release);
}

#[gpui::test]
fn settings_computer_page_loads_workbench_and_syncs_live_screen(cx: &mut TestAppContext) {
    let sandbox = Arc::new(Mutex::new(sandbox_json(true, true, true)));
    let sandbox_api = sandbox.clone();
    let api: Responder = Arc::new(move |req| {
        let path = req.path.as_str();
        if path.ends_with("/workbench/sandbox") {
            let body = req.body.clone().unwrap_or_default();
            let stream_on = body
                .get("screen_stream")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let next = sandbox_json(true, true, stream_on);
            *sandbox_api.lock().unwrap() = next.clone();
            return Ok(next);
        }
        if path.ends_with("/repository-context") {
            return Ok(repository_context_json());
        }
        if path.ends_with("/workbench/files") {
            return Ok(json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 5}]}));
        }
        if path.ends_with("/workbench") {
            return Ok(json!({
                "workspace": {
                    "id": "ws-a",
                    "project_id": "project-a",
                    "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859",
                    "state": "running",
                    "target_ref": "refs/heads/main",
                    "sandbox": sandbox_api.lock().unwrap().clone(),
                }
            }));
        }
        Ok(json!({}))
    });
    let screen_ws: ScreenResponder = Arc::new(|_, _| Err(AuthError::Http(502)));

    let (view, cx) = open_cloud_project_window(cx, true, api, screen_ws);
    view.update_in(cx, |s, w, cx| s.open_settings(Page::CloudComputer, w, cx));
    settle_cloud(&view, cx, "Computer settings page loaded", &|s, cx| {
        s.dialogs.read(cx).settings.read(cx).cloud_computer_state()
            == Some((true, true, false, false))
    });

    // Toggling "Show screen" off in Settings updates the backend and syncs WindowCloud.screen!
    click_selector(cx, "cloud-computer-stream-toggle");
    settle_cloud(&view, cx, "Show screen toggled off", &|s, cx| {
        s.dialogs.read(cx).settings.read(cx).cloud_computer_state()
            == Some((true, false, false, false))
            && s.cloud.read(cx).screen.read(cx).availability_for_test()
                == ScreenAvailability::StreamOff
    });
}
