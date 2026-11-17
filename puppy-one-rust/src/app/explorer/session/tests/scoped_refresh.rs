use super::*;
use crate::workspace::{contracts::*, ports::*, testing::Memory};
use std::{collections::HashMap, sync::Mutex};

struct Listings {
    memory: Memory,
    entries: Mutex<HashMap<String, Vec<String>>>,
    calls: Mutex<Vec<String>>,
}
impl Listings {
    fn new() -> Self {
        Self {
            memory: Memory::new("memory://scoped-explorer/project/"),
            entries: Mutex::new(
                [
                    ("", vec!["docs/", "other/", "readme.md"]),
                    ("docs", vec!["a.md", "b.md"]),
                    ("other", vec!["keep.md"]),
                ]
                .into_iter()
                .map(|(path, children)| {
                    (
                        path.into(),
                        children.into_iter().map(String::from).collect(),
                    )
                })
                .collect(),
            ),
            calls: Mutex::new(Vec::new()),
        }
    }
    fn set(&self, folder: &str, children: &[&str]) {
        self.entries.lock().unwrap().insert(
            folder.into(),
            children.iter().map(|s| s.to_string()).collect(),
        );
    }
    fn take_calls(&self) -> Vec<String> {
        std::mem::take(&mut *self.calls.lock().unwrap())
    }
}
impl DataPort for Listings {
    fn descriptor(&self) -> Descriptor {
        self.memory.descriptor.clone()
    }
    fn list(&self, path: &RelativePath) -> crate::workspace::Result<Vec<Entry>> {
        let path = path.as_path();
        self.calls
            .lock()
            .unwrap()
            .push(path.to_string_lossy().into());
        self.entries
            .lock()
            .unwrap()
            .get(path.to_str().unwrap())
            .unwrap()
            .iter()
            .map(|name| {
                let folder = name.ends_with('/');
                let name = name.trim_end_matches('/');
                Ok(Entry {
                    path: RelativePath::new(&path.join(name))?,
                    name: name.into(),
                    folder,
                })
            })
            .collect()
    }
}
impl DocumentStoragePort for Listings {
    fn read(&self, path: &RelativePath) -> crate::workspace::Result<TextSnapshot> {
        self.memory.read(path)
    }
    fn write(
        &self,
        path: &RelativePath,
        revision: &Revision,
        text: &str,
    ) -> crate::workspace::Result<WriteResult> {
        self.memory.write(path, revision, text)
    }
}
impl ResourcePort for Listings {
    fn preview(&self, path: &RelativePath) -> crate::workspace::Result<PreviewData> {
        self.memory.preview(path)
    }
}
impl ResourceWatchPort for Listings {
    fn watch(
        &self,
        _: &RelativePath,
        _: &Revision,
        _: Notify,
    ) -> crate::workspace::Result<WatchSubscription> {
        Err(crate::workspace::Error::unsupported())
    }
}

fn mount(cx: &mut TestAppContext) -> (Entity<ExplorerSession>, Arc<Listings>) {
    cx.executor().allow_parking();
    let provider = Arc::new(Listings::new());
    let workspace = Workspace::from_provider(provider.clone()).unwrap();
    let preferences = cx.new(|_| PreferencesStore::memory());
    let explorer = cx.new(|cx| ExplorerSession::new(false, preferences, cx));
    explorer.update(cx, |e, cx| {
        e.load_workspace(
            workspace.clone(),
            workspace.list(Path::new("")).unwrap(),
            cx,
        );
        for folder in ["docs", "other"] {
            e.tree.attach_children(
                Path::new(folder),
                workspace.list(Path::new(folder)).unwrap(),
            );
        }
        e.tree.select(Path::new("other/keep.md"), false, false);
    });
    cx.run_until_parked();
    provider.take_calls();
    (explorer, provider)
}
fn refresh(explorer: &Entity<ExplorerSession>, paths: Option<&[&str]>, cx: &mut TestAppContext) {
    let paths: Option<Vec<_>> = paths.map(|paths| {
        paths
            .iter()
            .map(|p| RelativePath::new(Path::new(p)).unwrap())
            .collect()
    });
    explorer.update(cx, |e, cx| e.refresh_folders(paths.as_deref(), cx));
}
fn complete_read_before_foreground_delivery(provider: &Listings, cx: &mut TestAppContext) {
    for _ in 0..500 {
        if !provider.calls.lock().unwrap().is_empty() {
            return;
        }
        assert!(cx.executor().tick(), "the queued directory read must run");
    }
    panic!("directory read did not run");
}

