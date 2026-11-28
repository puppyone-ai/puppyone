//! `CloudSignInDialog` (`v4.html`): bare "Sign in" controls in the Header and
//! Place menu open the 2-moment explainer before starting browser OAuth, while
//! dismissals leave OAuth untouched and completion closes the dialog.
use super::*;
use crate::cloud::auth::{Error as AuthError, SignInControl, sign_in_fixture};
use crate::features::cloud::account::{self, Status};
use core::prelude::v1::test;
use std::{sync::Arc, time::Duration};

struct LocaleGuard;
impl Drop for LocaleGuard {
    fn drop(&mut self) {
        crate::localization::set_current("en");
    }
}

fn signed_out_shell(
    cx: &mut TestAppContext,
) -> (Entity<Shell>, &mut VisualTestContext, Arc<SignInControl>) {
    let (view, cx) = setup(cx);
    let (broker, browser, control) = sign_in_fixture();
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| account::install_fixture(broker, browser, cx));
    settle_cloud(&view, cx, "signed-out account", &|_, cx| {
        account::status(cx) == Some(Status::SignedOut)
    });
    draw(cx);
    (view, cx, control)
}

fn click_selector(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("missing selector `{selector}`"));
    cx.simulate_click(bounds.center(), Modifiers::none());
    draw(cx);
}

#[gpui::test]
fn header_sign_in_opens_explainer_switches_moments_and_completes_oauth(cx: &mut TestAppContext) {
    let (view, cx, control) = signed_out_shell(cx);
    assert!(cx.debug_bounds("header-sign-in").is_some());
    assert_eq!(control.starts(), 0);

    click_selector(cx, "header-sign-in");
    draw(cx);
    assert_eq!(control.starts(), 0);
    assert!(cx.debug_bounds("cloud-sign-in-dialog").is_some());
    assert!(cx.debug_bounds("cloud-sign-in-carousel").is_some());
    view.update_in(cx, |s, w, cx| {
        assert!(s.has_dialog("SignIn", cx));
        let dialog = s
            .cloud
            .read(cx)
            .sign_in
            .as_ref()
            .expect("sign-in dialog state");
        assert!(dialog.primary_focused(w));
        assert_eq!(dialog.active_moment(), "cloud");
        assert_eq!(
            dialog.active_title(),
            "Keep it in Cloud,\nevery Agent can reach it"
        );
        assert_eq!(
            dialog.active_body(),
            "Claude and ChatGPT reach it directly,\nand it opens on your phone anytime."
        );
    });

    {
        let _guard = LocaleGuard;
        crate::localization::set_current("zh-Hans");
        view.read_with(cx, |s, cx| {
            let dialog = s.cloud.read(cx).sign_in.as_ref().unwrap();
            assert_eq!(dialog.active_title(), "放在云上，\n所有 Agent 都能用");
            assert_eq!(
                dialog.active_body(),
                "Claude、ChatGPT 直接访问，\n手机上也能随时打开。"
            );
        });
    }

    // Clicking the second dot switches to the Grok Bot link-handoff moment;
    // leaving the carousel lets 5s wrap to cloud and 4s return to share, while
    // hovering pauses auto-play.
    click_selector(cx, "cloud-sign-in-dot-share");
    view.read_with(cx, |s, cx| {
        let dialog = s.cloud.read(cx).sign_in.as_ref().unwrap();
        assert_eq!(dialog.active_moment(), "share");
        assert_eq!(dialog.active_title(), "One link,\nfor anyone or any Agent");
    });
    {
        let _guard = LocaleGuard;
        crate::localization::set_current("zh-Hans");
        view.read_with(cx, |s, cx| {
            let dialog = s.cloud.read(cx).sign_in.as_ref().unwrap();
            assert_eq!(
                dialog.active_body(),
                "发短信给同事，或发给 Grok\u{00a0}Bot，\n点开就能看、能接着改。"
            );
        });
    }
    cx.simulate_mouse_move(point(px(10.), px(10.)), None, Modifiers::none());
    draw(cx);
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, _| {
            c.sign_in
                .as_mut()
                .unwrap()
                .advance_for_test(Duration::from_secs(5));
        });
    });
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.cloud.read(cx).sign_in.as_ref().unwrap().active_moment(),
            "cloud"
        );
    });
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, _| {
            c.sign_in
                .as_mut()
                .unwrap()
                .advance_for_test(Duration::from_secs(4));
        });
    });
    let carousel = cx
        .debug_bounds("cloud-sign-in-carousel")
        .expect("carousel bounds");
    cx.simulate_mouse_move(carousel.center(), None, Modifiers::none());
    draw(cx);
    view.update(cx, |s, cx| {
        s.cloud.update(cx, |c, _| {
            let dialog = c.sign_in.as_mut().unwrap();
            dialog.advance_for_test(Duration::from_secs(10));
            assert_eq!(dialog.active_moment(), "share");
        });
    });

    // Submitting starts browser OAuth and shows the waiting status indicator.
    click_selector(cx, "cloud-sign-in-primary");
    settle_cloud(&view, cx, "browser sign-in start", &|_, cx| {
        control.starts() == 1 && account::status(cx) == Some(Status::SigningIn)
    });
    assert!(cx.debug_bounds("cloud-sign-in-status").is_some());
    view.read_with(cx, |s, cx| assert!(s.has_dialog("SignIn", cx)));

    // Completing browser sign-in automatically dismisses the explainer.
    control.complete("alice");
    settle_cloud(&view, cx, "account completion", &|s, cx| {
        account::has_account(cx) && !s.has_dialog("SignIn", cx)
    });
    assert!(cx.debug_bounds("cloud-sign-in-dialog").is_none());
    assert!(cx.debug_bounds("header-sign-in").is_none());
}

