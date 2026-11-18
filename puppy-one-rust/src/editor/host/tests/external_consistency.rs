//! External-consistency acceptance across real storage, working copies and
//! the actual editor surfaces. For the formats a web page edits (whiteboard,
//! Context Map, PuppyFlow) the page is stood in for by its protocol messages;
//! what the real page does with them is the WebKit probes' acceptance.
use super::*;
use crate::{
    documents::{Documents, Intent},
    editor::{registry::HostCommand, text::selection::Selection, workbench::pane::Action},
    wake::Wake,
    workspace::{Workspace, contracts::RelativePath, ports::WatchEvent, testing::Texts},
};
use gpui::{AppContext as _, EntityInputHandler, Render, prelude::*};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug)]
struct Fixture {
    path: &'static str,
    viewer: &'static str,
}
const NATIVE: [Fixture; 7] = [
    Fixture {
        path: "matrix-note.md",
        viewer: "markdown",
    },
    Fixture {
        path: "matrix-note.txt",
        viewer: "text",
    },
    Fixture {
        path: "matrix-worker.py",
        viewer: "text",
    },
    Fixture {
        path: "matrix-config.json",
        viewer: "json",
    },
    Fixture {
        path: "matrix-table.csv",
        viewer: "csv-table",
    },
    Fixture {
        path: "matrix-table.tsv",
        viewer: "csv-table",
    },
    Fixture {
        path: "matrix-page.html",
        viewer: "html-artifact",
    },
];
/// Formats whose editor is a web page holding its own model.
const PAGES: [Fixture; 3] = [
    Fixture {
        path: "matrix-board.excalidraw",
        viewer: "excalidraw",
    },
    Fixture {
        path: "matrix-map.contextmap",
        viewer: "context-map",
    },
    Fixture {
        path: "matrix-workflow.puppyflow",
        viewer: "puppyflow",
    },
];
fn every_fixture() -> impl Iterator<Item = Fixture> {
    NATIVE.into_iter().chain(PAGES)
}
impl Fixture {
    fn page(self) -> bool {
        PAGES.iter().any(|page| page.path == self.path)
    }
    /// The product matrix's documents for each format.
    fn text(self, marker: &str) -> String {
        match self.path.rsplit('.').next().unwrap() {
            "excalidraw" => {
                let version = match marker {
                    "alpha" => 1,
                    "human" => 2,
                    _ => 3,
                };
                format!(
                    "{}\n",
                    serde_json::json!({"type": "excalidraw", "version": 2, "elements": [{
                        "id": "matrix-shape", "type": "rectangle", "x": 0, "y": 0, "width": 20, "height": 20,
                        "version": version, "customData": {"marker": marker},
                    }], "appState": {"viewBackgroundColor": "#ffffff"}, "files": {}})
                )
            }
            "contextmap" => format!(
                "{}\n",
                serde_json::to_string_pretty(&serde_json::json!({
                    "version": 1, "scope": ".", "layout": {"expanded": [marker], "offsets": {}},
                }))
                .unwrap()
            ),
            "puppyflow" => format!(
                "{}\n",
                serde_json::to_string_pretty(&serde_json::json!({
                    "kind": "puppyflow", "version": 1, "title": "Matrix", "description": "",
                    "steps": [{"id": "step_matrix", "agent": "codex", "prompt": marker, "enabled": true}],
                }))
                .unwrap()
            ),
            "md" => format!("# {marker}"),
            "py" => format!("value = '{marker}'"),
            "json" => format!("{{\n  \"value\": \"{marker}\"\n}}"),
            "csv" => format!("Name,Value\nitem,{marker}"),
            "tsv" => format!("Name\tValue\nitem\t{marker}"),
            "html" => format!("<!doctype html><h1>{marker}</h1>"),
            _ => marker.into(),
        }
    }
}

