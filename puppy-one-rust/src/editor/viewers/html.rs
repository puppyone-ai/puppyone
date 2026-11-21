//! `HtmlViewer` (`viewers/html/HtmlViewer.tsx`): Interact (the page running
//! in the system web engine, relative assets from the document's folder,
//! the product's interaction CSS) and Source (the native code editor, which
//! owns the text, undo and saves). The pane menu's "HTML view mode"
//! segmented control switches between them; an empty page offers Source.
//!
//! Edit (`HtmlVisualSurface`, `html_visual`) flushes uncommitted block drafts
//! through the async `prepare` barrier (`VW-22`) before leaving `Mode::Edit`,
//! and shares normalized `viewportState` scroll progress (`VW-23`) with
//! Interact ([`html_interact`]).
use super::{
    code,
    html_interact::{Access, Interact},
    html_tools::{HtmlToolAction, HtmlToolMode, HtmlToolSnapshot},
    html_visual,
    source_split::SourceSplit,
    structured::theme_update_script,
    text::{DOCUMENT_EDITING_TOGGLE_ID, DOCUMENT_SOURCE_PANEL_TOGGLE_ID},
};
#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
use crate::editor::registry::SurfaceTestProbe;
use crate::{
    editor::{
        navigation::ReferenceContext,
        registry::{
            HostCommand, HtmlWindowTools, PaneEntries, PaneItemId, PaneSegmentId, SurfaceEvents,
            SurfaceRequest, ViewerSurface, viewer_budget,
        },
        workbench::{
            find::FindEvent,
            pane::{Item, ItemKind, Segment, Segmented, Switch},
            view_state::SurfaceViewState,
        },
    },
    localization::t,
    theme,
    typography::Scale,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    time::Duration,
};

/// The pane menu's folder access toggle (`html-folder-access`).
const FOLDER_ACCESS: &str = "html-folder-access";
const SOURCE_PREVIEW_REFRESH_DELAY: Duration = Duration::from_millis(300);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Preview,
    Edit,
    Source,
}

type FlushCallback = Box<dyn FnOnce(&mut Window, &mut App)>;

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    Box::new(surface(request, window, cx))
}