#[gpui::test]
fn named_and_unknown_changes_refresh_only_their_scope_and_preserve_unchanged_projection(
    cx: &mut TestAppContext,
) {
    let (explorer, provider) = mount(cx);
    let revision = explorer.read_with(cx, |e, _| e.tree.revision);
    let updates = std::rc::Rc::new(std::cell::Cell::new(0));
    let seen = updates.clone();
    cx.update(|cx| {
        cx.subscribe(&explorer, move |_, event: &SessionEvent, _| {
            if matches!(event, SessionEvent::ReferencesChanged) {
                seen.set(seen.get() + 1);
            }
        })
        .detach()
    });
    for (paths, expected) in [
        (Some(vec!["docs/a.md"]), vec!["docs"]),
        (Some(vec!["readme.md"]), vec![""]),
        (None, vec!["", "docs", "other"]),
    ] {
        refresh(&explorer, paths.as_deref(), cx);
        cx.run_until_parked();
        let mut actual = provider.take_calls();
        actual.sort();
        assert_eq!(actual, expected);
        explorer.read_with(cx, |e, _| {
            assert_eq!(e.tree.revision, revision);
            assert_eq!(e.tree.selected, Path::new("other/keep.md"));
        });
    }
    assert_eq!(
        updates.get(),
        0,
        "unchanged listings must not republish the tree"
    );
    provider.set("docs", &["a.md", "b.md", "agent.md"]);
    refresh(&explorer, Some(&["docs/agent.md"]), cx);
    cx.run_until_parked();
    assert_eq!(provider.take_calls(), ["docs"]);
    explorer.read_with(cx, |e, _| {
        assert!(e.tree.index_of(Path::new("docs/agent.md")).is_some());
        assert!(e.tree.index_of(Path::new("other/keep.md")).is_some());
        assert_eq!(e.tree.selected, Path::new("other/keep.md"));
    });
    provider.set("docs", &["a.md"]);
    refresh(&explorer, Some(&["docs/b.md", "docs/agent.md"]), cx);
    cx.run_until_parked();
    assert_eq!(provider.take_calls(), ["docs"]);
    explorer.read_with(cx, |e, _| {
        assert!(e.tree.index_of(Path::new("docs/b.md")).is_none());
        assert!(e.tree.index_of(Path::new("docs/agent.md")).is_none());
        assert!(e.tree.index_of(Path::new("docs/a.md")).is_some());
    });
}

#[gpui::test]
fn a_scoped_refresh_keeps_another_folders_pending_result_without_reading_it_twice(
    cx: &mut TestAppContext,
) {
    let (explorer, provider) = mount(cx);
    provider.set("other", &["keep.md", "late.md"]);
    refresh(&explorer, Some(&["other/late.md"]), cx);
    complete_read_before_foreground_delivery(&provider, cx);
    assert_eq!(provider.take_calls(), ["other"]);
    refresh(&explorer, Some(&["docs/a.md"]), cx);
    cx.run_until_parked();
    assert_eq!(
        provider.take_calls(),
        ["docs"],
        "an unrelated refresh must not cancel and repeat the pending directory read"
    );
    explorer.read_with(cx, |e, _| {
        assert!(e.tree.index_of(Path::new("other/late.md")).is_some())
    });
}

#[gpui::test]
fn newer_listing_wins_when_an_old_result_is_waiting_for_foreground_delivery(
    cx: &mut TestAppContext,
) {
    let (explorer, provider) = mount(cx);
    provider.set("docs", &["stale.md"]);
    refresh(&explorer, Some(&["docs/a.md"]), cx);
    complete_read_before_foreground_delivery(&provider, cx);
    assert_eq!(provider.take_calls(), ["docs"]);
    provider.set("docs", &["fresh.md"]);
    refresh(&explorer, Some(&["docs/fresh.md"]), cx);
    cx.run_until_parked();
    assert_eq!(provider.take_calls(), ["docs"]);
    explorer.read_with(cx, |e, _| {
        assert!(e.tree.index_of(Path::new("docs/fresh.md")).is_some());
        assert!(e.tree.index_of(Path::new("docs/stale.md")).is_none());
    });
}
