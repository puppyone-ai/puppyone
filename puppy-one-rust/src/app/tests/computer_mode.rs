//! Computer Mode (`computerModeHomepageAndDialog.test.tsx`): this computer's
//! computers on the Homepage with the plain folders kept last, a computer
//! made on this computer, and the screen of the computer a window shows.
use super::*;
use core::prelude::v1::test;

/// Computer Mode on (no account), `folders` remembered, `computers` of them
/// registered, the Homepage up.
fn computer_home<'a>(
    cx: &'a mut TestAppContext,
    folders: &[&std::path::Path],
    computers: &[&std::path::Path],
) -> (Entity<Shell>, &'a mut VisualTestContext) {
    let (view, cx) = setup(cx);
    view.update(cx, |s, cx| {
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.prefs.store.update(cx, |p, _| {
            p.state.experimental.computer_mode = true;
            p.state.experimental.home_space_layout =
                crate::features::settings::HomeSpaceLayout::Classic;
            for (i, folder) in folders.iter().enumerate() {
                p.state.remember_project(folder, i as u64 + 1);
            }
        });
        let local = crate::features::computer_mode::global(&s.prefs.store, cx);
        for computer in computers {
            local.update(cx, |c, cx| c.register(computer, None, cx));
        }
    });
    command(&view, cx, Command::Home);
    settle_cloud(&view, cx, "the Homepage list", &|s, cx| {
        !s.home.read(cx).list_held()
    });
    draw(cx);
    (view, cx)
}

/// A registered folder is one of this computer's computers; the others are
/// plain folders, last, and fold away.
#[gpui::test]
fn computer_mode_shows_this_computers_computers_and_keeps_plain_folders_last(
    cx: &mut TestAppContext,
) {
    let temp = tempfile::tempdir().unwrap();
    let lab = temp.path().canonicalize().unwrap().join("Lab");
    let notes = temp.path().canonicalize().unwrap().join("Notes");
    for dir in [&lab, &notes] {
        std::fs::create_dir(dir).unwrap();
    }
    let (view, cx) = computer_home(cx, &[&lab, &notes], &[&lab]);
    let groups = view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        home.project_groups_now(home.visible_projects(cx), cx)
    });
    assert_eq!(
        groups.iter().map(|g| g.id.key()).collect::<Vec<_>>(),
        ["local-computers", "plain-folders"]
    );
    assert_eq!(groups[0].items[0].label, "Lab");
    assert!(groups[0].create);
    assert_eq!(groups[1].items[0].label, "Notes");
    assert!(cx.debug_bounds("home-group:local-computers").is_some());
    assert!(cx.debug_bounds("home-new-computer").is_some());
    // The plain folders fold away and come back.
    let toggle = cx.debug_bounds("home-plain-folders-toggle").unwrap();
    cx.simulate_click(toggle.center(), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.home.read(cx).plain_folders_closed));
    cx.simulate_click(toggle.center(), Modifiers::default());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(!s.home.read(cx).plain_folders_closed));
    // Turned off, the Homepage lists folders by place again.
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.computer_mode = false)
    });
    let keys = view.read_with(cx, |s, cx| {
        let home = s.home.read(cx);
        home.project_groups_now(home.visible_projects(cx), cx)
            .iter()
            .map(|g| g.id.key())
            .collect::<Vec<_>>()
    });
    assert_eq!(keys, ["local-only"]);
}

/// "Create a computer" on this computer makes the folder, registers it as
/// a running computer and opens it; the window's screen shows that computer,
/// a workspace with no desktop yet.
#[gpui::test]
fn a_computer_made_on_this_computer_is_registered_and_opens_with_its_screen(
    cx: &mut TestAppContext,
) {
    use super::home::create_project::Audience;
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path().canonicalize().unwrap();
    let old = parent.join("Old notes");
    std::fs::create_dir(&old).unwrap();
    let (view, cx) = computer_home(cx, &[&old], &[]);
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| {
            h.begin_create_project(w, cx);
            let create = h.create.as_mut().unwrap();
            // No account: the computer runs on this computer.
            assert!(create.computer);
            assert_eq!(create.audience, Audience::Local);
            assert!(
                create
                    .destination
                    .name
                    .read(cx)
                    .text()
                    .starts_with(crate::localization::t(
                        "onboarding.computerMode.dialog.defaultName"
                    ))
            );
            create.destination.location = Some(parent.clone());
            create
                .destination
                .name
                .update(cx, |input, cx| input.set_text("Lab 1".to_owned(), cx));
        })
    });
    draw(cx);
    assert!(cx.debug_bounds("create-computer:on-device").is_some());
    view.update_in(cx, |s, w, cx| {
        s.home.update(cx, |h, cx| h.submit_create_project(w, cx))
    });
    let made = parent.join("Lab 1");
    let record = cx.update(|_, cx| {
        crate::features::computer_mode::read(cx)
            .unwrap()
            .for_path(&made)
    });
    let record = record.expect("the new folder is a computer");
    assert_eq!(record.name, "Lab 1");
    assert_eq!(
        record.status,
        crate::platform::local_computers::Status::Running
    );
    settle_cloud(&view, cx, "the new computer's window", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(made.as_path())
            && s.cloud.read(cx).screen.read(cx).local_for_test().is_some()
    });
    view.read_with(cx, |s, cx| {
        let screen = s.cloud.read(cx).screen.read(cx);
        assert_eq!(
            screen.local_for_test().map(|r| r.id.clone()),
            Some(record.id.clone())
        );
        // A workspace, and nothing here to give it a desktop.
        assert_eq!(
            screen.local_screen_for_test(cx),
            Some(crate::features::computer_mode::Screen::Workspace { can_start: false })
        );
    });
}