struct Mount(Vec<Entity<DocumentEditor>>);
impl Render for Mount {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        gpui::div().size_full().children(self.0.clone())
    }
}
/// Another pane over the same storage, with its own document session.
struct Pane {
    docs: Documents,
    host: Entity<DocumentEditor>,
    events: Rc<RefCell<Vec<ClientMessage>>>,
}
type Events = Rc<RefCell<Vec<ClientMessage>>>;
struct Matrix<'a> {
    fixture: Fixture,
    storage: Arc<Texts>,
    docs: Documents,
    wake: Wake,
    // Advance deliberately only when checking idle persistence. Scheduling the
    // worker threads must not turn a dirty-overwrite test into an autosave race.
    now: Instant,
    host: Option<Entity<DocumentEditor>>,
    mount: Entity<Mount>,
    events: Events,
    /// Every text the session asked the primary pane to show, in order.
    opened: Vec<String>,
    others: Vec<Pane>,
    cx: &'a mut VisualTestContext,
    _root: tempfile::TempDir,
}
impl<'a> Matrix<'a> {
    fn new(cx: &'a mut TestAppContext, fixture: Fixture) -> Self {
        cx.update(|cx| {
            if cx.try_global::<gpui_kit::component::Theme>().is_none() {
                gpui_kit::init(cx);
            }
            cx.text_system().add_fonts(style::font_bytes()).unwrap();
            crate::editor::view::bind_keys(cx);
            crate::editor::csv::bind_keys(cx);
            super::super::bind_keys(cx);
        });
        let root = tempfile::tempdir().unwrap();
        let storage = Arc::new(Texts::new(root.path().canonicalize().unwrap()));
        storage.put(fixture.path, &fixture.text("alpha"), "v1");
        let ws = Workspace::from_provider(storage.clone()).unwrap();
        let (mount, cx) = cx.add_window_view(|_, _| Mount(Vec::new()));
        let mut this = Self {
            fixture,
            storage,
            docs: Documents::in_workspace(ws),
            wake: Wake::default(),
            now: Instant::now(),
            host: None,
            mount,
            events: Rc::default(),
            opened: Vec::new(),
            others: Vec::new(),
            cx,
            _root: root,
        };
        this.mount_host();
        this.docs
            .begin(Intent::OpenFile(fixture.path.into()), &this.wake);
        this.until(|m| m.shown().as_deref() == Some(&fixture.text("alpha")) && !m.docs.busy());
        this.host.as_ref().unwrap().read_with(this.cx, |h, _| {
            assert_eq!(h.session.as_ref().unwrap().viewer.id, fixture.viewer);
            assert!(h.session.as_ref().unwrap().editable);
        });
        this.page_ready();
        assert!(this.docs.watching());
        assert_eq!(*this.storage.reads.lock().unwrap(), [fixture.path]);
        this
    }
    fn mount_host(&mut self) {
        assert!(self.host.is_none());
        let (host, events) = self.new_host();
        self.events = events;
        self.host = Some(host);
    }
    fn new_host(&mut self) -> (Entity<DocumentEditor>, Events) {
        let workspace = self.docs.workspace.clone();
        let board = self.fixture.viewer == "excalidraw";
        let host = self.cx.update(|_, cx| {
            cx.new(|cx| {
                let mut h = DocumentEditor::new(cx);
                h.set_workspace(workspace);
                if board {
                    h.set_test_surface_factory(Some(
                        crate::editor::viewers::whiteboard::open_with_fixture_pack,
                    ));
                }
                h
            })
        });
        let events = Events::default();
        let sink = events.clone();
        self.cx.update(|_, cx| {
            cx.subscribe(&host, move |_, event: &ClientMessage, _| {
                sink.borrow_mut().push(event.clone())
            })
            .detach();
        });
        self.mount.update(self.cx, |m, cx| {
            m.0.push(host.clone());
            cx.notify();
        });
        (host, events)
    }
    /// Opens `fixture`, already in storage, in another pane.
    fn open_other(&mut self, fixture: Fixture) -> usize {
        let (host, events) = self.new_host();
        let mut docs = Documents::in_workspace(self.docs.workspace.clone().unwrap());
        docs.begin(Intent::OpenFile(fixture.path.into()), &self.wake);
        self.others.push(Pane { docs, host, events });
        let index = self.others.len() - 1;
        let text = fixture.text("alpha");
        self.until(|m| {
            m.other_shown(index).as_deref() == Some(&text) && !m.others[index].docs.busy()
        });
        index
    }
    fn other_shown(&self, index: usize) -> Option<String> {
        self.others[index]
            .host
            .read_with(self.cx, |h, cx| h.text(cx))
    }
    fn unmount(&mut self) {
        self.tick();
        let host = self.host.take().unwrap();
        let views = host.read_with(self.cx, |h, _| {
            let probe = h.surface.as_ref().unwrap().as_test_probe().unwrap();
            let editor = probe.editor_view().map(|e| e.downgrade().into());
            let code = probe.code_editor().map(|e| e.downgrade().into());
            let table = probe.csv_editor().map(|e| e.downgrade().into());
            let page = probe.page_view().map(|e| e.downgrade());
            [editor, code, table, page]
                .into_iter()
                .flatten()
                .collect::<Vec<gpui::AnyWeakEntity>>()
        });
        assert!(!views.is_empty(), "{:?}", self.fixture);
        let old = host.downgrade();
        drop(host);
        self.mount.update(self.cx, |m, cx| {
            m.0.retain(|mounted| mounted.entity_id() != old.entity_id());
            cx.notify();
        });
        self.cx.run_until_parked();
        self.cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
        assert!(
            old.upgrade().is_none(),
            "the previous host must actually be destroyed"
        );
        assert!(
            views.iter().all(|view| view.upgrade().is_none()),
            "{:?}: the previous view must actually be destroyed",
            self.fixture
        );
    }
    fn remount(&mut self) {
        self.mount_host();
        self.docs.show_document();
        self.tick();
        self.page_ready();
    }
    /// The page reports ready under the generation it booted with.
    fn page_ready(&mut self) {
        if !self.fixture.page() {
            return;
        }
        let host = self.host.as_ref().unwrap().clone();
        let delivered = host.update(self.cx, |h, cx| {
            let probe = h.surface.as_ref().unwrap().as_test_probe().unwrap();
            let generation = probe.page_generation(cx).unwrap();
            let ready = serde_json::json!({"type": "ready", "generation": generation});
            probe.page_deliver(&ready.to_string(), cx)
        });
        assert!(delivered);
        self.tick();
    }
    /// What the HTML preview shows (Interact's page document).
    fn assert_preview_shows(&self, marker: &str) {
        if self.fixture.viewer != "html-artifact" {
            return;
        }
        let entry = self.page_entry();
        assert!(
            entry.contains(&format!("<h1>{marker}</h1>")),
            "the preview would not show {marker}"
        );
    }
    fn page_entry(&self) -> String {
        self.host.as_ref().unwrap().read_with(self.cx, |h, cx| {
            let probe = h.surface.as_ref().unwrap().as_test_probe().unwrap();
            probe.page_entry(cx).unwrap()
        })
    }
    /// What a page created now for this document would boot with.
    fn assert_page_shows(&self, marker: &str) {
        if !self.fixture.page() {
            return;
        }
        let entry = self.page_entry();
        let boot = [
            "window.__PUPPYONE_STRUCTURED=",
            "window.__PUPPYONE_WHITEBOARD=",
        ]
        .iter()
        .find_map(|key| entry.split_once(key))
        .and_then(|(_, rest)| rest.split_once("</script>"))
        .map(|(boot, _)| serde_json::from_str::<serde_json::Value>(boot).unwrap())
        .expect("the page's boot document");
        assert_eq!(
            boot["text"],
            self.fixture.text(marker),
            "{:?}: the page would not show {marker}",
            self.fixture
        );
    }
    fn tick(&mut self) {
        self.docs.poll_at(&self.wake, self.now);
        if let Some(host) = &self.host {
            for message in std::mem::take(&mut self.docs.outgoing) {
                if let HostMessage::Open { text, .. } = &message {
                    self.opened.push(text.clone());
                }
                let replies = host.update_in(self.cx, |h, w, cx| h.receive(&message, w, cx));
                for reply in replies {
                    self.docs.client(reply, &self.wake);
                }
            }
        }
        for pane in &mut self.others {
            pane.docs.poll_at(&self.wake, self.now);
            for message in std::mem::take(&mut pane.docs.outgoing) {
                let replies = pane
                    .host
                    .update_in(self.cx, |h, w, cx| h.receive(&message, w, cx));
                for reply in replies {
                    pane.docs.client(reply, &self.wake);
                }
            }
        }
        self.cx.run_until_parked();
        for event in self.events.borrow_mut().drain(..) {
            self.docs.client(event, &self.wake);
        }
        for pane in &mut self.others {
            for event in pane.events.borrow_mut().drain(..) {
                pane.docs.client(event, &self.wake);
            }
        }
        self.cx.update(|w, cx| {
            w.draw(cx).clear(cx);
        });
    }
    fn until(&mut self, mut ready: impl FnMut(&mut Self) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            self.tick();
            if ready(self) {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "{:?}: {} / {:?}, shown {:?}",
                self.fixture,
                self.docs.status,
                self.docs.error,
                self.shown()
            );
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(self.docs.error.is_none(), "{:?}", self.docs.error);
    }
    fn shown(&self) -> Option<String> {
        self.host
            .as_ref()
            .and_then(|h| h.read_with(self.cx, |h, cx| h.text(cx)))
    }
    fn assert_shown(&self, marker: &str) {
        assert_eq!(
            self.shown(),
            Some(self.fixture.text(marker)),
            "{:?}",
            self.fixture
        );
    }
    fn publish(&self, marker: &str, version: &str) {
        self.storage
            .put(self.fixture.path, &self.fixture.text(marker), version);
        self.storage.publish(WatchEvent::Changed(vec![
            RelativePath::new(self.fixture.path.as_ref()).unwrap(),
        ]));
    }
    fn adopt(&mut self) {
        let text = self.fixture.text("agent");
        self.publish("agent", "v2");
        self.until(|m| m.shown().as_deref() == Some(&text) && !m.docs.dirty);
    }
    fn edit(&mut self, previous: &str) {
        let host = self.host.as_ref().unwrap();
        if self.fixture.page() {
            let _ = previous;
            self.page_ready();
            let text = self.fixture.text("human");
            let host = self.host.as_ref().unwrap().clone();
            let delivered = host.update(self.cx, |h, cx| {
                let probe = h.surface.as_ref().unwrap().as_test_probe().unwrap();
                let generation = probe.page_generation(cx).unwrap();
                let edit =
                    serde_json::json!({"type": "content", "generation": generation, "text": text});
                probe.page_deliver(&edit.to_string(), cx)
            });
            assert!(delivered);
        } else if self.fixture.viewer == "csv-table" {
            let csv = host.read_with(self.cx, |h, _| {
                h.surface
                    .as_ref()
                    .unwrap()
                    .as_test_probe()
                    .unwrap()
                    .csv_editor()
                    .unwrap()
            });
            csv.update_in(self.cx, |csv, w, cx| {
                assert_eq!(csv.find_query(previous, cx).total, 1);
                csv.find_focus_editor(w, cx);
            });
            self.cx.run_until_parked();
            self.cx.simulate_input("human");
            self.cx.simulate_keystrokes("enter");
        } else if self.fixture.viewer == "html-artifact" {
            self.show_html_source();
            let host = self.host.as_ref().unwrap();
            let code = host.read_with(self.cx, |h, _| {
                h.surface
                    .as_ref()
                    .unwrap()
                    .as_test_probe()
                    .unwrap()
                    .code_editor()
                    .unwrap()
            });
            let text = self.fixture.text("human");
            code.update_in(self.cx, |c, w, cx| {
                let len = c.text(cx).encode_utf16().count();
                assert!(c.edit_utf16(&[(0..len, text)], w, cx));
            });
        } else {
            let editor = host.read_with(self.cx, |h, _| {
                h.surface
                    .as_ref()
                    .unwrap()
                    .as_test_probe()
                    .unwrap()
                    .editor_view()
                    .unwrap()
            });
            let text = self.fixture.text("human");
            editor.update_in(self.cx, |e, w, cx| {
                e.set_selection(Selection::range(0, e.text().len()), cx);
                e.replace_text_in_range(None, &text, w, cx);
            });
        }
        self.tick();
        self.assert_shown("human");
        assert!(self.docs.dirty, "{:?}", self.fixture);
    }
    /// HTML is edited, and its history read, in its source view, chosen
    /// as a person would: the pane menu's view mode.
    fn show_html_source(&mut self) {
        let host = self.host.as_ref().unwrap();
        host.update_in(self.cx, |h, w, cx| {
            h.run_pane_action(Action::Segment("source"), w, cx)
        });
        let mode = host.read_with(self.cx, |h, cx| {
            h.contribution(cx).segmented.map(|s| s.value)
        });
        assert_eq!(mode, Some("source"));
    }
    fn history(&mut self, redo: bool) {
        let host = self.host.as_ref().unwrap().clone();
        let command = if redo {
            HostCommand::Redo
        } else {
            HostCommand::Undo
        };
        host.update_in(self.cx, |h, w, cx| h.command(command, w, cx));
        self.tick();
    }
    fn save(&mut self) {
        self.docs.begin(Intent::Save, &self.wake);
        self.until(|m| !m.docs.dirty && !m.docs.saving() && !m.docs.busy());
        assert_eq!(
            self.storage.files.lock().unwrap()[self.fixture.path].text,
            self.fixture.text("human")
        );
    }
    fn assert_no_writes(&mut self) {
        self.now += Duration::from_secs(5);
        self.tick();
        assert!(!self.docs.saving() && !self.docs.dirty);
        assert!(self.storage.writes.lock().unwrap().is_empty());
    }
}

