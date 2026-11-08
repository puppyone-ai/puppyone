//! Folders on the owner's other computers: listed in My Share Project,
//! opened here through the Cloud's tunnel (an in-memory one, ending at a
//! real host SSH server), named by their computer in the Header, and run on
//! that computer.
use super::*;
use crate::features::hosts::Tool;
use crate::workspace::hosts::{
    remote::{Hosts, runtime},
    testing::fake,
};
use core::prelude::v1::test;

#[gpui::test]
fn another_computers_folder_opens_here_and_runs_there(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("note.md"), "hello").unwrap();
    let (view, cx) = setup(cx);
    let (broker, browser) =
        crate::cloud::auth::responding_account_fixture(cloud_project_responder());
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.host_devices = true;
        });
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    let hosts = Hosts::new(fake(root.clone()));
    let devices = runtime().block_on(hosts.catalog()).unwrap();
    cx.update(|_, cx| {
        crate::features::hosts::global(cx).update(cx, |c, cx| c.install(hosts, devices, cx))
    });
    command(&view, cx, Command::Home);
    // Listed with its computer, in My Share Project.
    let item = |s: &Shell, cx: &App| {
        let home = s.home.read(cx);
        home.project_groups_now(home.visible_projects(cx), cx)
            .into_iter()
            .find(|g| g.id == crate::app::home::groups::GroupId::PersonalShared)
            .and_then(|g| g.items.into_iter().find(|i| i.remote.is_some()))
    };
    settle_cloud(&view, cx, "the other computer's folder", &|s, cx| {
        item(s, cx).is_some()
    });
    let remote = view.read_with(cx, |s, cx| item(s, cx).unwrap());
    assert_eq!(remote.label, "notes");
    let folder = remote.remote.clone().unwrap();
    assert_eq!(
        (folder.host.as_str(), folder.writable),
        ("Studio Mac", true)
    );
    view.update(cx, |s, cx| s.open_device(folder, remote.label.clone(), cx));
    settle_cloud(&view, cx, "the folder", &|s, cx| {
        s.session.project.read(cx).device(cx).is_some() && !s.files(cx).busy()
    });
    // Its files, named by their computer.
    let names = view.read_with(cx, |s, cx| {
        s.files(cx)
            .workspace
            .as_ref()
            .unwrap()
            .list(std::path::Path::new(""))
            .unwrap()
            .into_iter()
            .map(|n| n.name)
            .collect::<Vec<_>>()
    });
    assert_eq!(names, ["note.md"]);
    view.read_with(cx, |s, cx| {
        assert!(s.hosted_project(cx).is_none());
        let menu = s.cloud.read(cx).place_menu(&[], cx).unwrap();
        assert_eq!(menu.place, crate::app::project_place::Place::Computer);
        assert_eq!(menu.address.unwrap().full, "Studio Mac");
        assert_eq!(
            menu.detail.as_deref(),
            Some(crate::localization::t("hosts.catalog.editable"))
        );
        assert_eq!(
            s.sidebar.read(cx).host_tools.read(cx).tools(),
            [Tool::Terminal, Tool::Git]
        );
    });
    // Changes, from that computer's Git.
    view.update_in(cx, |s, w, cx| {
        s.sidebar
            .update(cx, |sb, cx| sb.toggle_host_tool(Tool::Git, w, cx))
    });
    settle_cloud(&view, cx, "the Changes", &|s, cx| {
        s.sidebar.read(cx).host_tools.read(cx).status().is_some()
    });
    view.read_with(cx, |s, cx| {
        let tools = s.sidebar.read(cx).host_tools.read(cx);
        assert_eq!(tools.status().unwrap()["isRepo"], false);
        assert!(s.sidebar.read(cx).shows_host_tool(Tool::Git, cx));
    });
    // A terminal there: what it prints comes back here.
    view.update_in(cx, |s, w, cx| {
        s.sidebar
            .update(cx, |sb, cx| sb.toggle_host_tool(Tool::Terminal, w, cx))
    });
    settle_cloud(&view, cx, "the terminal", &|s, cx| {
        s.sidebar
            .read(cx)
            .host_tools
            .read(cx)
            .session(Tool::Terminal)
            .is_some_and(|(_, running)| running)
    });
    let terminal = view.read_with(cx, |s, cx| {
        s.sidebar
            .read(cx)
            .host_tools
            .read(cx)
            .session(Tool::Terminal)
            .unwrap()
            .0
    });
    terminal.read_with(cx, |t, _| t.type_text("echo $((40 + 2))\n"));
    settle_cloud(&view, cx, "the terminal's output", &|_, cx| {
        terminal.read(cx).screen_text().contains("42")
    });
    // Home over it; the folder stays behind, like any project here.
    command(&view, cx, Command::Home);
    view.read_with(cx, |s, cx| assert!(s.home_visible(cx)));
}