fn surface(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> HtmlSurface {
    let source: Rc<dyn ViewerSurface> = Rc::from(code::open_document(
        request,
        None,
        request.file_mode,
        window,
        cx,
    ));
    let scroll_ratio = Rc::new(Cell::new(0.0f32));
    let interact = Interact::new(request, source.clone(), scroll_ratio.clone(), window, cx);
    interact.refresh(cx);
    let empty = cx.new(|_| EmptyPage);
    let mode = Rc::new(Cell::new(Mode::Preview));
    let visual: Rc<RefCell<Option<html_visual::Session>>> = Rc::new(RefCell::new(None));
    let source_panel = Rc::new(Cell::new(false));
    let split = request.file_mode.then(|| {
        let mode = mode.clone();
        let visual = visual.clone();
        let interact = interact.clone();
        let empty = empty.clone();
        let source = source.clone();
        let panel_open = source_panel.clone();
        cx.new(|cx| {
            SourceSplit::new(
                move || page_element(mode.get(), &visual, &interact, &empty),
                move || panel_open.get().then(|| source.element()),
                cx,
            )
        })
    });
    let dark = Rc::new(Cell::new(request.dark));
    let name = Rc::new(RefCell::new(request.name.to_owned()));
    let read_only = Rc::new(Cell::new(false));
    {
        let mut actions = Vec::new();
        if let Some(path) = interact.local_file_path() {
            actions.push(super::web::WebFallbackAction::open_local_in_browser(path));
        }
        let mode_src = mode.clone();
        let split_weak = split.as_ref().map(|s| s.downgrade());
        let source_weak = Rc::downgrade(&source);
        actions.push(super::web::WebFallbackAction::view_source(
            move |window, cx| {
                mode_src.set(Mode::Source);
                if let Some(split) = split_weak.as_ref().and_then(|s| s.upgrade()) {
                    split.update(cx, |_, cx| cx.notify());
                }
                if let Some(source) = source_weak.upgrade()
                    && let Some(focus) = source.focus_handle(cx)
                {
                    focus.focus(window, cx);
                }
                window.refresh();
            },
        ));
        interact.set_fallback_actions(actions, cx);
    }
    {
        let window_handle = window.window_handle();
        let mode = mode.clone();
        let visual = visual.clone();
        let interact_ref = interact.clone();
        let source = source.clone();
        let split = split.clone();
        let dark = dark.clone();
        let name = name.clone();
        let read_only = read_only.clone();
        let scroll_ratio = scroll_ratio.clone();
        interact.set_on_edit(Rc::new(move |cx| {
            let lower = name.borrow().to_ascii_lowercase();
            if mode.get() != Mode::Preview
                || read_only.get()
                || !(lower.ends_with(".html") || lower.ends_with(".htm"))
                || source.composing(cx)
            {
                return;
            }
            let text = source.text(cx).unwrap_or_default();
            let doc_name = name.borrow().clone();
            if !html_visual::admits(&doc_name, &text) {
                return;
            }
            interact_ref.query_scroll(cx);
            let (mode, visual, interact_ref, source, split, dark, read_only, scroll_ratio) = (
                mode.clone(),
                visual.clone(),
                interact_ref.clone(),
                source.clone(),
                split.clone(),
                dark.clone(),
                read_only.clone(),
                scroll_ratio.clone(),
            );
            let _ = cx.update_window(window_handle, move |_, window, cx| {
                let unavailable: html_visual::Unavailable = {
                    let (mode, visual, interact, split) = (
                        mode.clone(),
                        visual.clone(),
                        interact_ref.clone(),
                        split.clone(),
                    );
                    Rc::new(move |window, cx| {
                        if mode.get() != Mode::Edit {
                            return;
                        }
                        interact.refresh(cx);
                        mode.set(Mode::Preview);
                        *interact.notice.borrow_mut() = Some(t("editor.html.unsupported").into());
                        if let Some(split) = &split {
                            split.update(cx, |_, cx| cx.notify());
                        }
                        interact.redraw(cx);
                        let visual = visual.clone();
                        window.on_next_frame(move |_, _| drop(visual.borrow_mut().take()));
                        window.refresh();
                    })
                };
                let on_find: html_visual::FindCallback = {
                    let interact = interact_ref.clone();
                    Rc::new(move |current, total, cx| {
                        interact.emit_find_result(current, total, cx);
                    })
                };
                let session = html_visual::Session::start(
                    html_visual::Params {
                        text,
                        name: doc_name,
                        folder: interact_ref.folder(),
                        assets: interact_ref.assets(),
                        dark: dark.get(),
                        enabled: !read_only.get(),
                        budget: viewer_budget("html-artifact"),
                        initial_scroll: scroll_ratio.get(),
                    },
                    source,
                    scroll_ratio,
                    unavailable,
                    on_find,
                    window,
                    cx,
                );
                *visual.borrow_mut() = Some(session);
                mode.set(Mode::Edit);
                if let Some(split) = &split {
                    split.update(cx, |_, cx| cx.notify());
                }
                interact_ref.redraw(cx);
                window.refresh();
            });
        }));
    }
    HtmlSurface {
        source,
        interact,
        empty,
        mode,
        file_mode: request.file_mode,
        source_panel,
        split,
        refresh_task: Rc::default(),
        dark,
        name,
        read_only,
        scroll_ratio,
        visual,
    }
}

/// `isHtmlDocumentEmpty`: only a definitely empty document — nothing but a
/// doctype, the html/head/body shell, comments, a title, metadata and
/// whitespace. Scripts, styles, stylesheets and refreshes may produce
/// content, so such pages still run in the preview.
pub fn is_empty_page(text: &str) -> bool {
    let mut rest = text;
    let mut in_title = false;
    while !rest.is_empty() {
        let Some(open) = rest.find('<') else {
            return in_title || rest.trim().is_empty();
        };
        if !in_title && !rest[..open].trim().is_empty() {
            return false;
        }
        rest = &rest[open..];
        if let Some(comment) = rest.strip_prefix("<!--") {
            rest = comment.find("-->").map_or("", |end| &comment[end + 3..]);
            continue;
        }
        let Some(close) = tag_end(rest) else {
            // An unterminated tag is text to the parser.
            return in_title;
        };
        let tag = &rest[1..close];
        rest = &rest[close + 1..];
        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>()
            .to_ascii_lowercase();
        if in_title {
            if closing && name == "title" {
                in_title = false;
            }
            continue;
        }
        match name.as_str() {
            "" if tag.starts_with('!') => {}
            "html" | "head" | "body" | "base" => {}
            "title" => in_title = !closing,
            "meta" => {
                let refresh =
                    meta_http_equiv(tag).is_some_and(|value| value.eq_ignore_ascii_case("refresh"));
                if refresh {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}

/// The index of the `>` that ends the tag `tag` opens, outside quotes.
fn tag_end(tag: &str) -> Option<usize> {
    let mut quote = None;
    for (index, c) in tag.char_indices().skip(1) {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(index),
            _ => {}
        }
    }
    None
}

/// A `<meta>` tag's `http-equiv` value.
fn meta_http_equiv(tag: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let at = lower.find("http-equiv")?;
    let value = tag[at + "http-equiv".len()..]
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    Some(match value.chars().next()? {
        quote @ ('"' | '\'') => value[1..].split(quote).next()?.to_owned(),
        _ => value
            .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .next()?
            .to_owned(),
    })
}

fn page_element(
    mode: Mode,
    visual: &RefCell<Option<html_visual::Session>>,
    interact: &Interact,
    empty: &Entity<EmptyPage>,
) -> AnyElement {
    let body = match mode {
        Mode::Source => div().size_full().into_any_element(),
        Mode::Edit => match visual.borrow().as_ref() {
            Some(session) => session.frame.clone().into_any_element(),
            None => div().size_full().into_any_element(),
        },
        Mode::Preview if interact.is_empty.get() => empty.clone().into_any_element(),
        Mode::Preview => interact.element(),
    };
    let notice = interact.notice.borrow().clone().map(|text| {
        let notice = interact.notice.clone();
        div().flex_shrink_0().p(px(8.)).child(
            crate::ui::components::FloatingNotice::new("html-editor-notice", text)
                .tone(crate::ui::components::NoticeTone::Danger)
                .on_dismiss(move |window, _| {
                    notice.borrow_mut().take();
                    window.refresh();
                }),
        )
    });
    div()
        .size_full()
        .flex()
        .flex_col()
        .children(notice)
        .child(div().flex_1().min_h_0().child(body))
        .into_any_element()
}

struct HtmlSurface {
    source: Rc<dyn ViewerSurface>,
    interact: Interact,
    empty: Entity<EmptyPage>,
    mode: Rc<Cell<Mode>>,
    file_mode: bool,
    source_panel: Rc<Cell<bool>>,
    split: Option<Entity<SourceSplit>>,
    refresh_task: Rc<RefCell<Option<Task<()>>>>,
    dark: Rc<Cell<bool>>,
    name: Rc<RefCell<String>>,
    read_only: Rc<Cell<bool>>,
    scroll_ratio: Rc<Cell<f32>>,
    /// The Edit page while Edit mode is shown.
    visual: Rc<RefCell<Option<html_visual::Session>>>,
}

impl Drop for HtmlSurface {
    fn drop(&mut self) {
        // The page callbacks hold the surface's parts: without them the
        // pages, the Edit session and the source view go with the surface.
        self.interact.retire();
        let session = self.visual.borrow_mut().take();
        drop(session);
    }
}

impl HtmlSurface {
    fn notify_split(&self, cx: &mut App) {
        if let Some(split) = &self.split {
            split.update(cx, |_, cx| cx.notify());
        }
    }

    fn set_source_panel(&self, open: bool, window: &mut Window, cx: &mut App) {
        if !self.file_mode || open == self.source_panel.get() {
            return;
        }
        self.interact.notice.borrow_mut().take();
        if !open {
            if self.source.composing(cx) {
                *self.interact.notice.borrow_mut() =
                    Some(t("editor.html.finishComposition").into());
                self.notify_split(cx);
                return;
            }
            self.refresh_task.borrow_mut().take();
            if self.mode.get() == Mode::Preview {
                self.interact.refresh(cx);
            }
        }
        self.source_panel.set(open);
        self.notify_split(cx);
        if open && let Some(focus) = self.source.focus_handle(cx) {
            focus.focus(window, cx);
        }
    }

    /// `canVisualEdit`: an editable HTML document.
    fn can_visual_edit(&self) -> bool {
        let lower = self.name.borrow().to_ascii_lowercase();
        !self.read_only.get() && (lower.ends_with(".html") || lower.ends_with(".htm"))
    }

    fn start_visual(&self, window: &mut Window, cx: &mut App) -> bool {
        let text = self.source.text(cx).unwrap_or_default();
        let name = self.name.borrow().clone();
        if !html_visual::admits(&name, &text) {
            *self.interact.notice.borrow_mut() = Some(t("editor.html.unsupported").into());
            self.notify_split(cx);
            return false;
        }
        self.interact.query_scroll(cx);
        let unavailable: html_visual::Unavailable = {
            let (mode, visual, interact, split) = (
                self.mode.clone(),
                self.visual.clone(),
                self.interact.clone(),
                self.split.clone(),
            );
            Rc::new(move |window, cx| {
                if mode.get() != Mode::Edit {
                    return;
                }
                interact.refresh(cx);
                mode.set(Mode::Preview);
                *interact.notice.borrow_mut() = Some(t("editor.html.unsupported").into());
                if let Some(split) = &split {
                    split.update(cx, |_, cx| cx.notify());
                }
                interact.redraw(cx);
                let visual = visual.clone();
                window.on_next_frame(move |_, _| drop(visual.borrow_mut().take()));
                window.refresh();
            })
        };
        let on_find: html_visual::FindCallback = {
            let interact = self.interact.clone();
            Rc::new(move |current, total, cx| {
                interact.emit_find_result(current, total, cx);
            })
        };
        let session = html_visual::Session::start(
            html_visual::Params {
                text,
                name,
                folder: self.interact.folder(),
                assets: self.interact.assets(),
                dark: self.dark.get(),
                enabled: !self.read_only.get(),
                budget: viewer_budget("html-artifact"),
                initial_scroll: self.scroll_ratio.get(),
            },
            self.source.clone(),
            self.scroll_ratio.clone(),
            unavailable,
            on_find,
            window,
            cx,
        );
        *self.visual.borrow_mut() = Some(session);
        true
    }

    /// Flushes any uncommitted visual draft via `prepare` (`VW-22`) BEFORE
    /// tearing down `Session` and completing the transition to `next`.
    fn leave_edit_to(
        &self,
        next: Mode,
        after: Option<FlushCallback>,
        window: &mut Window,
        cx: &mut App,
    ) {
        let mode = self.mode.clone();
        let visual = self.visual.clone();
        let source = self.source.clone();
        let interact = self.interact.clone();
        let split = self.split.clone();

        let finish = move |window: &mut Window, cx: &mut App| {
            visual.borrow_mut().take();
            source.reveal_range(None, window, cx);
            if next == Mode::Preview {
                interact.refresh(cx);
            }
            mode.set(next);
            if let Some(split) = &split {
                split.update(cx, |_, cx| cx.notify());
            }
            interact.redraw(cx);
            if next == Mode::Source
                && let Some(focus) = source.focus_handle(cx)
            {
                focus.focus(window, cx);
            }
            if let Some(after) = after {
                after(window, cx);
            }
        };

        let ready_session = self.visual.borrow().as_ref().is_some_and(|s| s.is_ready());
        if ready_session {
            if let Some(session) = self.visual.borrow().as_ref() {
                session.prepare(window, cx, finish);
            }
        } else {
            finish(window, cx);
        }
    }

    #[cfg(test)]
    fn scroll_ratio(&self) -> f32 {
        self.scroll_ratio.get()
    }
}

impl ViewerSurface for HtmlSurface {
    fn set_reference_context(&self, context: Option<ReferenceContext>, cx: &mut App) {
        self.interact.set_references(context.clone());
        self.source.set_reference_context(context, cx);
    }

    fn element(&self) -> AnyElement {
        if let Some(split) = &self.split {
            return split.clone().into_any_element();
        }
        if self.mode.get() == Mode::Source {
            return self.source.element();
        }
        page_element(self.mode.get(), &self.visual, &self.interact, &self.empty)
    }

    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        let split_for_interact = self.split.clone();
        let events_for_interact = events.clone();
        self.interact.set_events(Rc::new(move |event, cx| {
            if matches!(event, crate::editor::registry::SurfaceEvent::Redraw)
                && let Some(split) = &split_for_interact
            {
                split.update(cx, |_, cx| cx.notify());
            }
            events_for_interact(event, cx);
        }));
        let (visual, source, interact, mode, source_panel, refresh_task, file_mode) = (
            self.visual.clone(),
            self.source.clone(),
            self.interact.clone(),
            self.mode.clone(),
            self.source_panel.clone(),
            self.refresh_task.clone(),
            self.file_mode,
        );
        let forward: SurfaceEvents = Rc::new(move |event, cx| {
            if matches!(event, crate::editor::registry::SurfaceEvent::Changed) {
                if let Some(text) = source.text(cx)
                    && let Some(session) = visual.borrow().as_ref()
                {
                    session.sync(&text, cx);
                }
                if file_mode && source_panel.get() && mode.get() == Mode::Preview {
                    let interact_for_task = interact.clone();
                    let task = interact.frame.update(cx, |_, cx| {
                        cx.spawn(async move |_, cx| {
                            cx.background_executor()
                                .timer(SOURCE_PREVIEW_REFRESH_DELAY)
                                .await;
                            cx.update(|cx| interact_for_task.refresh(cx));
                        })
                    });
                    *refresh_task.borrow_mut() = Some(task);
                }
            }
            events(event, cx)
        });
        self.source.subscribe(forward, cx)
    }

    fn text(&self, cx: &App) -> Option<String> {
        self.source.text(cx)
    }

    fn composing(&self, cx: &App) -> bool {
        self.source.composing(cx)
            || self
                .visual
                .borrow()
                .as_ref()
                .is_some_and(|s| s.has_pending_prepare())
    }

    fn replace_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.source.replace_text(text, window, cx);
        match self.mode.get() {
            Mode::Preview => self.interact.refresh(cx),
            Mode::Edit => {
                let text = self.source.text(cx).unwrap_or_default();
                if let Some(session) = self.visual.borrow().as_ref() {
                    session.sync(&text, cx);
                }
            }
            Mode::Source => {}
        }
    }

    fn rebind_name(&self, name: &str, cx: &mut App) {
        *self.name.borrow_mut() = name.to_owned();
        self.source.rebind_name(name, cx);
        self.interact.rename(name, cx);
    }

    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        if self.file_mode
            && self.source_panel.get()
            && self
                .source
                .focus_handle(cx)
                .is_some_and(|h| h.is_focused(window))
        {
            self.source.undo(redo, window, cx);
            return;
        }
        match self.mode.get() {
            Mode::Source => self.source.undo(redo, window, cx),
            Mode::Edit => {
                if let Some(session) = self.visual.borrow().as_ref() {
                    session.history(redo, &*self.source, window, cx);
                }
            }
            Mode::Preview => {
                if self.file_mode && self.source_panel.get() {
                    self.source.undo(redo, window, cx);
                }
            }
        }
    }

    fn apply(&self, read_only: bool, dark: bool, scale: Scale, window: &mut Window, cx: &mut App) {
        self.source.apply(read_only, dark, scale, window, cx);
        self.read_only.set(read_only);
        self.interact.set_dark(dark);
        let restyle = self.dark.replace(dark) != dark;
        if self.mode.get() == Mode::Edit {
            if read_only {
                // Flush any pending visual draft before leaving Edit for Interact.
                self.leave_edit_to(Mode::Preview, None, window, cx);
            } else if restyle {
                if let Some(session) = self.visual.borrow().as_ref() {
                    let script = theme_update_script(dark);
                    session.frame.update(cx, |f, _| {
                        f.apply_theme_in_place(dark, &script, None);
                    });
                }
                self.notify_split(cx);
            } else if let Some(session) = self.visual.borrow().as_ref() {
                session.set_enabled(true, cx);
            }
        }
    }

    fn view_state(&self, cx: &App) -> Option<SurfaceViewState> {
        let mut base = self.source.view_state(cx).unwrap_or_default();
        let mode = match self.mode.get() {
            Mode::Preview => "preview",
            Mode::Edit => "edit",
            Mode::Source => "source",
        };
        base.mode = Some(mode.to_owned());
        if self.mode.get() != Mode::Source {
            base.scroll_y = self.scroll_ratio.get().clamp(0.0, 1.0);
        }
        Some(base)
    }

    fn restore_view_state(&self, state: &SurfaceViewState, window: &mut Window, cx: &mut App) {
        self.source.restore_view_state(state, window, cx);
        match state.mode.as_deref() {
            Some("source") => {
                self.pane_segment(PaneSegmentId::Source, window, cx);
            }
            Some("edit") => {
                let ratio = state.scroll_y.clamp(0.0, 1.0);
                self.scroll_ratio.set(ratio);
                self.pane_segment(PaneSegmentId::Edit, window, cx);
            }
            _ => {
                let ratio = state.scroll_y.clamp(0.0, 1.0);
                if (ratio - self.scroll_ratio.get()).abs() > f32::EPSILON {
                    self.scroll_ratio.set(ratio);
                    self.interact.refresh(cx);
                }
                if self.mode.get() != Mode::Preview {
                    self.pane_segment(PaneSegmentId::Preview, window, cx);
                }
            }
        }
    }

    fn command(&self, cmd: HostCommand, window: &mut Window, cx: &mut App) {
        match cmd {
            HostCommand::HtmlReload => {
                self.interact.frame.update(cx, |f, _| f.reload());
            }
            HostCommand::Prepare => {
                if let Some(session) = self.visual.borrow().as_ref() {
                    session.prepare(window, cx, |_, _| {});
                }
            }
            HostCommand::Source if self.file_mode => {
                self.set_source_panel(!self.source_panel.get(), window, cx);
            }
            other => {
                self.source.command(other, window, cx);
            }
        }
    }

    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        if self.mode.get() == Mode::Source || (self.file_mode && self.source_panel.get()) {
            return self.source.focus_handle(cx);
        }
        None
    }

    fn pane(&self, cx: &App) -> PaneEntries {
        let access = self.interact.access();
        let mut items = Vec::new();
        if !matches!(access, Access::None | Access::Checking) {
            items.push(Item {
                id: FOLDER_ACCESS,
                label: t("editor.html.folderAccessToggle").into(),
                kind: ItemKind::Toggle(access == Access::Allowed),
            });
        }
        if self.file_mode {
            let mut toggles = Vec::new();
            if self.can_visual_edit() {
                toggles.push(Switch {
                    id: DOCUMENT_EDITING_TOGGLE_ID,
                    icon: "pencil",
                    label: t("editor.controls.edit").into(),
                    checked: self.mode.get() == Mode::Edit,
                });
            }
            toggles.push(Switch {
                id: DOCUMENT_SOURCE_PANEL_TOGGLE_ID,
                icon: "editor-mode-source",
                label: t("editor.controls.source").into(),
                checked: self.source_panel.get(),
            });
            return PaneEntries {
                segmented: None,
                toggles,
                items,
                find: true,
            };
        }
        let mut entries = match self.mode.get() {
            Mode::Source => self.source.pane(cx),
            Mode::Preview | Mode::Edit => PaneEntries {
                find: true,
                ..Default::default()
            },
        };
        let mut options = vec![Segment {
            id: "preview",
            icon: "mouse-pointer-2",
            label: t("editor.html.interact").into(),
        }];
        if self.can_visual_edit() {
            options.push(Segment {
                id: "edit",
                icon: "pencil",
                label: t("editor.html.edit").into(),
            });
        }
        options.push(Segment {
            id: "source",
            icon: "editor-mode-source",
            label: t("editor.mode.source").into(),
        });
        entries.segmented = Some(Segmented {
            label: t("editor.html.mode").into(),
            options,
            value: match self.mode.get() {
                Mode::Preview => "preview",
                Mode::Edit => "edit",
                Mode::Source => "source",
            },
        });
        entries.items.extend(items);
        entries
    }

    fn pane_segment(&self, segment: PaneSegmentId, window: &mut Window, cx: &mut App) {
        let next = match segment {
            PaneSegmentId::Source => Mode::Source,
            PaneSegmentId::Edit => Mode::Edit,
            _ => Mode::Preview,
        };
        if next == self.mode.get() || next == Mode::Edit && !self.can_visual_edit() {
            return;
        }
        self.interact.notice.borrow_mut().take();
        if self.source.composing(cx) {
            *self.interact.notice.borrow_mut() = Some(t("editor.html.finishComposition").into());
            self.notify_split(cx);
            return;
        }
        if self.mode.get() == Mode::Edit {
            self.leave_edit_to(next, None, window, cx);
            return;
        }
        if next == Mode::Edit {
            self.interact.set_tool_mode(HtmlToolMode::None, cx);
            if !self.start_visual(window, cx) {
                return;
            }
        }
        if next == Mode::Preview {
            self.interact.refresh(cx);
        }
        self.mode.set(next);
        self.notify_split(cx);
        if next == Mode::Source
            && let Some(focus) = self.source.focus_handle(cx)
        {
            focus.focus(window, cx);
        }
    }

    fn pane_item(&self, item: PaneItemId, window: &mut Window, cx: &mut App) {
        match item {
            PaneItemId::HtmlFolderAccess => {
                let allowed = self.interact.access() == Access::Allowed;
                self.interact.set_allowed(!allowed, cx);
            }
            PaneItemId::DocumentEditing => {
                let next = if self.mode.get() == Mode::Edit {
                    PaneSegmentId::Preview
                } else {
                    PaneSegmentId::Edit
                };
                self.pane_segment(next, window, cx);
            }
            PaneItemId::DocumentSourcePanel => {
                self.set_source_panel(!self.source_panel.get(), window, cx);
            }
            other => self.source.pane_item(other, window, cx),
        }
    }

    fn find(&self, event: FindEvent, window: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        if self.mode.get() == Mode::Source
            || (self.file_mode
                && self.source_panel.get()
                && self
                    .source
                    .focus_handle(cx)
                    .is_some_and(|h| h.is_focused(window)))
        {
            return self.source.find(event, window, cx);
        }
        match self.mode.get() {
            Mode::Edit => self
                .visual
                .borrow()
                .as_ref()
                .and_then(|session| session.frame.read(cx).find(event, cx)),
            Mode::Preview => self.interact.frame.read(cx).find(event, cx),
            Mode::Source => self.source.find(event, window, cx),
        }
    }

    fn as_html_tools(&self) -> Option<&dyn HtmlWindowTools> {
        Some(self)
    }

    #[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
    fn as_test_probe(&self) -> Option<&dyn SurfaceTestProbe> {
        Some(self)
    }
}