/// The product matrix's completeness rule: every editable preset viewer has
/// a consistency fixture.
#[test]
fn every_editable_preset_viewer_has_a_consistency_fixture() {
    use crate::editor::registry::{Capability, manifest};
    let mut editable: Vec<&str> = manifest()
        .viewers
        .iter()
        .filter(|viewer| viewer.capability == Capability::Edit)
        .map(|viewer| viewer.id.as_str())
        .collect();
    editable.sort_unstable();
    let mut covered: Vec<&str> = every_fixture().map(|fixture| fixture.viewer).collect();
    covered.sort_unstable();
    covered.dedup();
    assert_eq!(covered, editable);
}

#[gpui::test]
fn clean_external_updates_reach_each_editable_surface_without_writes(cx: &mut TestAppContext) {
    for fixture in every_fixture() {
        let mut m = Matrix::new(cx, fixture);
        m.adopt();
        m.assert_page_shows("agent");
        m.assert_preview_shows("agent");
        assert_eq!(
            *m.storage.reads.lock().unwrap(),
            [fixture.path, fixture.path]
        );
        m.storage.publish(WatchEvent::Changed(vec![
            RelativePath::new("unrelated.txt".as_ref()).unwrap(),
        ]));
        m.assert_no_writes();
        assert_eq!(
            m.storage.reads.lock().unwrap().len(),
            2,
            "unrelated changes must not reread"
        );
    }
}

