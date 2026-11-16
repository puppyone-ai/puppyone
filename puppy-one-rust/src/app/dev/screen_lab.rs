//! `shell-cloud-screen-<state>-<mode>`: a Cloud project, signed in to a
//! fixture account, whose Cloud Computer streams a desktop fixture over RFB.
//! `row`: the screen folded into the sidebar card; `preview`: unfolded while
//! Claude Code works there; `stage`: open over the main area; `close`: open,
//! then closed (⌘W, or a file opened), so it goes back to the card while
//! Claude Code works;
//! `asleep`; `off` (its desktop stream turned off). The capture waits for
//! the screen to settle where the state puts it.
use crate::app::*;
use crate::cloud::auth::{Error as AuthError, Responder, ScreenResponder, ScreenSocket};
use serde_json::json;

/// The desktop fixture's size: a 16:10 remote screen.
const DESKTOP: (u32, u32) = (1440, 900);

fn state(case: &str) -> &str {
    let case = case.trim_start_matches("cloud-screen-");
    case.rsplit_once('-').map_or(case, |(state, _)| state)
}

fn responder(state: &'static str) -> Responder {
    std::sync::Arc::new(move |request| {
        let path = request.path.as_str();
        let ago = |secs: i64| {
            chrono::DateTime::from_timestamp_millis(crate::clock::now_ms() - secs * 1000)
                .unwrap_or_default()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        };
        let stream = state != "off";
        Ok(if path.ends_with("/workbench/screen/session") {
            if state == "asleep" {
                return Err(AuthError::Http(409));
            }
            json!({"ticket": "lab", "protocol": "puppyone.screen.v1",
                "ticket_protocol_prefix": "puppyone.screen.ticket.", "transport": "vnc"})
        } else if path.ends_with("/repository-context") {
            json!({"code": 0, "data": {
                "target": {"kind": "project_root", "project_id": "project-a"},
                "project": {"id": "project-a", "name": "My project 44F1",
                    "capabilities": ["content.read", "content.write"]},
                "scope_path": null}})
        } else if path.ends_with("/workbench/files") {
            json!({"entries": [
                {"name": "Untitled.md", "kind": "file", "size": 0},
                {"name": "notes.md", "kind": "file", "size": 40},
                {"name": "data.csv", "kind": "file", "size": 40},
                {"name": "index.html", "kind": "file", "size": 40}]})
        } else if path.ends_with("/workbench") {
            json!({"workspace": {
                "id": "ws-a", "project_id": "project-a",
                "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859",
                "state": "running", "target_ref": "refs/heads/main",
                "sandbox": {
                    "profile": "desktop", "next_profile": "desktop",
                    "settings": {"desktop": true, "screen_stream": stream},
                    "features": [
                        {"id": "desktop", "enabled": true, "installed": true,
                            "preview": false, "requires": []},
                        {"id": "screen_stream", "enabled": stream, "installed": true,
                            "preview": false, "transport": "vnc", "requires": ["desktop"],
                            "reason": if stream { serde_json::Value::Null } else { "user_disabled".into() }}]}}})
        } else if path.ends_with("/agent-links") {
            let agent = |id: &str, name: &str| {
                json!({"id": id, "name": name, "admission": "sign_in",
                    "grant_id": format!("g-{id}"), "connected_at": ago(86_400)})
            };
            json!({"links": [], "pending": [], "connections": if state == "preview" || state == "close" {
                json!([agent("claude", "Claude Code"), agent("codex", "Codex")])
            } else {
                json!([])
            }})
        } else if path.ends_with("/access/sessions") {
            json!([{"grant_id": "g-claude", "state": "active", "created_at": ago(900),
                "closed_at": null, "lease_until": ago(-60), "commands_running": 1,
                "last_command_at": ago(5)}])
        } else if path.contains("/projects/") && !path.contains("/projects/project-a") {
            json!({"code": 0, "data": [{"id": "project-a", "name": "My project 44F1",
                "org_id": "me", "updated_at": "2026-11-15T10:00:00Z"}]})
        } else if path == "/organizations/" {
            json!({"code": 0, "data": [{"id": "me", "name": "Personal", "is_default": true,
                "role": "owner", "can_create_projects": true, "can_manage_space": true,
                "billing_plan_id": "free"}]})
        } else {
            json!({"code": 0, "data": []})
        })
    })
}

