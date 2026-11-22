#![cfg(test)]
use super::*;

struct Owner;
impl Render for Owner {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

#[gpui::test]
fn current_version_prompts_once_without_starting_an_update(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![(
        feed_file("stable"),
        feed_for("1.4.0", b"not downloaded"),
    )]);
    let updates = Fixture::new(&feed, build_identity::Channel::Stable, "1.4.0", true, cx);
    let window = cx.add_window(|_, _| Owner);
    cx.update(|cx| {
        cx.set_global(Service(updates.clone()));
        check_from_menu(window.into(), "puppyone", cx);
    });
    settle(&updates, cx, |u| !u.busy);
    cx.run_until_parked();
    let (message, detail) = cx
        .pending_prompt()
        .expect("an up-to-date check must answer");
    assert_eq!(
        message,
        tf(
            "native.update.manual.current.message",
            &[("appName", "puppyone".into())]
        )
    );
    assert!(detail.contains("1.4.0"));
    cx.simulate_prompt_answer(t("native.update.manual.ok"));
    assert!(!cx.has_pending_prompt());
    assert_eq!(feed.requests(), [feed_path("stable")]);
    assert_eq!(updates.quits(cx), 0);
    assert!(!updates.root.path().join("downloads").exists());
}

#[gpui::test]
fn actionable_and_cancelled_restart_states_keep_menu_checks_quiet(cx: &mut gpui::TestAppContext) {
    cx.executor().allow_parking();
    let feed = Feed::new(vec![]);
    let updates = Fixture::new(&feed, build_identity::Channel::Stable, "1.4.0", false, cx);
    let window = cx.add_window(|_, _| Owner);
    cx.update(|cx| cx.set_global(Service(updates.clone())));
    for (status, cancelled) in [
        (Status::Available, false),
        (Status::Downloading, false),
        (Status::Downloaded, false),
        (Status::Installing, false),
        (Status::Installing, true),
    ] {
        updates.update(cx, |u, cx| {
            u.publish(
                |state| {
                    state.status = status;
                    state.available_version = Some("1.5.0".into());
                },
                cx,
            );
            if cancelled {
                u.restart_requested = true;
                u.quit_cancelled(cx);
            }
        });
        cx.update(|cx| check_from_menu(window.into(), "puppyone", cx));
        cx.run_until_parked();
        assert!(
            !cx.has_pending_prompt(),
            "{status:?}, cancelled={cancelled}"
        );
    }
    assert!(feed.requests().is_empty());
    assert_eq!(updates.quits(cx), 0);
}

#[gpui::test]
fn stale_candidates_have_current_version_presentation_and_no_update_command(
    cx: &mut gpui::TestAppContext,
) {
    let mut state = UpdateState::new(build_identity::Channel::Stable, "1.4.0".into(), None, false);
    state.status = Status::Available;
    state.available_version = Some("1.3.9".into());
    let prompt = presentation(&state, "puppyone");
    assert_eq!(
        prompt.message,
        tf(
            "native.update.manual.current.message",
            &[("appName", "puppyone".into())]
        )
    );
    assert!(prompt.detail.contains("1.4.0"));
    assert!(matches!(prompt.level, PromptLevel::Info));
    let window = cx.add_window(|_, _| Owner);
    cx.update(|cx| show(window.into(), prompt, cx));
    cx.simulate_prompt_answer(t("native.update.manual.ok"));
    assert!(!cx.has_pending_prompt());
    // The actual menu callback also normalizes a stale service snapshot
    // before deciding whether a passive update should suppress its prompt.
    let feed = Feed::new(vec![]);
    let updates = Fixture::new(&feed, build_identity::Channel::Stable, "1.4.0", false, cx);
    updates.update(cx, |u, _| u.state = state);
    cx.update(|cx| {
        cx.set_global(Service(updates.clone()));
        check_from_menu(window.into(), "puppyone", cx);
    });
    cx.run_until_parked();
    assert!(cx.pending_prompt().unwrap().1.contains("1.4.0"));
    cx.simulate_prompt_answer(t("native.update.manual.ok"));
    assert!(feed.requests().is_empty());
    assert_eq!(updates.quits(cx), 0);
}

#[gpui::test]
fn absent_disabled_and_failed_services_report_an_honest_acknowledgement(
    cx: &mut gpui::TestAppContext,
) {
    cx.executor().allow_parking();
    let window = cx.add_window(|_, _| Owner);
    cx.update(|cx| check_from_menu(window.into(), "PuppyOne Development", cx));
    assert_eq!(
        cx.pending_prompt().unwrap().0,
        tf(
            "native.update.manual.unavailable.message",
            &[("appName", "PuppyOne Development".into())]
        )
    );
    cx.simulate_prompt_answer(t("native.update.manual.ok"));
    let feed = Feed::new(vec![]);
    let updates = service(&feed, true, cx);
    updates.update(cx, |u, _| {
        u.state = UpdateState::new(
            build_identity::Channel::Dev,
            "0.4.4-dev.ga".into(),
            Some("disabled fixture".into()),
            true,
        )
    });
    cx.update(|cx| {
        cx.set_global(Service(updates.clone()));
        check_from_menu(window.into(), "PuppyOne Development", cx);
    });
    cx.run_until_parked();
    assert_eq!(
        cx.pending_prompt().unwrap().0,
        tf(
            "native.update.manual.unavailable.message",
            &[("appName", "PuppyOne Development".into())]
        )
    );
    cx.simulate_prompt_answer(t("native.update.manual.ok"));
    assert!(feed.requests().is_empty());
    updates.update(cx, |u, _| {
        u.state = UpdateState::new(
            build_identity::Channel::Dev,
            "0.4.4-dev.ga".into(),
            None,
            true,
        )
    });
    cx.update(|cx| check_from_menu(window.into(), "puppyone", cx));
    settle(&updates, cx, |u| !u.busy);
    cx.run_until_parked();
    let (_, detail) = cx.pending_prompt().expect("failed check must answer");
    assert!(detail.contains("404"), "{detail}");
    cx.simulate_prompt_answer(t("native.update.manual.ok"));
    assert!(!cx.has_pending_prompt());
    assert_eq!(updates.quits(cx), 0);
}