#[gpui::test]
fn dirty_edits_yield_to_external_updates_without_conflict_or_writeback(cx: &mut TestAppContext) {
    for fixture in every_fixture() {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.adopt();
        m.assert_page_shows("agent");
        assert!(!m.docs.cloud_conflict());
        m.assert_no_writes();
    }
}

#[gpui::test]
fn manual_save_after_external_adoption_uses_the_new_storage_revision(cx: &mut TestAppContext) {
    for fixture in every_fixture() {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.adopt();
        m.edit("agent");
        m.save();
        m.assert_shown("human");
        m.assert_page_shows("human");
        assert_eq!(
            *m.storage.writes.lock().unwrap(),
            [(
                fixture.path.into(),
                crate::workspace::contracts::Revision("v2".into()),
                fixture.text("human")
            )]
        );
    }
}

#[gpui::test]
fn destroyed_views_reopen_the_latest_external_text_without_saving(cx: &mut TestAppContext) {
    for fixture in every_fixture() {
        let mut m = Matrix::new(cx, fixture);
        m.unmount();
        m.publish("agent", "v2");
        let latest = fixture.text("agent");
        m.until(|m| m.docs.document.as_ref().is_some_and(|d| d.text == latest));
        m.remount();
        m.assert_shown("agent");
        m.assert_page_shows("agent");
        m.assert_preview_shows("agent");
        m.assert_no_writes();
    }
}