/// A desktop with a browser open on a report, painted as the RFB server's
/// 32bpp little-endian `[B, G, R, _]` pixels.
fn desktop() -> Vec<u8> {
    let (w, h) = (DESKTOP.0 as usize, DESKTOP.1 as usize);
    let mut pixels = vec![0u8; w * h * 4];
    let mix = |a: [f32; 3], b: [f32; 3], t: f32| {
        let t = t.clamp(0., 1.);
        [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t,
        ]
    };
    let hex = |c: u32| {
        [
            ((c >> 16) & 0xff) as f32,
            ((c >> 8) & 0xff) as f32,
            (c & 0xff) as f32,
        ]
    };
    let mut put = |x: usize, y: usize, c: [f32; 3]| {
        let i = (y * w + x) * 4;
        pixels[i] = c[2] as u8;
        pixels[i + 1] = c[1] as u8;
        pixels[i + 2] = c[0] as u8;
        pixels[i + 3] = 0xff;
    };
    // Wallpaper: dusk blue to plum to clay, lit at the top start.
    for y in 0..h {
        for x in 0..w {
            let t = (x as f32 / w as f32 + y as f32 / h as f32) / 2.;
            let base = if t < 0.55 {
                mix(hex(0x1e3550), hex(0x4d3b62), t / 0.55)
            } else {
                mix(hex(0x4d3b62), hex(0x8a5a52), (t - 0.55) / 0.45)
            };
            let (dx, dy) = (x as f32 / w as f32 - 0.15, y as f32 / h as f32 - 0.1);
            let glow = (1. - (dx * dx + dy * dy).sqrt() / 0.6).max(0.) * 0.45;
            put(x, y, mix(base, hex(0x35567c), glow));
        }
    }
    let mut fill = |x0: usize, y0: usize, x1: usize, y1: usize, r: usize, c: u32| {
        let c = hex(c);
        for y in y0..y1.min(h) {
            for x in x0..x1.min(w) {
                let cx = if x < x0 + r {
                    x0 + r
                } else if x >= x1 - r {
                    x1 - r - 1
                } else {
                    x
                };
                let cy = if y < y0 + r {
                    y0 + r
                } else if y >= y1 - r {
                    y1 - r - 1
                } else {
                    y
                };
                let (dx, dy) = (x as f32 - cx as f32, y as f32 - cy as f32);
                if dx * dx + dy * dy <= (r * r) as f32 {
                    put(x, y, c);
                }
            }
        }
    };
    // The browser window, its bar and address field.
    let (left, top, right, bottom) = (86, 63, w - 86, h - 96);
    fill(left, top, right, bottom, 12, 0xffffff);
    fill(left, top, right, top + 44, 12, 0xecebe7);
    fill(left, top + 32, right, top + 44, 0, 0xecebe7);
    for (i, c) in [0xc8c7c2u32, 0xc8c7c2, 0xc8c7c2].iter().enumerate() {
        fill(
            left + 18 + i * 18,
            top + 17,
            left + 28 + i * 18,
            top + 27,
            5,
            *c,
        );
    }
    fill(left + 84, top + 10, right - 18, top + 34, 7, 0xffffff);
    fill(left + 98, top + 18, left + 210, top + 26, 4, 0xc9c8c3);
    // The page: a title, two lines and three cards.
    let page = left + 56;
    fill(page, top + 96, page + 300, top + 124, 6, 0x1d1d1b);
    fill(page, top + 148, page + 620, top + 160, 6, 0xb3b1ab);
    fill(page, top + 172, page + 470, top + 184, 6, 0xb3b1ab);
    let card = (right - left - 112 - 2 * 18) / 3;
    for (i, c) in [0xdbe8ffu32, 0xf2f1ed, 0xf2f1ed].iter().enumerate() {
        let x = page + i * (card + 18);
        fill(x, top + 220, x + card, top + 360, 12, *c);
        fill(x + 20, top + 250, x + card / 2, top + 262, 6, 0xd6d4ce);
    }
    for row in 0..3 {
        let y = top + 400 + row * 34;
        fill(page, y, right - 56, y + 12, 6, 0xeeede9);
    }
    // The dock.
    let dock = w / 2 - 98;
    fill(dock, h - 74, dock + 196, h - 22, 14, 0x2a2a35);
    for (i, c) in [0x4a8cffu32, 0x232326, 0xf2c14e, 0x7bd389]
        .iter()
        .enumerate()
    {
        let x = dock + 12 + i * 46;
        fill(x, h - 64, x + 34, h - 32, 8, *c);
    }
    pixels
}

