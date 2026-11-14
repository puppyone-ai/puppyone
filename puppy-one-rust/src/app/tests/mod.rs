//! The window's integration tests, by the owner they exercise; the
//! helpers they share are here.
use super::*;
use crate::documents::Phase;
use gpui::EntityInputHandler;

mod across_windows;
mod cloud_opening;
mod cloud_share;
mod dialog_layer;
mod editing;
mod explorer_pane;
mod file_window;
mod folder_availability;
mod home_groups;
mod homepage;
mod other_computers;
mod pane_layout;
mod project_lifecycle;
mod sidebar_surfaces;
mod window_chrome;

fn setup(cx: &mut TestAppContext) -> (Entity<Shell>, &mut VisualTestContext) {
    // Shell integration tests exercise real filesystem workers.
    cx.executor().allow_parking();
    cx.update(|cx| {
        bind_keys(cx);
        crate::ui::input::bind_keys(cx);
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        crate::editor::host::bind_keys(cx);
    });
    let mut content = None;
    let (_, cx) = cx.add_window_view(|w, cx| {
        let view = cx.new(|cx| Shell::new(w, cx));
        content = Some(view.clone());
        gpui_kit::base::Root::new(view, w, cx)
    });
    let view = content.unwrap();
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    (view, cx)
}
fn command(view: &Entity<Shell>, cx: &mut VisualTestContext, command: Command) {
    view.update_in(cx, |s, w, cx| s.command(command, w, cx));
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}
/// How soon after a change a frame still shows the motion's early part.
const MOTION_EARLY: std::time::Duration = std::time::Duration::from_millis(40);
/// The shell's Explorer view.
fn explorer_of(view: &Entity<Shell>, cx: &mut VisualTestContext) -> Entity<Explorer> {
    view.read_with(cx, |s, _| s.explorer.view.clone())
}
/// The shell's Explorer session (the tree, selection and clipboard).
fn session_of(view: &Entity<Shell>, cx: &mut VisualTestContext) -> Entity<ExplorerSession> {
    view.read_with(cx, |s, _| s.explorer.session.clone())
}
fn draw(cx: &mut VisualTestContext) {
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}
fn drag(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    from: (f32, f32),
    path: &[(f32, f32)],
    release: bool,
) {
    let at = |p: (f32, f32)| point(px(p.0), px(p.1));
    cx.simulate_mouse_down(at(from), MouseButton::Left, Modifiers::default());
    for p in path {
        cx.simulate_mouse_move(at(*p), Some(MouseButton::Left), Modifiers::default());
    }
    if release {
        cx.simulate_mouse_up(
            at(*path.last().unwrap_or(&from)),
            MouseButton::Left,
            Modifiers::default(),
        );
    }
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
    let _ = view;
}
/// A Cloud API for one hosted Project root with a single file.
fn cloud_project_responder() -> crate::cloud::auth::Responder {
    std::sync::Arc::new(|request| {
        let project = "project-a";
        let path = request.path.as_str();
        Ok(if path.ends_with("/repository-context") {
            serde_json::json!({"code": 0, "data": {
                "target": {"kind": "project_root", "project_id": project},
                "project": {"id": project, "name": "Fixture Cloud",
                            "capabilities": ["content.read", "content.write"]},
                "scope_path": null}})
        } else if path.ends_with("/workbench/files") {
            serde_json::json!({"entries": [{"name": "cloud.md", "kind": "file", "size": 3}]})
        } else if path.ends_with("/workbench") {
            serde_json::json!({"workspace": {"id": "workspace-a", "project_id": project,
                "generation": "9bb16f54-dfe9-4d26-8c68-c7b1ae97d859", "state": "running",
                "target_ref": "refs/heads/main"}})
        } else {
            serde_json::json!({})
        })
    })
}
struct Linked {
    root: std::path::PathBuf,
    _temp: tempfile::TempDir,
    /// Signs the fixture account in again.
    relogin: Box<dyn Fn()>,
}
/// A Git checkout linked to `project-a` on a signed-in fixture account with
/// Cloud on; `responder` answers the Cloud API.
fn linked_checkout(
    cx: &mut TestAppContext,
    responder: crate::cloud::auth::Responder,
) -> (Entity<Shell>, &mut VisualTestContext, Linked) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("local.md"), "# Local\n").unwrap();
    std::fs::create_dir(root.join("docs")).unwrap();
    std::fs::write(root.join("docs/guide.md"), "# Guide\n").unwrap();
    for args in [
        &["init", "-q"][..],
        &[
            "remote",
            "add",
            "origin",
            "http://127.0.0.1:18080/git/project-a.git",
        ],
    ] {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&root)
                .status()
                .unwrap()
                .success()
        );
    }
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    let kept = broker.clone();
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle_cloud(&view, cx, "the local project", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    let relogin = Box::new(move || crate::cloud::auth::relogin(&kept, "alice"));
    (
        view,
        cx,
        Linked {
            root,
            _temp: temp,
            relogin,
        },
    )
}
fn settle_cloud(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    what: &str,
    ready: &dyn Fn(&Shell, &App) -> bool,
) {
    // A liveness wait, not a timing check: the whole suite in parallel can
    // starve one window's workers for seconds.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        view.update_in(cx, |s, w, cx| s.receive(w, cx));
        cx.run_until_parked();
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        if cx.update(|_, cx| ready(view.read(cx), cx)) {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "{what} did not settle"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}
/// `GET /projects/` with `project-a`, else `fallback`.
fn with_catalog(fallback: crate::cloud::auth::Responder) -> crate::cloud::auth::Responder {
    std::sync::Arc::new(move |request| {
        if request.path.contains("/projects/") && !request.path.contains("/projects/project-a") {
            return Ok(serde_json::json!({"code": 0, "data": [
                {"id": "project-a", "name": "Fixture Cloud", "updated_at": "2026-10-01T00:00:00Z"}]}));
        }
        fallback(request)
    })
}
/// The dialog layer as a test reads it.
impl Shell {
    /// What each open dialog is, bottom to top.
    fn dialog_names(&self, cx: &App) -> Vec<String> {
        self.dialogs
            .read(cx)
            .iter()
            .map(|m| match m {
                Modal::Task(task) => format!("Task({task:?})"),
                Modal::CreateEntry(_) => "CreateEntry".into(),
                Modal::ProjectFailure { .. } => "ProjectFailure".into(),
                Modal::ConfirmQuit => "ConfirmQuit".into(),
                Modal::CloseAnyway => "CloseAnyway".into(),
                Modal::Executions => "Executions".into(),
                Modal::Error(error) => format!("Error({error})"),
                Modal::Owned(owned) => format!("{:?}", owned.key),
            })
            .collect()
    }
    fn top_dialog(&self, cx: &App) -> Option<String> {
        self.dialog_names(cx).pop()
    }
    fn has_dialog(&self, name: &str, cx: &App) -> bool {
        self.dialog_names(cx).iter().any(|n| n == name)
    }
}
impl Shell {
    /// The Header place menu as it would open now.
    fn place_menu_now(&self, cx: &App) -> Option<super::project_place::PlaceMenu> {
        let items = self.home.read(cx).project_items(cx);
        self.cloud.read(cx).place_menu(&items, cx)
    }
}