#[gpui::test]
fn saved_local_edits_survive_destroyed_views_without_duplicate_saves(cx: &mut TestAppContext) {
    for fixture in every_fixture() {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.save();
        m.unmount();
        m.remount();
        m.assert_shown("human");
        m.assert_page_shows("human");
        m.assert_preview_shows("human");
        m.now += Duration::from_secs(5);
        m.tick();
        assert_eq!(m.storage.writes.lock().unwrap().len(), 1);
        assert!(!m.docs.dirty);
    }
}

#[gpui::test]
fn saved_local_history_survives_destroying_and_recreating_native_views(cx: &mut TestAppContext) {
    for fixture in NATIVE {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.save();
        m.unmount();
        m.remount();
        if fixture.viewer == "html-artifact" {
            // As in the product's matrix, the page's history is its source's.
            m.show_html_source();
        }
        m.history(false);
        m.assert_shown("alpha");
        m.history(true);
        m.assert_shown("human");
        assert_eq!(m.storage.writes.lock().unwrap().len(), 1);
    }
}

/// The retained history belongs to one open document instance: closing the
/// document retires it, so reopening the same file starts a fresh history.
#[gpui::test]
fn closing_a_document_retires_its_retained_history(cx: &mut TestAppContext) {
    for fixture in NATIVE {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.save();
        m.docs.begin(Intent::CloseFile, &m.wake);
        m.until(|m| m.docs.document.is_none() && !m.docs.busy() && m.shown().is_none());
        m.docs.begin(Intent::OpenFile(fixture.path.into()), &m.wake);
        let saved = fixture.text("human");
        m.until(|m| m.shown().as_deref() == Some(&saved) && !m.docs.busy());
        if fixture.viewer == "html-artifact" {
            m.show_html_source();
        }
        m.history(false);
        m.assert_shown("human");
        assert_eq!(m.storage.writes.lock().unwrap().len(), 1);
        assert!(!m.docs.dirty);
    }
}