impl HtmlWindowTools for HtmlSurface {
    fn html_tool_state(&self) -> Option<HtmlToolSnapshot> {
        self.file_mode.then(|| {
            self.interact
                .tool_snapshot(self.mode.get() == Mode::Edit, self.source_panel.get())
        })
    }

    fn set_html_tool(&self, mode: HtmlToolMode, window: &mut Window, cx: &mut App) {
        if !self.file_mode {
            return;
        }
        if mode != HtmlToolMode::None && self.mode.get() == Mode::Edit {
            let interact = self.interact.clone();
            self.leave_edit_to(
                Mode::Preview,
                Some(Box::new(move |_, cx| interact.set_tool_mode(mode, cx))),
                window,
                cx,
            );
            return;
        }
        self.interact.set_tool_mode(mode, cx);
    }

    fn trigger_html_action(&self, action: HtmlToolAction, window: &mut Window, cx: &mut App) {
        if !self.file_mode {
            return;
        }
        if matches!(
            action,
            HtmlToolAction::ReloadAndReset | HtmlToolAction::CaptureFullPage
        ) && self.mode.get() == Mode::Edit
        {
            let interact = self.interact.clone();
            self.leave_edit_to(
                Mode::Preview,
                Some(Box::new(move |_, cx| {
                    interact.trigger_tool_action(action, cx)
                })),
                window,
                cx,
            );
            return;
        }
        self.interact.trigger_tool_action(action, cx);
    }
}

