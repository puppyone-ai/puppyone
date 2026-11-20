use super::*;
use core::prelude::v1::test;

struct Surface;
impl Render for Surface {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}
struct Item {
    kind: ItemKind,
    view: Entity<Surface>,
    releases: Rc<std::cell::Cell<usize>>,
}
impl Drop for Item {
    fn drop(&mut self) {
        self.releases.set(self.releases.get() + 1);
    }
}
impl WorkbenchItem for Item {
    fn kind(&self) -> ItemKind {
        self.kind
    }
    fn snapshot(&self, _: &App) -> ItemSnapshot {
        ItemSnapshot {
            title: "Prepared".into(),
            accessible_label: "Prepared".into(),
            detail: None,
            icon_key: None,
            status: ItemStatus::Idle,
            running: false,
            resource_id: Some("opaque-resource".into()),
        }
    }
    fn view(&self) -> AnyView {
        self.view.clone().into()
    }
    fn retained(&self, _: &App) -> RetainedItem {
        match self.kind {
            ItemKind::Terminal => RetainedItem::Terminal {
                title: "Prepared".into(),
                runtime: None,
            },
            ItemKind::Chat => RetainedItem::Chat {
                title: "Prepared".into(),
                runtime: crate::agent::connections::legacy_runtime_registry::Runtime::Codex,
                thread: None,
                runtime_id: Some("codex".into()),
            },
        }
    }
    fn close_decision(&self, _: &App) -> CloseDecision {
        CloseDecision::Close
    }
    fn close_copy(&self, _: bool, title: String) -> CloseCopy {
        CloseCopy {
            title,
            detail: "Close?",
            action: "Close",
            blocked: false,
        }
    }
    fn watch(&self, cx: &mut Context<Workbench>) -> Subscription {
        cx.observe(&self.view, |_, _, cx| cx.notify())
    }
}
fn item(kind: ItemKind, cx: &mut Context<Workbench>) -> Rc<dyn WorkbenchItem> {
    Rc::new(Item {
        kind,
        view: cx.new(|_| Surface),
        releases: Rc::new(std::cell::Cell::new(0)),
    })
}
fn setup(
    cx: &mut TestAppContext,
) -> (Entity<Workbench>, tempfile::TempDir, &mut VisualTestContext) {
    cx.executor().allow_parking();
    cx.update(gpui_kit::init);
    let root = tempfile::tempdir().unwrap();
    let (view, cx) = cx.add_window_view(Workbench::new);
    view.update(cx, |w, cx| {
        w.show(root.path().to_path_buf(), cx);
        w.project_mut().unwrap().loading = false;
    });
    (view, root, cx)
}

#[gpui::test]
fn blank_tabs_do_not_consume_quota_and_the_ninth_chat_cannot_evict_an_item(
    cx: &mut TestAppContext,
) {
    let (view, _root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let tabs: Vec<_> = (0..64)
            .map(|_| w.new_launcher_tab(0, cx).unwrap())
            .collect();
        assert!(w.can_create(ItemKind::Chat));
        assert!(w.project().unwrap().preparing.0.is_empty());
        for tab in &tabs[..8] {
            let permit = w.reserve_creation(ItemKind::Chat, *tab, cx).unwrap();
            let item = item(ItemKind::Chat, cx);
            assert_eq!(w.commit_creation(permit, item, cx), Some(*tab));
        }
        assert!(!w.can_create(ItemKind::Chat));
        let before = w.project().unwrap().layout.groups[&0].tabs.clone();
        assert!(w.reserve_creation(ItemKind::Chat, tabs[8], cx).is_none());
        assert_eq!(w.project().unwrap().layout.groups[&0].tabs, before);
        assert_eq!(w.tab_count(), 64);
        assert!(w.new_launcher_tab(0, cx).is_some());
        assert_eq!(w.tab_count(), 65);
    });
}

#[gpui::test]
fn preparing_locks_the_kind_and_launcher_but_not_other_kinds_or_blank_tabs(
    cx: &mut TestAppContext,
) {
    let (view, root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let a = w.new_launcher_tab(0, cx).unwrap();
        let first = w.reserve_creation(ItemKind::Chat, a, cx).unwrap();
        let b = w.new_launcher_tab(0, cx).unwrap();
        assert!(!w.can_create(ItemKind::Chat));
        assert!(w.can_create(ItemKind::Terminal));
        assert!(!w.launcher_available(root.path(), a));
        assert!(w.reserve_creation(ItemKind::Chat, b, cx).is_none());
        assert!(w.reserve_creation(ItemKind::Terminal, a, cx).is_none());
        let terminal = w.reserve_creation(ItemKind::Terminal, b, cx).unwrap();
        w.cancel_creation(first, cx);
        assert!(w.can_create(ItemKind::Chat));
        assert!(!w.can_create(ItemKind::Terminal));
        w.cancel_creation(terminal, cx);
        assert!(w.can_create(ItemKind::Terminal));
        assert_eq!(w.tab_count(), 2);
    });
}

#[gpui::test]
fn completion_replaces_only_its_launcher_without_stealing_a_new_selection(cx: &mut TestAppContext) {
    let (view, _root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let a = w.new_launcher_tab(0, cx).unwrap();
        let permit = w.reserve_creation(ItemKind::Chat, a, cx).unwrap();
        let b = w.new_launcher_tab(0, cx).unwrap();
        w.project_mut().unwrap().layout.activate(0, b);
        let item = item(ItemKind::Chat, cx);
        assert_eq!(w.commit_creation(permit, item, cx), Some(a));
        let p = w.project().unwrap();
        assert_eq!(p.layout.groups[&0].tabs, vec![a, b]);
        assert_eq!(p.layout.groups[&0].active, Some(b));
        assert!(matches!(p.content[&b], Content::Launcher));
        assert_eq!(p.content[&a].kind(), Some(ItemKind::Chat));
        assert!(w.reserve_creation(ItemKind::Terminal, a, cx).is_none());
    });
}