/// Another document never continues this one's history, even when it shows
/// the same text in the same viewer and host.
#[gpui::test]
fn another_document_with_identical_text_starts_its_own_history(cx: &mut TestAppContext) {
    for fixture in NATIVE {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.save();
        let other = format!("other-{}", fixture.path);
        m.storage.put(&other, &fixture.text("human"), "v1");
        m.docs
            .begin(Intent::OpenFile(other.clone().into()), &m.wake);
        m.until(|m| {
            m.docs
                .opened()
                .is_some_and(|(_, path)| path == std::path::Path::new(&other))
                && !m.docs.busy()
        });
        m.unmount();
        m.remount();
        m.assert_shown("human");
        if fixture.viewer == "html-artifact" {
            m.show_html_source();
        }
        m.history(false);
        m.assert_shown("human");
        assert!(!m.docs.dirty);
        assert_eq!(m.storage.writes.lock().unwrap().len(), 1);
    }
}

/// A history recorded against text storage has since replaced is never
/// replayed onto the newer text: the next view starts clean, without a write.
#[gpui::test]
fn history_recorded_before_an_unseen_external_update_is_discarded(cx: &mut TestAppContext) {
    for fixture in NATIVE {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.save();
        m.unmount();
        m.publish("agent", "v3");
        let latest = fixture.text("agent");
        m.until(|m| m.docs.document.as_ref().is_some_and(|d| d.text == latest));
        m.remount();
        m.assert_shown("agent");
        if fixture.viewer == "html-artifact" {
            m.show_html_source();
        }
        m.history(false);
        m.assert_shown("agent");
        m.now += Duration::from_secs(5);
        m.tick();
        assert!(!m.docs.dirty);
        assert_eq!(m.storage.writes.lock().unwrap().len(), 1);
    }
}

/// An input method composition still open when the view is destroyed is not
/// committed text: the next view continues the committed history only.
#[gpui::test]
fn an_open_composition_is_left_out_of_the_retained_history(cx: &mut TestAppContext) {
    for fixture in NATIVE
        .into_iter()
        .filter(|f| ["markdown", "text"].contains(&f.viewer))
    {
        let mut m = Matrix::new(cx, fixture);
        m.edit("alpha");
        m.save();
        let editor = m.host.as_ref().unwrap().read_with(m.cx, |h, _| {
            h.surface
                .as_ref()
                .unwrap()
                .as_test_probe()
                .unwrap()
                .editor_view()
                .unwrap()
        });
        editor.update_in(m.cx, |e, w, cx| {
            let end = e.text().encode_utf16().count();
            e.replace_and_mark_text_in_range(Some(end..end), "ㄱ", None, w, cx);
            assert!(e.composing());
        });
        drop(editor);
        m.tick();
        m.assert_shown("human");
        m.unmount();
        m.remount();
        m.assert_shown("human");
        m.history(false);
        m.assert_shown("alpha");
        m.history(true);
        m.assert_shown("human");
        assert_eq!(m.storage.writes.lock().unwrap().len(), 1);
    }
}

fn native(viewer_path: &str) -> Fixture {
    NATIVE.into_iter().find(|f| f.path == viewer_path).unwrap()
}