#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
impl SurfaceTestProbe for HtmlSurface {
    #[cfg(test)]
    fn html_visual_deliver(&self, body: &str) -> bool {
        self.visual
            .borrow()
            .as_ref()
            .is_some_and(|s| s.deliver(body))
    }

    #[cfg(any(test, feature = "test-support"))]
    fn html_page_deliver(&self, body: &str, cx: &mut App) -> Option<SharedString> {
        self.interact.deliver(body, cx);
        self.interact.notice()
    }

    #[cfg(test)]
    fn code_editor(&self) -> Option<Entity<code::CodeView>> {
        self.source.as_test_probe()?.code_editor()
    }

    #[cfg(test)]
    fn page_entry(&self, cx: &App) -> Option<String> {
        self.interact.current_entry_html(cx)
    }
}

/// `HtmlDocumentEmpty`: an actionable empty page instead of a blank frame.
struct EmptyPage;
impl Render for EmptyPage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(6.))
            .p(px(24.))
            .bg(p.canvas)
            .child(
                div()
                    .text_size(px(theme::ty().ui.body))
                    .text_color(p.text)
                    .child(t("editor.html.emptyTitle")),
            )
            .child(
                div()
                    .text_size(px(theme::ty().ui.meta))
                    .text_color(p.subtle)
                    .child(t("editor.html.emptyDescription")),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::registry::{EditorDocument, SourceKind, SurfaceInput, resolve};
    use core::prelude::v1::test;

    #[test]
    fn previews_carry_the_interaction_stylesheet_and_empty_pages_are_recognised() {
        use super::super::{html_interact::preview_html, html_preview::INTERACTIVE_CSP};
        let page = preview_html(
            "<html><head><title>x</title></head><body>hi</body></html>",
            INTERACTIVE_CSP,
            "",
        );
        assert!(page.contains("puppyone-html-preview-interaction"));
        assert!(
            page.find("puppyone-html-preview-interaction").unwrap() < page.find("</head>").unwrap()
        );
        assert!(page.contains("connect-src https:"));
        assert!(
            preview_html("<p>bare</p>", INTERACTIVE_CSP, "")
                .starts_with("<meta http-equiv=\"Content-Security-Policy\"")
        );
        assert!(is_empty_page(
            "<!DOCTYPE html>\n<html><head></head><body>\n</body></html>"
        ));
        assert!(is_empty_page("  <!-- nothing -->  "));
        assert!(!is_empty_page("<body><p>content</p></body>"));
    }

    /// `htmlDocumentEmpty.test.ts`: `recognizes an empty page without
    /// changing its source`; `keeps visible and potentially dynamic content
    /// in the preview`.
    #[test]
    fn an_empty_page_is_recognised_and_dynamic_content_is_kept() {
        for source in [
            "",
            " \n",
            "<!-- empty -->",
            "<!doctype html><html><head><title>Untitled</title><meta charset=\"utf-8\"></head><body>\n</body></html>",
            // The New HTML document template.
            "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Untitled</title>\n</head>\n<body>\n\n</body>\n</html>\n",
        ] {
            assert!(is_empty_page(source), "{source:?}");
        }
        for source in [
            "<h1>Hello</h1>",
            "<img src=\"cover.png\">",
            "<svg></svg>",
            "<canvas></canvas>",
            "<div id=\"root\"></div><script>document.querySelector(\"#root\").textContent=\"Ready\"</script>",
            "<script>document.body.textContent=\"Ready\"</script>",
            "<style>body::before{content:\"Hello\"}</style>",
            "<link rel=\"stylesheet\" href=\"page.css\">",
            "<meta http-equiv=\"refresh\" content=\"0;url=next.html\">",
        ] {
            assert!(!is_empty_page(source), "{source:?}");
        }
    }

    fn open_html_surface(
        id: &str,
        name: &str,
        text: &str,
        workspace: Option<std::sync::Arc<crate::workspace::Workspace>>,
        folder: Option<std::path::PathBuf>,
        window: &mut Window,
        cx: &mut App,
    ) -> HtmlSurface {
        let doc = EditorDocument::local(name);
        let resolved = resolve(&doc);
        let request = SurfaceRequest {
            id,
            name,
            input: SurfaceInput::Text(text),
            format: resolved.format,
            resolved_extension: Some(".html"),
            dark: false,
            scale: Scale::default(),
            workspace,
            file_mode: false,
            folder,
            web_source: None,
            assets: None,
            references: None,
            source_kind: SourceKind::Local,
            models: Default::default(),
        };
        let source: Rc<dyn ViewerSurface> =
            Rc::from(code::open_with(&request, None, false, window, cx));
        let scroll_ratio = Rc::new(Cell::new(0.0f32));
        let interact = Interact::new(&request, source.clone(), scroll_ratio.clone(), window, cx);
        interact.refresh(cx);
        let empty = cx.new(|_| EmptyPage);
        HtmlSurface {
            source,
            interact,
            empty,
            mode: Rc::new(Cell::new(Mode::Preview)),
            file_mode: false,
            source_panel: Rc::new(Cell::new(false)),
            split: None,
            refresh_task: Rc::default(),
            dark: Rc::new(Cell::new(false)),
            name: Rc::new(RefCell::new(name.to_owned())),
            read_only: Rc::new(Cell::new(false)),
            scroll_ratio,
            visual: Rc::new(RefCell::new(None)),
        }
    }

    /// `VW-22`, `VW-23` & `VW-41`: Switching out of `Mode::Edit` waits for the
    /// `prepare` flush barrier and commits any final `Inbound::Edit` draft into
    /// `source` before destroying `Session`, while preserving `scroll_ratio`
    /// across `Preview` and `Edit`.
    #[gpui::test]
    fn prepare_barrier_flushes_pending_visual_draft_and_preserves_scroll_ratio(
        cx: &mut TestAppContext,
    ) {
        cx.update(|cx| {
            if cx.try_global::<gpui_kit::component::Theme>().is_none() {
                gpui_kit::init(cx);
            }
            cx.text_system()
                .add_fonts(crate::editor::view::style::font_bytes())
                .unwrap();
        });
        let text = "<!doctype html><html><head></head><body><h1>Draft</h1></body></html>";
        let (_, cx) = cx.add_window_view(|_, _| EmptyPage);
        let surface: Rc<HtmlSurface> = cx.update(|window, cx| {
            Rc::new(open_html_surface(
                "html-prep",
                "site/index.html",
                text,
                None,
                None,
                window,
                cx,
            ))
        });

        // 1. Scroll in Preview (`VW-23`), then enter Edit mode.
        cx.update(|_, cx| {
            surface.html_page_deliver(r#"{"type":"scroll","ratio":0.62}"#, cx);
            assert!((surface.scroll_ratio() - 0.62).abs() < 0.001);
        });
        cx.update(|window, cx| surface.pane_segment(PaneSegmentId::Edit, window, cx));
        assert!(cx.update(|_, _| surface.html_visual_deliver(r#"{"type":"ready"}"#)));
        cx.run_until_parked();

        // Scroll inside Edit mode updates the shared `viewportState`.
        assert!(cx.update(|_, _| surface.html_visual_deliver(r#"{"type":"scroll","ratio":0.78}"#)));
        cx.run_until_parked();
        assert!((surface.scroll_ratio() - 0.78).abs() < 0.001);

        // 2. Request switching out of Edit -> Preview: Session stays alive until `prepared`!
        cx.update(|window, cx| surface.pane_segment(PaneSegmentId::Preview, window, cx));
        cx.update(|_, cx| {
            assert_eq!(surface.pane(cx).segmented.unwrap().value, "edit");
            assert!(surface.composing(cx));
        });

        // Page's `registerPrepare` flushes its active block draft, then replies `prepared`.
        let from = text.find("Draft").unwrap();
        let flush_edit = format!(
            r#"{{"type":"edit","generation":1,"edits":[{{"from":{from},"to":{},"insert":"Committed"}}]}}"#,
            from + 5
        );
        assert!(cx.update(|_, _| surface.html_visual_deliver(&flush_edit)));
        assert!(
            cx.update(|_, _| surface.html_visual_deliver(r#"{"type":"prepared","request":1}"#))
        );
        cx.run_until_parked();

        cx.update(|_, cx| {
            assert_eq!(surface.pane(cx).segmented.unwrap().value, "preview");
            assert!(!surface.composing(cx));
            assert_eq!(
                surface.text(cx).as_deref(),
                Some(text.replace("Draft", "Committed").as_str())
            );
            // Preview's regenerated entry HTML carries the preserved 0.78 scroll ratio!
            let html = surface.interact.current_entry_html(cx).unwrap();
            assert!(html.contains("init=0.780000"), "{html}");
        });
    }

    /// `TODO-94`: `rebind_name` updates `Interact`'s bound path and immediately
    /// refreshes non-empty documents so `link_script`'s `sourceUrl` matches the
    /// renamed file.
    #[gpui::test]
    fn rebind_name_refreshes_interact_source_url_and_path(cx: &mut TestAppContext) {
        cx.update(|cx| {
            if cx.try_global::<gpui_kit::component::Theme>().is_none() {
                gpui_kit::init(cx);
            }
            cx.text_system()
                .add_fonts(crate::editor::view::style::font_bytes())
                .unwrap();
        });
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let site = root.join("site");
        std::fs::create_dir(&site).unwrap();
        std::fs::write(site.join("before.html"), "<body><p>Hello</p></body>").unwrap();
        let ws = crate::workspace::Workspace::open(&root).unwrap();

        let (_, cx) = cx.add_window_view(|_, _| EmptyPage);
        let surface: Rc<HtmlSurface> = cx.update(|window, cx| {
            Rc::new(open_html_surface(
                "html-rename",
                "site/before.html",
                "<!doctype html><html><body><p>Hello</p></body></html>",
                Some(ws),
                Some(site),
                window,
                cx,
            ))
        });

        cx.update(|_, cx| {
            let html_before = surface.interact.current_entry_html(cx).unwrap();
            assert!(html_before.contains("puppyone-preview://local/before.html"));
            surface.rebind_name("site/after.html", cx);
            assert_eq!(surface.interact.bound_name(), "site/after.html");
            let html_after = surface.interact.current_entry_html(cx).unwrap();
            assert!(
                html_after.contains("puppyone-preview://local/after.html"),
                "{html_after}"
            );
            assert!(!html_after.contains("before.html"));
        });
    }

    /// Closing an HTML document takes its pages with it. The page's edit
    /// callback and the Edit session's callbacks hold parts of the surface;
    /// neither may keep the pages or the source view alive once it is gone.
    #[gpui::test]
    fn a_dropped_surface_releases_its_pages_and_source_view(cx: &mut TestAppContext) {
        cx.update(|cx| {
            if cx.try_global::<gpui_kit::component::Theme>().is_none() {
                gpui_kit::init(cx);
            }
            cx.text_system()
                .add_fonts(crate::editor::view::style::font_bytes())
                .unwrap();
        });
        let text = "<!doctype html><html><head></head><body><h1>Draft</h1></body></html>";
        let (_, cx) = cx.add_window_view(|_, _| EmptyPage);
        let (source, page, edit_page) = cx.update(|window, cx| {
            let resolved = resolve(&EditorDocument::local("site/index.html"));
            let surface = surface(
                &SurfaceRequest {
                    id: "html-drop",
                    name: "site/index.html",
                    input: SurfaceInput::Text(text),
                    format: resolved.format,
                    resolved_extension: Some(".html"),
                    dark: false,
                    scale: Scale::default(),
                    workspace: None,
                    file_mode: false,
                    folder: None,
                    web_source: None,
                    assets: None,
                    references: None,
                    source_kind: SourceKind::Local,
                    models: Default::default(),
                },
                window,
                cx,
            );
            surface.pane_segment(PaneSegmentId::Edit, window, cx);
            let edit_page = surface.visual.borrow().as_ref().unwrap().frame.downgrade();
            (
                surface.code_editor().unwrap().downgrade(),
                surface.interact.frame.downgrade(),
                edit_page,
            )
        });
        cx.run_until_parked();
        cx.update(|window, cx| window.draw(cx).clear(cx));
        assert!(source.upgrade().is_none(), "the source view leaked");
        assert!(page.upgrade().is_none(), "the Interact page leaked");
        assert!(edit_page.upgrade().is_none(), "the Edit page leaked");
    }

    #[gpui::test]
    fn html_file_mode_source_panel_and_standalone_mode_menus(cx: &mut TestAppContext) {
        cx.update(|cx| {
            if cx.try_global::<gpui_kit::component::Theme>().is_none() {
                gpui_kit::init(cx);
            }
            cx.text_system()
                .add_fonts(crate::editor::view::style::font_bytes())
                .unwrap();
        });
        let (_, cx) = cx.add_window_view(|_, _| EmptyPage);
        let open = |id: &str,
                    name: &str,
                    text: &str,
                    file_mode: bool,
                    source_kind: SourceKind,
                    window: &mut Window,
                    cx: &mut App| {
            let doc = EditorDocument::with_source(name, source_kind);
            let resolved = resolve(&doc);
            surface(
                &SurfaceRequest {
                    id,
                    name,
                    input: SurfaceInput::Text(text),
                    format: resolved.format,
                    resolved_extension: Some(".html"),
                    dark: false,
                    scale: Scale::default(),
                    workspace: None,
                    file_mode,
                    folder: None,
                    web_source: None,
                    assets: None,
                    references: None,
                    source_kind,
                    models: Default::default(),
                },
                window,
                cx,
            )
        };

        // 1. File mode offers Edit and Source panel switches (no segmented mode menu),
        //    opens on the page, opens source beside page, and keeps source open while editing.
        cx.update(|window, cx| {
            let s = open(
                "html-file-mode",
                "page.html",
                "<h1>Page</h1>",
                true,
                SourceKind::Local,
                window,
                cx,
            );
            let pane = s.pane(cx);
            assert!(pane.segmented.is_none());
            assert_eq!(
                pane.toggles
                    .iter()
                    .map(|t| (t.id, t.checked))
                    .collect::<Vec<_>>(),
                vec![
                    (DOCUMENT_EDITING_TOGGLE_ID, false),
                    (DOCUMENT_SOURCE_PANEL_TOGGLE_ID, false),
                ]
            );
            assert_eq!(s.mode.get(), Mode::Preview);
            assert!(!s.source_panel.get());

            s.pane_item(PaneItemId::DocumentSourcePanel, window, cx);
            assert!(s.source_panel.get());
            assert_eq!(s.text(cx).as_deref(), Some("<h1>Page</h1>"));

            s.pane_item(PaneItemId::DocumentEditing, window, cx);
            assert_eq!(s.mode.get(), Mode::Edit);
            assert!(
                s.source_panel.get(),
                "source stays open beside page while editing"
            );

            s.pane_item(PaneItemId::DocumentSourcePanel, window, cx);
            assert!(!s.source_panel.get());

            // Read-only HTML page omits Edit switch and offers only Source panel.
            s.read_only.set(true);
            let ro_pane = s.pane(cx);
            assert_eq!(
                ro_pane.toggles.iter().map(|t| t.id).collect::<Vec<_>>(),
                vec![DOCUMENT_SOURCE_PANEL_TOGGLE_ID]
            );
        });

        // 2. Standalone mode menus stay local to each pane, hide Edit when read-only,
        //    and empty pages transition to non-empty after editing source.
        cx.update(|window, cx| {
            let empty_src =
                "<!doctype html><html><head><title>Untitled</title></head><body>\n</body></html>";
            let editable = open(
                "html-pane-1",
                "one.html",
                empty_src,
                false,
                SourceKind::Local,
                window,
                cx,
            );
            let readonly = open(
                "html-pane-2",
                "two.html",
                "<p>Page</p>",
                false,
                SourceKind::Cloud,
                window,
                cx,
            );
            readonly.read_only.set(true);

            assert!(is_empty_page(empty_src));
            assert_eq!(
                editable
                    .pane(cx)
                    .segmented
                    .unwrap()
                    .options
                    .iter()
                    .map(|o| o.id)
                    .collect::<Vec<_>>(),
                vec!["preview", "edit", "source"]
            );
            assert_eq!(
                readonly
                    .pane(cx)
                    .segmented
                    .unwrap()
                    .options
                    .iter()
                    .map(|o| o.id)
                    .collect::<Vec<_>>(),
                vec!["preview", "source"]
            );

            editable.pane_segment(PaneSegmentId::Source, window, cx);
            assert_eq!(editable.text(cx).as_deref(), Some(empty_src));
            editable.replace_text("<h1>Now visible</h1>", window, cx);
            editable.pane_segment(PaneSegmentId::Preview, window, cx);
            assert_eq!(editable.text(cx).as_deref(), Some("<h1>Now visible</h1>"));
            assert!(!is_empty_page(&editable.text(cx).unwrap()));
            assert_eq!(editable.pane(cx).segmented.unwrap().value, "preview");
            assert_eq!(readonly.pane(cx).segmented.unwrap().value, "preview");
        });
    }
}