#[gpui::test]
fn completion_follows_the_launchers_current_group_without_changing_group_selection(
    cx: &mut TestAppContext,
) {
    let (view, _root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let first = w.new_launcher_tab(0, cx).unwrap();
        let a = w.new_launcher_tab(0, cx).unwrap();
        let permit = w.reserve_creation(ItemKind::Chat, a, cx).unwrap();
        w.split(0, Axis::Horizontal, Some(a), true, cx);
        let destination = w.group_of(a).unwrap();
        assert_ne!(destination, 0);
        w.project_mut().unwrap().layout.activate(0, first);
        let item = item(ItemKind::Chat, cx);
        assert_eq!(w.commit_creation(permit, item, cx), Some(a));
        let p = w.project().unwrap();
        assert_eq!(p.layout.groups[&destination].tabs, vec![a]);
        assert_eq!(p.layout.groups[&0].tabs, vec![first]);
        assert_eq!(p.layout.active_group, 0);
    });
}

#[gpui::test]
fn a_closed_launcher_discards_late_readiness_without_recreating_a_tab(cx: &mut TestAppContext) {
    let (view, root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let tab = w.new_launcher_tab(0, cx).unwrap();
        let permit = w.reserve_creation(ItemKind::Chat, tab, cx).unwrap();
        let releases = Rc::new(std::cell::Cell::new(0));
        let prepared: Rc<dyn WorkbenchItem> = Rc::new(Item {
            kind: ItemKind::Chat,
            view: cx.new(|_| Surface),
            releases: releases.clone(),
        });
        w.remove_tab(root.path(), tab, cx);
        assert!(!w.creation_is_current(&permit));
        assert_eq!(w.commit_creation(permit, prepared, cx), None);
        assert_eq!(
            releases.get(),
            1,
            "uncommitted contribution ownership is released exactly once"
        );
        assert_eq!(w.tab_count(), 0);
        assert!(w.can_create(ItemKind::Chat));
    });
}

#[gpui::test]
fn project_switches_cannot_redirect_a_prepared_item(cx: &mut TestAppContext) {
    let (view, root, cx) = setup(cx);
    let other = tempfile::tempdir().unwrap();
    view.update(cx, |w, cx| {
        let tab = w.new_launcher_tab(0, cx).unwrap();
        let permit = w.reserve_creation(ItemKind::Chat, tab, cx).unwrap();
        w.show(other.path().to_path_buf(), cx);
        w.project_mut().unwrap().loading = false;
        assert!(w.can_create(ItemKind::Chat));
        let item = item(ItemKind::Chat, cx);
        assert!(w.commit_creation(permit, item, cx).is_none());
        assert_eq!(w.tab_count(), 0);
        w.show(root.path().to_path_buf(), cx);
        assert!(w.is_launcher(root.path(), tab));
        assert!(w.can_create(ItemKind::Chat));
    });
}

#[gpui::test]
fn dropping_an_abandoned_preparation_releases_admission(cx: &mut TestAppContext) {
    let (view, root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let tab = w.new_launcher_tab(0, cx).unwrap();
        let permit = w.reserve_creation(ItemKind::Chat, tab, cx).unwrap();
        assert!(!w.can_create(ItemKind::Chat));
        drop(permit);
        assert!(w.can_create(ItemKind::Chat));
        assert!(w.launcher_available(root.path(), tab));
        let permit = w.reserve_creation(ItemKind::Chat, tab, cx).unwrap();
        assert_eq!(w.project().unwrap().preparing.0.len(), 1);
        w.cancel_creation(permit, cx);
    });
}

#[gpui::test]
fn a_wrong_contribution_kind_cannot_commit_under_another_permit(cx: &mut TestAppContext) {
    let (view, root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let tab = w.new_launcher_tab(0, cx).unwrap();
        let permit = w.reserve_creation(ItemKind::Chat, tab, cx).unwrap();
        let item = item(ItemKind::Terminal, cx);
        assert!(w.commit_creation(permit, item, cx).is_none());
        assert!(w.is_launcher(root.path(), tab));
        assert!(w.can_create(ItemKind::Chat));
        assert!(w.can_create(ItemKind::Terminal));
    });
}

#[gpui::test]
fn a_stale_permit_cannot_release_the_same_tab_number_in_a_reopened_project(
    cx: &mut TestAppContext,
) {
    let (view, root, cx) = setup(cx);
    view.update(cx, |w, cx| {
        let old_tab = w.new_launcher_tab(0, cx).unwrap();
        let stale = w.reserve_creation(ItemKind::Chat, old_tab, cx).unwrap();
        w.shutdown(cx);
        assert!(!w.can_create(ItemKind::Chat));
        assert!(!w.can_create(ItemKind::Terminal));
        assert!(w.new_launcher_tab(0, cx).is_none());
        w.show(root.path().to_path_buf(), cx);
        w.project_mut().unwrap().loading = false;
        let tab = w.new_launcher_tab(0, cx).unwrap();
        assert_eq!(tab, old_tab, "a fresh project's numeric tab IDs may repeat");
        let current = w.reserve_creation(ItemKind::Chat, tab, cx).unwrap();
        assert!(!w.creation_is_current(&stale));
        w.cancel_creation(stale, cx);
        assert!(w.creation_is_current(&current));
        assert!(!w.can_create(ItemKind::Chat));
        w.cancel_creation(current, cx);
        assert!(w.can_create(ItemKind::Chat));
    });
}
