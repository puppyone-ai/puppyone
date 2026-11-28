//! `approvals.test.ts`: the approval dock.
use super::*;
use core::prelude::v1::test;
use gpui::{Modifiers, TestAppContext, VisualTestContext};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::rc::Rc;

fn approval(fields: Value) -> Approval {
    let mut value = json!({"requestId": "req-1", "turnId": "turn-1", "itemId": "item-1", "kind": "command",
        "title": "Run npm test", "command": null, "cwd": null, "commandActions": [], "networkApprovalContext": null,
        "grantRoot": null, "policyChangeRequested": false, "reason": null,
        "availableDecisions": ["accept", "decline", "cancel"], "sequence": 1});
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    serde_json::from_value(value).unwrap()
}

type Decisions = Rc<RefCell<Vec<&'static str>>>;

fn setup(cx: &mut TestAppContext) -> (Entity<DocksView>, Decisions, &mut VisualTestContext) {
    cx.update(gpui_kit::init);
    crate::localization::set_current("en");
    let (view, cx) = cx.add_window_view(|_, _| DocksView::default());
    let decisions: Decisions = Rc::default();
    let seen = decisions.clone();
    view.update(cx, |_, cx| {
        cx.subscribe(&cx.entity(), move |_, _, event: &DockEvent, _| {
            if let DockEvent::Approve { decision, .. } = event {
                seen.borrow_mut().push(decision);
            }
        })
        .detach()
    });
    (view, decisions, cx)
}

fn show(
    view: &Entity<DocksView>,
    cx: &mut VisualTestContext,
    approval: Approval,
    approvals: usize,
    resolving: bool,
) {
    view.update(cx, |v, cx| {
        v.set_input(
            DocksInput {
                approval: Some(approval),
                approvals,
                approval_resolving: resolving,
                runtime_label: "Codex".into(),
                ..Default::default()
            },
            cx,
        )
    });
    cx.update(|window, cx| window.draw(cx).clear(cx));
}

fn leak(text: String) -> &'static str {
    Box::leak(text.into_boxed_str())
}

fn press(cx: &mut VisualTestContext, decision: &str) {
    let at = cx
        .debug_bounds(leak(format!("agent-approval:{decision}")))
        .unwrap()
        .center();
    cx.simulate_click(at, Modifiers::default());
}

/// `disables approval actions while a decision is resolving`; `keeps
/// approval copy concise and preserves every provider decision`; `shows the
/// queue count instead of a redundant waiting label`; `renders material
/// network and filesystem approval scope`.
#[gpui::test]
fn the_approval_dock_offers_every_decision_once_and_states_its_scope(cx: &mut TestAppContext) {
    let (view, decisions, cx) = setup(cx);
    show(
        &view,
        cx,
        approval(json!({"command": "npm test", "cwd": "/workspace"})),
        1,
        true,
    );
    assert!(
        cx.debug_bounds("agent-approval-status:Submitting…")
            .is_some()
    );
    for decision in ["decline", "accept"] {
        press(cx, decision);
    }
    assert!(decisions.borrow().is_empty(), "nothing while resolving");
    let repeated = "Web search: early collaborative editor launch history";
    show(
        &view,
        cx,
        approval(
            json!({"requestId": "req-search", "title": repeated, "reason": format!("  {repeated}  "),
            "availableDecisions": ["accept", "acceptForSession", "decline", "cancel"]}),
        ),
        1,
        false,
    );
    assert!(
        cx.debug_bounds(leak(format!("agent-approval-title:{repeated}")))
            .is_some()
    );
    assert!(
        cx.debug_bounds(leak(format!("agent-approval-detail:{repeated}")))
            .is_none(),
        "a reason that repeats the title is not shown twice"
    );
    assert!(
        cx.debug_bounds("agent-approval-status:Needs your approval")
            .is_some()
    );
    for decision in ["decline", "acceptForSession", "accept"] {
        press(cx, decision);
    }
    assert_eq!(
        *decisions.borrow(),
        ["decline", "acceptForSession", "accept"]
    );
    show(
        &view,
        cx,
        approval(json!({"requestId": "req-queue", "title": "Search the web"})),
        3,
        false,
    );
    assert!(cx.debug_bounds("agent-approval-status:3 pending").is_some());
    assert!(cx.debug_bounds("agent-approval:acceptForSession").is_none());
    show(
        &view,
        cx,
        approval(
            json!({"requestId": "req-network", "title": "Allow network access", "cwd": "/workspace",
            "networkApprovalContext": {"host": "registry.npmjs.org:443", "protocol": "https"},
            "grantRoot": "/workspace/generated", "policyChangeRequested": true, "reason": "Download a package"}),
        ),
        1,
        false,
    );
    for detail in [
        "https://registry.npmjs.org:443",
        "/workspace/generated",
        "Download a package",
    ] {
        assert!(
            cx.debug_bounds(leak(format!("agent-approval-detail:{detail}")))
                .is_some(),
            "{detail}"
        );
    }
    let policy = crate::localization::tf(
        "agent.approval.policyNote",
        &[(
            "agent",
            crate::localization::Arg::Text(crate::localization::bidi_isolate("Codex")),
        )],
    );
    assert!(policy.contains("reusable policy change"));
    assert!(
        cx.debug_bounds(leak(format!("agent-approval-detail:{policy}")))
            .is_some()
    );
}
