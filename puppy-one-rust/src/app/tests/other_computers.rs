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
    cx.update(|_, cx| crate::features::cloud::account::install_fixture(broker, browser, cx));
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.cloud_workspace = true;
            p.state.experimental.host_devices = true;
        });
    });
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