/// One watcher batch naming two documents updates both panes, each reading
/// only its own document once, with nothing written back.
#[gpui::test]
fn one_watcher_batch_updates_each_pane_from_its_own_document(cx: &mut TestAppContext) {
    let (markdown, csv) = (native("matrix-note.md"), native("matrix-table.csv"));
    let mut m = Matrix::new(cx, markdown);
    m.storage.put(csv.path, &csv.text("alpha"), "v1");
    let table = m.open_other(csv);
    assert_eq!(*m.storage.reads.lock().unwrap(), [markdown.path, csv.path]);
    m.storage.put(markdown.path, &markdown.text("agent"), "v2");
    m.storage.put(csv.path, &csv.text("agent"), "v2");
    m.storage.publish(WatchEvent::Changed(vec![
        RelativePath::new(markdown.path.as_ref()).unwrap(),
        RelativePath::new(csv.path.as_ref()).unwrap(),
    ]));
    let (note, sheet) = (markdown.text("agent"), csv.text("agent"));
    m.until(|m| {
        m.shown().as_deref() == Some(&note) && m.other_shown(table).as_deref() == Some(&sheet)
    });
    m.assert_no_writes();
    let mut reads = m.storage.reads.lock().unwrap().clone();
    reads.sort();
    assert_eq!(reads, [markdown.path, markdown.path, csv.path, csv.path]);
    assert!(!m.others[table].docs.dirty && m.others[table].docs.error.is_none());
}

/// A read that started before a newer matching event is obsolete when it
/// completes: its text never reaches the view, the newest storage text does.
#[gpui::test]
fn an_obsolete_read_never_replaces_the_text_of_a_newer_event(cx: &mut TestAppContext) {
    let markdown = native("matrix-note.md");
    let mut m = Matrix::new(cx, markdown);
    let (release, blocked) = std::sync::mpsc::channel::<()>();
    *m.storage.after_read.lock().unwrap() = Some(Box::new(move || {
        let _ = blocked.recv();
    }));
    m.publish("human", "v2");
    m.until(|m| m.storage.reads.lock().unwrap().len() == 2);
    m.publish("agent", "v3");
    m.tick();
    release.send(()).unwrap();
    m.until(|m| m.shown().as_deref() == Some(&markdown.text("agent")) && !m.docs.busy());
    assert!(
        !m.opened.contains(&markdown.text("human")),
        "the obsolete read reached the view: {:?}",
        m.opened
    );
    assert_eq!(m.storage.reads.lock().unwrap().len(), 3);
    m.assert_no_writes();
}

/// A failed refresh read keeps the last stable text without writing, and a
/// later successful read brings the latest storage text.
#[gpui::test]
fn a_failed_refresh_read_keeps_the_last_stable_text(cx: &mut TestAppContext) {
    let markdown = native("matrix-note.md");
    let mut m = Matrix::new(cx, markdown);
    m.storage.failures.lock().unwrap().insert(
        markdown.path.into(),
        crate::workspace::Error::new(crate::workspace::ErrorKind::Io, "temporary read failure"),
    );
    m.publish("agent", "v2");
    let deadline = Instant::now() + Duration::from_secs(8);
    while m.storage.reads.lock().unwrap().len() < 2 || m.docs.busy() {
        m.tick();
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
    m.tick();
    m.assert_shown("alpha");
    assert!(!m.docs.dirty);
    assert!(m.storage.writes.lock().unwrap().is_empty());
    m.storage.failures.lock().unwrap().clear();
    m.now += Duration::from_secs(1);
    let latest = markdown.text("agent");
    m.until(|m| m.shown().as_deref() == Some(&latest));
    assert_eq!(m.storage.reads.lock().unwrap().len(), 3);
    m.assert_no_writes();
}

/// A change notification without paths is an intentional refresh of
/// everything: the open document rereads and shows the latest text.
#[gpui::test]
fn a_pathless_change_notification_refreshes_the_open_document(cx: &mut TestAppContext) {
    let markdown = native("matrix-note.md");
    let mut m = Matrix::new(cx, markdown);
    m.storage.put(markdown.path, &markdown.text("agent"), "v2");
    m.storage.publish(WatchEvent::Invalidated);
    let latest = markdown.text("agent");
    m.until(|m| m.shown().as_deref() == Some(&latest));
    assert_eq!(m.storage.reads.lock().unwrap().len(), 2);
    m.assert_no_writes();
}