/// The device side of the Cloud, unreachable: sharing waits to connect.
struct Offline;
impl crate::workspace::hosts::connector::Gateway for Offline {
    fn challenge(
        &self,
        _: &str,
        _: serde_json::Value,
    ) -> futures_util::future::BoxFuture<
        'static,
        Result<serde_json::Value, crate::workspace::hosts::connector::Refused>,
    > {
        Box::pin(async { Err(Default::default()) })
    }
    fn connect(
        &self,
        _: url::Url,
    ) -> futures_util::future::BoxFuture<
        'static,
        Result<Box<dyn crate::workspace::hosts::remote::Socket>, String>,
    > {
        Box::pin(async { Err("offline".into()) })
    }
    fn authorities(&self) -> futures_util::future::BoxFuture<'static, Result<Vec<String>, String>> {
        Box::pin(async { Ok(vec![]) })
    }
    fn deployment(&self) -> &str {
        "http://127.0.0.1:18080/api/v1"
    }
}

/// Opening a folder here to my other computers: asked first, registered
/// through this computer's own host (in this process, on its control
/// socket), remembered with the folder, widened only after another yes,
/// and stopped after one more.
#[gpui::test]
fn a_folder_here_opens_to_my_other_computers_after_i_allow_it(cx: &mut TestAppContext) {
    use crate::workspace::hosts::{
        control,
        identity::{KeyStore, MemoryKeys},
        registry::Execution,
        service::HostService,
    };
    const USER: &str = "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f";
    const DEVICE: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";
    let temp = tempfile::tempdir().unwrap();
    let folder = temp.path().canonicalize().unwrap().join("notes");
    std::fs::create_dir(&folder).unwrap();
    let asked = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let seen = asked.clone();
    // The Cloud's view: the folder this computer registered, at its revision.
    let registered = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
    let responder: crate::cloud::auth::Responder = std::sync::Arc::new(move |request| {
        let path = request.path.clone();
        seen.lock()
            .unwrap()
            .push(format!("{} {path}", request.method));
        Ok(if path == "/hosts/devices" {
            serde_json::json!({"device_id": DEVICE})
        } else if path.ends_with("/folders") {
            let id = request.body.as_ref().unwrap()["folder_id"].clone();
            *registered.lock().unwrap() = id.as_str().map(str::to_owned);
            serde_json::json!({"folder_id": id})
        } else if path == "/hosts" {
            let folders: Vec<_> = registered
                .lock()
                .unwrap()
                .iter()
                .map(|id| {
                    serde_json::json!({"id": id, "name": "notes", "state": "active",
                        "revision": 1, "capabilities": ["folder.read"]})
                })
                .collect();
            serde_json::json!({"devices": [{"id": DEVICE, "name": "This Mac", "online": true,
                "state": "active", "folders": folders}]})
        } else {
            serde_json::json!({})
        })
    });
    let (view, cx) = setup(cx);
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    crate::cloud::auth::relogin(&broker, USER);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.host_devices = true;
            p.state.remember_project(&folder, 1);
        });
    });
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    // This computer's host, in this process.
    let dir = temp.path().join("host-service");
    let keys = std::sync::Arc::new(MemoryKeys::default());
    struct Same(std::sync::Arc<MemoryKeys>);
    impl KeyStore for Same {
        fn put(&self, i: &str, s: &[u8]) -> Result<(), String> {
            self.0.put(i, s)
        }
        fn get(&self, i: &str) -> Result<Option<Vec<u8>>, String> {
            self.0.get(i)
        }
        fn delete(&self, i: &str) -> Result<(), String> {
            self.0.delete(i)
        }
    }
    let host = HostService::new(
        dir.clone(),
        vec![],
        "0.4.0",
        Some(std::sync::Arc::new(|_: &str| {
            std::sync::Arc::new(Offline)
                as std::sync::Arc<dyn crate::workspace::hosts::connector::Gateway>
        })),
        std::sync::Arc::new(move || Box::new(Same(keys.clone())) as Box<dyn KeyStore>),
        None,
    );
    let (stop, _stopped) = tokio::sync::mpsc::unbounded_channel();
    runtime().spawn(control::serve(dir.clone(), host.clone(), stop));
    while !control::paths(&dir).1.exists() {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    cx.update(|_, cx| {
        crate::features::hosts::host_link(cx).update(cx, |l, _| l.use_dir(dir.clone()))
    });
    // From the Homepage: "Open on my other computers".
    view.update_in(cx, |s, w, cx| {
        s.cloud
            .update(cx, |c, cx| c.request_device_sharing(folder.clone(), w, cx))
    });
    settle_cloud(&view, cx, "the host", &|_, cx| {
        crate::features::hosts::read_link(cx).is_some_and(|l| l.status.is_some())
    });
    view.read_with(cx, |s, cx| {
        assert!(
            s.cloud
                .read(cx)
                .dialog_open(crate::app::dialogs::DialogKey::HostSharing, cx)
        )
    });
    // Asked first; then registered, without its path.
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.sharing_press("share", cx))
    });
    view.read_with(cx, |s, cx| {
        assert!(s.cloud.read(cx).sharing_state().unwrap().0, "asked first")
    });
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.sharing_press("allow", cx))
    });
    let shared = |s: &Shell, cx: &App| {
        s.prefs
            .store
            .read(cx)
            .state
            .recent_projects
            .iter()
            .find(|p| p.path == folder)
            .and_then(|p| p.host_folder.clone())
    };
    settle_cloud(&view, cx, "the share", &|s, cx| {
        shared(s, cx).is_some()
            && crate::features::hosts::read_link(cx)
                .and_then(|l| l.status.as_ref())
                .is_some_and(|st| st.folders.len() == 1)
    });
    let id = view.read_with(cx, |s, cx| shared(s, cx).unwrap());
    view.read_with(cx, |s, cx| {
        assert!(
            s.cloud.read(cx).sharing_state().is_none(),
            "the dialog closed"
        );
        let audience = s.cloud.read(cx).devices_audience(&folder, cx).unwrap();
        assert!(audience.on);
    });
    assert!(
        asked
            .lock()
            .unwrap()
            .iter()
            .any(|a| a == &format!("POST /hosts/devices/{DEVICE}/folders"))
    );
    // Editing, then a terminal: each asked before it widens.
    view.update_in(cx, |s, w, cx| {
        s.cloud.update(cx, |c, cx| {
            c.device_settings(id.clone(), &folder, false, w, cx)
        })
    });
    view.update(cx, |s, cx| {
        s.cloud
            .update(cx, |c, cx| c.sharing_set(true, Execution::default(), cx))
    });
    view.read_with(cx, |s, cx| {
        assert!(s.cloud.read(cx).sharing_state().unwrap().0, "asked first")
    });
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.sharing_press("allow", cx))
    });
    let folder_now = |cx: &App| {
        crate::features::hosts::read_link(cx)
            .and_then(|l| l.status.as_ref())
            .and_then(|s| s.folders.first().cloned())
    };
    settle_cloud(&view, cx, "editing", &|_, cx| {
        folder_now(cx).is_some_and(|f| f.writable)
    });
    let terminal = Execution {
        terminal: true,
        ..Default::default()
    };
    view.update(cx, |s, cx| {
        s.cloud
            .update(cx, |c, cx| c.sharing_set(true, terminal, cx))
    });
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.sharing_press("allow", cx))
    });
    settle_cloud(&view, cx, "the terminal", &|_, cx| {
        folder_now(cx).is_some_and(|f| f.execution.terminal)
    });
    assert!(
        asked
            .lock()
            .unwrap()
            .iter()
            .any(|a| a.starts_with("PATCH "))
    );
    // Each change is for the folder as the Cloud has it: its revision.
    assert!(asked.lock().unwrap().iter().any(|a| a == "GET /hosts"));
    // Stopping, after one more yes: no longer offered, no longer marked.
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.sharing_press("stop", cx))
    });
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, cx| c.sharing_press("allow", cx))
    });
    settle_cloud(&view, cx, "the stop", &|s, cx| {
        shared(s, cx).is_none() && folder_now(cx).is_none()
    });
    assert!(
        asked
            .lock()
            .unwrap()
            .iter()
            .any(|a| a.starts_with("DELETE "))
    );
    host.dispose();
}