/// Runs the fixture server's future on its own thread.
fn block_on<F: std::future::Future>(future: F) -> F::Output {
    struct Unpark(std::thread::Thread);
    impl std::task::Wake for Unpark {
        fn wake(self: std::sync::Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = std::task::Waker::from(std::sync::Arc::new(Unpark(std::thread::current())));
    let mut cx = std::task::Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        match future.as_mut().poll(&mut cx) {
            std::task::Poll::Ready(out) => return out,
            std::task::Poll::Pending => std::thread::park(),
        }
    }
}

/// RFB 3.8 with no security, then one raw update of the desktop, held open.
fn screen() -> ScreenResponder {
    std::sync::Arc::new(|_, _| {
        let (client, server) = ScreenSocket::pair();
        std::thread::spawn(move || {
            block_on(async move {
                let (w, h) = DESKTOP;
                let handshake = [
                    b"RFB 003.008\n".to_vec(),
                    vec![1, 1],
                    0u32.to_be_bytes().to_vec(),
                ];
                for message in handshake {
                    if server.send(message).await.is_err() || server.recv().await.is_none() {
                        return;
                    }
                }
                let mut init = Vec::new();
                init.extend_from_slice(&(w as u16).to_be_bytes());
                init.extend_from_slice(&(h as u16).to_be_bytes());
                init.extend_from_slice(&[32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
                init.extend_from_slice(&3u32.to_be_bytes());
                init.extend_from_slice(b"lab");
                if server.send(init).await.is_err() || server.recv().await.is_none() {
                    return;
                }
                let mut update = vec![0, 0];
                update.extend_from_slice(&1u16.to_be_bytes());
                update.extend_from_slice(&[0, 0, 0, 0]);
                update.extend_from_slice(&(w as u16).to_be_bytes());
                update.extend_from_slice(&(h as u16).to_be_bytes());
                update.extend_from_slice(&0i32.to_be_bytes());
                update.extend_from_slice(&desktop());
                if server.send(update).await.is_err() {
                    return;
                }
                while server.recv().await.is_some() {}
            });
        });
        Ok(client)
    })
}

impl Shell {
    pub fn lab_cloud_screen(&mut self, case: &str, cx: &mut Context<Self>) {
        let state: &'static str = match state(case) {
            "preview" => "preview",
            "stage" => "stage",
            "close" => "close",
            "asleep" => "asleep",
            "off" => "off",
            _ => "row",
        };
        self.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.cloud_computer_screen = true;
        });
        let (broker, browser) =
            crate::cloud::auth::responding_screen_account_fixture(responder(state), screen());
        crate::features::cloud::account::install_fixture(broker, browser, cx);
        self.open_cloud("project-a".into(), cx);
        // The project and its screen arrive on their own; open the screen
        // once its picture has settled in the card, so it moves from there.
        cx.spawn(async move |this, cx| {
            let mut live_for = 0;
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(30))
                    .await;
                let Ok(done) = this.update(cx, |s, cx| {
                    let screen = s.cloud.read(cx).screen.clone();
                    if state != "stage" && state != "close" {
                        return true;
                    }
                    // `close` starts on the main area, before any picture.
                    if state == "close" && !s.cloud.read(cx).screen_shown(cx) && live_for == 0 {
                        screen.update(cx, |sc, cx| sc.open_for_lab(cx));
                    }
                    if screen.read(cx).has_live_frame() {
                        live_for += 1;
                    }
                    if live_for > 10 {
                        if state == "close" {
                            s.cloud.update(cx, |c, cx| c.close_screen(cx));
                        } else {
                            screen.update(cx, |sc, cx| sc.open_for_lab(cx));
                        }
                        cx.notify();
                        return true;
                    }
                    false
                }) else {
                    return;
                };
                if done {
                    return;
                }
            }
        })
        .detach();
    }

    /// The lab captures once the project shows its files and the screen is
    /// where the state puts it, at rest.
    pub fn lab_cloud_screen_ready(&self, case: &str, cx: &App) -> bool {
        if self.hosted_project(cx).is_none()
            || self.explorer.session.read(cx).tree().rows.is_empty()
        {
            return false;
        }
        let screen = self.cloud.read(cx).screen.read(cx);
        let settled = match state(case) {
            "asleep" => screen.is_asleep_for_lab(),
            "off" => true,
            "stage" => screen.has_live_frame() && self.cloud.read(cx).screen_shown(cx),
            "preview" | "close" => {
                screen.has_live_frame()
                    && screen.operator_for_lab().is_some()
                    && !self.cloud.read(cx).screen_shown(cx)
            }
            _ => screen.has_live_frame(),
        };
        // A held motion (`PUPPYONE_MOTION_AT`) is captured where it holds.
        settled && (!screen.moving_for_lab() || crate::ui::motion::frozen_time().is_some())
    }
}