#[gpui::test]
fn project_menu_sign_in_opens_explainer_and_dismissals_never_start_oauth(cx: &mut TestAppContext) {
    let (view, cx, control) = signed_out_shell(cx);

    command(&view, cx, Command::ProjectMenu);
    draw(cx);
    draw(cx);
    let label = crate::localization::t("cloud.auth.signIn");
    let item_selector: &'static str = Box::leak(format!("menu-item:{label}").into_boxed_str());
    click_selector(cx, item_selector);
    view.read_with(cx, |s, cx| {
        assert!(s.chrome.read(cx).popover.is_none());
        assert!(s.has_dialog("SignIn", cx));
    });
    assert_eq!(control.starts(), 0);

    // "Maybe later" dismisses without touching OAuth.
    click_selector(cx, "cloud-sign-in-later");
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("SignIn", cx)));
    assert_eq!(control.starts(), 0);

    // Top-right close button dismisses without touching OAuth.
    click_selector(cx, "header-sign-in");
    view.read_with(cx, |s, cx| assert!(s.has_dialog("SignIn", cx)));
    click_selector(cx, "cloud-sign-in-close");
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("SignIn", cx)));
    assert_eq!(control.starts(), 0);

    // Escape dismisses without touching OAuth.
    click_selector(cx, "header-sign-in");
    view.read_with(cx, |s, cx| assert!(s.has_dialog("SignIn", cx)));
    command(&view, cx, Command::Escape);
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("SignIn", cx)));
    assert_eq!(control.starts(), 0);

    // Pressing the popup body keeps the dialog open; pressing the backdrop closes it.
    click_selector(cx, "header-sign-in");
    let surface = cx
        .debug_bounds("cloud-sign-in-dialog")
        .expect("dialog surface bounds");
    cx.simulate_click(
        point(surface.origin.x + px(8.), surface.origin.y + px(8.)),
        Modifiers::none(),
    );
    draw(cx);
    view.read_with(cx, |s, cx| assert!(s.has_dialog("SignIn", cx)));
    cx.simulate_click(point(px(6.), px(6.)), Modifiers::none());
    draw(cx);
    view.read_with(cx, |s, cx| assert!(!s.has_dialog("SignIn", cx)));
    assert_eq!(control.starts(), 0);
}

#[gpui::test]
fn oauth_failure_surfaces_error_in_dialog_and_allows_retry(cx: &mut TestAppContext) {
    let (view, cx, control) = signed_out_shell(cx);

    click_selector(cx, "header-sign-in");
    assert!(cx.debug_bounds("cloud-sign-in-error").is_none());

    click_selector(cx, "cloud-sign-in-primary");
    settle_cloud(&view, cx, "first sign-in attempt", &|_, _| {
        control.starts() == 1
    });

    control.fail(AuthError::NoProviders);
    settle_cloud(&view, cx, "sign-in failure", &|_, cx| {
        account::snapshot(cx).is_some_and(|s| s.status == Status::SignedOut && s.error.is_some())
    });
    view.read_with(cx, |s, cx| assert!(s.has_dialog("SignIn", cx)));
    assert!(cx.debug_bounds("cloud-sign-in-status").is_none());
    assert!(cx.debug_bounds("cloud-sign-in-error").is_some());

    // Retrying from the primary button starts a fresh OAuth attempt.
    control.hold();
    click_selector(cx, "cloud-sign-in-primary");
    settle_cloud(&view, cx, "retry sign-in attempt", &|_, cx| {
        control.starts() == 2 && account::status(cx) == Some(Status::SigningIn)
    });
    assert!(cx.debug_bounds("cloud-sign-in-status").is_some());
    assert!(cx.debug_bounds("cloud-sign-in-error").is_none());

    control.complete("alice");
    settle_cloud(&view, cx, "account completion after retry", &|s, cx| {
        account::has_account(cx) && !s.has_dialog("SignIn", cx)
    });
}
