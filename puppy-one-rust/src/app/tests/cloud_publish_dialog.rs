//! The folder's first publication as its dialog draws it
//! (`CloudLocalOnlyWorkspace`, `CloudGitPrerequisite`, `CloudPublishProgress`),
//! through the production text layout: what each state says and offers.
use super::*;
use crate::cloud::publication::{
    Action, Code,
    fixtures::{Fake, coordinator},
};
use crate::features::cloud::publish_states::{saved, state};
use crate::localization::t as tr;
use crate::test_support::RecordingText;
use crate::workspace::cloud::publish::{Action as A, Cleanup, Push};
use core::prelude::v1::test;
use gpui::TestDispatcher;
use std::sync::Arc;

fn painted(text: &RecordingText) -> String {
    text.0.lock().unwrap().join("\n")
}
/// A signed-in window on a committed folder with one organization, its
/// publication's dialog open on the first page.
fn with_publish_dialog(test: impl FnOnce(&Entity<Shell>, &mut VisualTestContext, &RecordingText)) {
    let text = Arc::new(RecordingText::default());
    let mut app =
        TestAppContext::build_with_text_system(TestDispatcher::new(0), None, text.clone());
    app.update(gpui_kit::init);
    let (temp, fake) = Fake::new();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("a.md"), "# A\n").unwrap();
    for args in [
        &["init", "-q", "-b", "main"][..],
        &["add", "."],
        &[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.test",
            "commit",
            "-qm",
            "first",
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
    let (view, cx) = setup(&mut app);
    let responder: crate::cloud::auth::Responder = Arc::new(|request| {
        if request.path.ends_with("/organizations/") {
            return Ok(serde_json::json!({"code": 0, "data": [{"id": "org-1", "name": "Mine"}]}));
        }
        cloud_project_responder()(request)
    });
    let (broker, browser) = crate::cloud::auth::responding_account_fixture(responder);
    view.update(cx, |s, cx| {
        s.prefs
            .store
            .update(cx, |p, _| p.state.experimental.cloud_workspace = true)
    });
    cx.update(|_, cx| {
        crate::features::cloud::account::install_fixture(broker, browser, cx);
        let fake = fake.clone();
        crate::features::cloud::install_factory(Arc::new(move |_, _| coordinator(&fake).0), cx);
    });
    settle_cloud(&view, cx, "sign-in", &|_, cx| {
        crate::features::cloud::account::has_account(cx)
    });
    view.update(cx, |s, cx| {
        s.session
            .docs
            .update(cx, |d, _| d.begin(Intent::OpenFolder(root.clone())))
    });
    settle_cloud(&view, cx, "the folder", &|s, cx| {
        s.workspace_root(cx).as_deref() == Some(root.as_path())
    });
    view.update_in(cx, |s, w, cx| {
        s.cloud.update(cx, |c, cx| c.put_in_cloud(w, cx))
    });
    settle_cloud(&view, cx, "the organization", &|s, cx| {
        s.cloud.read(cx).publish.read(cx).selected.as_deref() == Some("org-1")
    });
    draw(cx);
    test(&view, cx, &text);
    drop(temp);
}
/// Draws the window; what it has said so far (text already laid out in the
/// frame before is not laid out again).
fn redraw(cx: &mut VisualTestContext, text: &RecordingText) -> String {
    draw(cx);
    painted(text)
}
fn shown(cx: &mut VisualTestContext, selector: &'static str) -> bool {
    cx.debug_bounds(selector).is_some()
}
fn publish(
    view: &Entity<Shell>,
    cx: &mut VisualTestContext,
    change: impl FnOnce(&mut crate::features::cloud::CloudPublish),
) {
    view.update(cx, |s, cx| {
        s.cloud.read(cx).publish.clone().update(cx, |p, cx| {
            change(p);
            cx.notify();
        })
    });
}

/// `putting a local folder in the Cloud`, `simple Cloud publish onboarding`:
/// the first page states what the Cloud project gives before offering one
/// action; the confirmation says it is a separate project made from the
/// folder's tracked files and who will see it, and only Confirm starts it.
#[test]
fn the_first_page_states_the_value_and_the_confirmation_a_separate_project() {
    with_publish_dialog(|view, cx, text| {
        let first = redraw(cx, text);
        assert!(shown(cx, "publish-upload") && shown(cx, "publish-not-now"));
        for key in [
            "cloud.activation.project.agents",
            "cloud.activation.project.teammates",
            "cloud.activation.project.history",
            "cloud.activation.project.publish",
        ] {
            assert!(first.contains(tr(key)), "{key}");
        }
        view.update(cx, |s, cx| {
            s.cloud
                .update(cx, |c, cx| c.open_dialog(DialogKey::ConfirmPublish, cx))
        });
        let confirmation = redraw(cx, text);
        for key in [
            "cloud.initialize.committedScopeNote",
            "cloud.initialize.spaceVisibilityNote",
            "cloud.common.confirm",
        ] {
            assert!(confirmation.contains(tr(key)), "{key}");
        }
        view.read_with(cx, |s, cx| {
            assert!(
                s.cloud.read(cx).publish.read(cx).running.is_none(),
                "nothing started yet"
            )
        });
    });
}

/// `Cloud initialization render contract`: an unfinished publication is the
/// progress standing still with exactly Discard and Retry; Discard asks
/// first with Cancel; an unfinished discard says so and offers only Discard,
/// with no send steps, and says Discarding while it runs; a refused discard
/// offers sending again and no Discard; a run in flight draws its step.
#[test]
fn every_saved_state_says_where_it_stopped_and_offers_only_its_choices() {
    with_publish_dialog(|view, cx, text| {
        publish(view, cx, |p| {
            p.outcome = Some(saved(
                state(
                    Push::Failed,
                    Cleanup::None,
                    &[A::RetryPush, A::DeleteEmptyProject],
                ),
                None,
            ))
        });
        let paused = redraw(cx, text);
        assert!(paused.contains(tr("cloud.initialize.progress.paused")));
        assert!(paused.contains(tr("cloud.initialize.resume.continue")));
        assert!(shown(cx, "publish-progress"));
        assert!(shown(cx, "publish-discard") && shown(cx, "publish-retry"));
        assert!(!shown(cx, "publish-upload") && !shown(cx, "publish-not-now"));
        publish(view, cx, |p| p.confirming_discard = true);
        let asking = redraw(cx, text);
        assert!(asking.contains(tr("cloud.initialize.resume.abandonTitle")));
        assert!(shown(cx, "publish-discard-cancel") && shown(cx, "publish-discard-confirm"));
        assert!(!shown(cx, "publish-discard"));
        publish(view, cx, |p| p.confirming_discard = false);
        redraw(cx, text);
        assert!(!shown(cx, "publish-discard-confirm") && shown(cx, "publish-discard"));

        publish(view, cx, |p| {
            p.outcome = Some(saved(
                state(Push::Failed, Cleanup::Failed, &[A::FinishCleanup]),
                Some((Code::CleanupFailed, true)),
            ))
        });
        let discarding = redraw(cx, text);
        assert!(discarding.contains(tr("cloud.initialize.resume.cleanupTitle")));
        assert!(discarding.contains(tr("cloud.initialize.cleanupFailed")));
        assert!(shown(cx, "publish-finish-cleanup"));
        assert!(!shown(cx, "publish-retry") && !shown(cx, "publish-progress"));
        publish(view, cx, |p| p.reading = true);
        assert!(redraw(cx, text).contains(tr("cloud.initialize.resume.discarding")));
        publish(view, cx, |p| p.reading = false);

        publish(view, cx, |p| {
            p.outcome = Some(saved(
                state(Push::Failed, Cleanup::None, &[A::RetryPush]),
                Some((Code::CleanupNotAllowed, false)),
            ))
        });
        let refused = redraw(cx, text);
        assert!(refused.contains(tr("cloud.initialize.cleanupNotAllowed")));
        assert!(shown(cx, "publish-retry"));
        assert!(!shown(cx, "publish-discard") && !shown(cx, "publish-finish-cleanup"));

        publish(view, cx, |p| {
            p.outcome = None;
            p.running = Some(crate::cloud::publication::Stage::Uploading);
        });
        let running = redraw(cx, text);
        assert!(running.contains(tr("cloud.initialize.progress.uploading")));
        assert!(shown(cx, "publish-progress") && shown(cx, "publish-hide"));
        assert!(!shown(cx, "publish-retry"));
        publish(view, cx, |p| p.running = None);
    });
}

/// `forwards organization selection, retry, and push intents`: the
/// confirmed first publication runs for the chosen organization and ends
/// published, the folder staying the open project.
#[test]
fn confirming_runs_the_publication_for_the_chosen_space() {
    with_publish_dialog(|view, cx, _| {
        publish(view, cx, |_| {});
        view.update(cx, |s, cx| {
            s.cloud
                .read(cx)
                .publish
                .clone()
                .update(cx, |p, cx| p.start(Action::Initialize, cx))
        });
        settle_cloud(view, cx, "the publication", &|s, cx| {
            s.cloud.read(cx).publish.read(cx).published.is_some()
        });
    });
}
