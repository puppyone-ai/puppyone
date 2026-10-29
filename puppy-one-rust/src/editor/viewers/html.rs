//! `HtmlViewer` (`viewers/html/HtmlViewer.tsx`): Interact (the page running
//! in the system web engine, relative assets from the document's folder,
//! the product's interaction CSS) and Source (the native code editor, which
//! owns the text, undo and saves). The pane menu's "HTML view mode"
//! segmented control switches between them; an empty page offers Source.
//!
//! Edit (`HtmlVisualSurface`, `html_visual`) is offered while the document
//! is editable; the page maps elements back to source offsets with the
//! product's compiler and falls back to Interact with "unsupported" when it
//! cannot.
use super::{code, html_visual, web::WebFrame};
use crate::{
    editor::{
        registry::{
            PaneEntries, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
            document_folder, document_source,
        },
        workbench::pane::{Segment, Segmented},
    },
    localization::t,
    platform::webview::{Budgeted, Content, Entry, Source},
    theme,
    typography::Scale,
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::{
    cell::{Cell, RefCell},
    path::PathBuf,
    rc::Rc,
};

const INTERACTION_CSS: &str = include_str!("../../../assets/web/html-preview-interaction.css");
/// `html-artifact` resourcePolicy.maxSourceBytes.
const BUDGET: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Preview,
    Edit,
    Source,
}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let source: Rc<dyn ViewerSurface> = Rc::from(code::open(request, window, cx));
    let text = match request.input {
        SurfaceInput::Text(text) => text.to_owned(),
        _ => String::new(),
    };
    let folder = document_folder(request.id);
    let assets = document_source(request.id);
    let frame = cx.new(|_| {
        WebFrame::new(
            Some(content(&text, folder.clone(), assets.clone())),
            request.dark,
        )
    });
    let empty = cx.new(|_| EmptyPage);
    Box::new(HtmlSurface {
        source,
        frame,
        empty,
        is_empty: Rc::new(Cell::new(is_empty_page(&text))),
        mode: Rc::new(Cell::new(Mode::Preview)),
        folder,
        assets,
        dark: Cell::new(request.dark),
        name: request.name.to_owned(),
        read_only: Cell::new(false),
        visual: Rc::new(RefCell::new(None)),
        notice: Rc::new(RefCell::new(None)),
    })
}

/// The preview document: the page with the interaction stylesheet appended
/// to its head (or prepended when it has none).
pub fn preview_html(text: &str) -> String {
    let style =
        format!("<style id=\"puppyone-html-preview-interaction\">{INTERACTION_CSS}</style>");
    let lower = text.to_ascii_lowercase();
    match lower.find("</head>") {
        Some(i) => format!("{}{}{}", &text[..i], style, &text[i..]),
        None => format!("{style}{text}"),
    }
}
/// `htmlDocumentEmpty`: nothing but whitespace, comments and an empty skeleton.
pub fn is_empty_page(text: &str) -> bool {
    let mut rest = text.to_string();
    while let (Some(a), Some(b)) = (rest.find("<!--"), rest.find("-->")) {
        if b < a {
            break;
        }
        rest.replace_range(a..b + 3, "");
    }
    let lower = rest.to_ascii_lowercase();
    let stripped: String = [
        "<!doctype html>",
        "<html>",
        "</html>",
        "<head>",
        "</head>",
        "<body>",
        "</body>",
    ]
    .iter()
    .fold(lower, |acc, tag| acc.replace(tag, ""));
    stripped.trim().is_empty()
}
/// `projectCloudHtml`: a hosted document's assets come through its
/// provider, at most 64 references and 4 MiB per projection.
const MAX_REFERENCES: usize = 64;
fn content(text: &str, folder: Option<PathBuf>, source: Option<Source>) -> Content {
    Content {
        source: source.filter(|_| folder.is_none()).map(|source| {
            Source(std::sync::Arc::new(Budgeted::new(
                source,
                MAX_REFERENCES,
                BUDGET,
            )))
        }),
        root: folder,
        entry: Entry::Html(preview_html(text)),
        max_bytes: BUDGET,
        assets: vec![],
        ipc: None,
    }
}

struct HtmlSurface {
    source: Rc<dyn ViewerSurface>,
    frame: Entity<WebFrame>,
    empty: Entity<EmptyPage>,
    is_empty: Rc<Cell<bool>>,
    mode: Rc<Cell<Mode>>,
    folder: Option<PathBuf>,
    assets: Option<Source>,
    dark: Cell<bool>,
    name: String,
    read_only: Cell<bool>,
    /// The Edit page while Edit mode is shown.
    visual: Rc<RefCell<Option<html_visual::Session>>>,
    /// `editor.html.unsupported` after Edit could not map the document.
    notice: Rc<RefCell<Option<SharedString>>>,
}
impl HtmlSurface {
    fn refresh_preview(&self, cx: &mut App) {
        refresh_preview(
            &*self.source,
            &self.frame,
            &self.is_empty,
            &self.folder,
            &self.assets,
            cx,
        );
    }
    /// `canVisualEdit`: an editable HTML document.
    fn can_visual_edit(&self) -> bool {
        let lower = self.name.to_ascii_lowercase();
        !self.read_only.get() && (lower.ends_with(".html") || lower.ends_with(".htm"))
    }
    fn start_visual(&self, window: &mut Window, cx: &mut App) -> bool {
        let text = self.source.text(cx).unwrap_or_default();
        if !html_visual::admits(&self.name, &text) {
            *self.notice.borrow_mut() = Some(t("editor.html.unsupported").into());
            return false;
        }
        let unavailable: html_visual::Unavailable = {
            let (mode, visual, notice) =
                (self.mode.clone(), self.visual.clone(), self.notice.clone());
            let (source, frame, is_empty) = (
                self.source.clone(),
                self.frame.clone(),
                self.is_empty.clone(),
            );
            let (folder, assets) = (self.folder.clone(), self.assets.clone());
            Rc::new(move |window, cx| {
                if mode.get() != Mode::Edit {
                    return;
                }
                refresh_preview(&*source, &frame, &is_empty, &folder, &assets, cx);
                mode.set(Mode::Preview);
                *notice.borrow_mut() = Some(t("editor.html.unsupported").into());
                // Dropping the session closes its page after this message.
                let visual = visual.clone();
                window.on_next_frame(move |_, _| drop(visual.borrow_mut().take()));
                window.refresh();
            })
        };
        let session = html_visual::Session::start(
            html_visual::Params {
                text,
                name: self.name.clone(),
                folder: self.folder.clone(),
                assets: self.assets.clone(),
                dark: self.dark.get(),
                enabled: !self.read_only.get(),
                budget: BUDGET,
            },
            self.source.clone(),
            unavailable,
            window,
            cx,
        );
        *self.visual.borrow_mut() = Some(session);
        true
    }
}
fn refresh_preview(
    source: &dyn ViewerSurface,
    frame: &Entity<WebFrame>,
    is_empty: &Cell<bool>,
    folder: &Option<PathBuf>,
    assets: &Option<Source>,
    cx: &mut App,
) {
    let text = source.text(cx).unwrap_or_default();
    is_empty.set(is_empty_page(&text));
    let content = content(&text, folder.clone(), assets.clone());
    frame.update(cx, |f, cx| f.set_content(Some(content), cx));
}
impl ViewerSurface for HtmlSurface {
    fn element(&self) -> AnyElement {
        let body = match self.mode.get() {
            Mode::Source => return self.source.element(),
            Mode::Edit => match self.visual.borrow().as_ref() {
                Some(session) => session.frame.clone().into_any_element(),
                None => div().size_full().into_any_element(),
            },
            Mode::Preview if self.is_empty.get() => self.empty.clone().into_any_element(),
            Mode::Preview => self.frame.clone().into_any_element(),
        };
        // Native web content draws above the window: the notice sits in
        // flow above it instead of floating over it.
        let notice = self.notice.borrow().clone().map(|text| {
            let notice = self.notice.clone();
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
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        // Source edits reach an open Edit page as a new mirror.
        let (visual, source) = (self.visual.clone(), self.source.clone());
        let forward: SurfaceEvents = Rc::new(move |event, cx| {
            if matches!(event, crate::editor::registry::SurfaceEvent::Changed)
                && let Some(text) = source.text(cx)
                && let Some(session) = visual.borrow().as_ref()
            {
                session.sync(&text, cx);
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
    }
    fn replace_text(&self, text: &str, window: &mut Window, cx: &mut App) {
        self.source.replace_text(text, window, cx);
        // External changes reach the running page too (disk-first).
        match self.mode.get() {
            Mode::Preview => self.refresh_preview(cx),
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
        self.source.rebind_name(name, cx);
    }
    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        match self.mode.get() {
            Mode::Source => self.source.undo(redo, window, cx),
            Mode::Edit => {
                if let Some(session) = self.visual.borrow().as_ref() {
                    session.history(redo, &*self.source, window, cx);
                }
            }
            Mode::Preview => {}
        }
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, window: &mut Window, cx: &mut App) {
        self.source.apply(read_only, dark, scale, window, cx);
        self.read_only.set(read_only);
        let restyle = self.dark.replace(dark) != dark;
        if self.mode.get() == Mode::Edit {
            if read_only {
                // `!canVisualEdit` leaves Edit for Interact.
                self.refresh_preview(cx);
                self.mode.set(Mode::Preview);
                self.visual.borrow_mut().take();
            } else if restyle {
                self.visual.borrow_mut().take();
                self.start_visual(window, cx);
            } else if let Some(session) = self.visual.borrow().as_ref() {
                session.set_enabled(true, cx);
            }
        }
    }
    fn command(&self, name: &str, window: &mut Window, cx: &mut App) {
        if name == "html-reload" {
            self.frame.update(cx, |f, _| f.reload());
        } else {
            self.source.command(name, window, cx);
        }
    }
    fn focus_handle(&self, cx: &App) -> Option<FocusHandle> {
        match self.mode.get() {
            Mode::Source => self.source.focus_handle(cx),
            Mode::Preview | Mode::Edit => None,
        }
    }
    /// `html-view-mode`: Interact | Edit | Source (`HtmlViewMenu`).
    fn pane(&self, cx: &App) -> PaneEntries {
        let mut entries = match self.mode.get() {
            Mode::Source => self.source.pane(cx),
            Mode::Preview | Mode::Edit => PaneEntries::default(),
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
        entries
    }
    fn pane_segment(&self, id: &'static str, window: &mut Window, cx: &mut App) {
        let next = match id {
            "source" => Mode::Source,
            "edit" => Mode::Edit,
            _ => Mode::Preview,
        };
        if next == self.mode.get() || next == Mode::Edit && !self.can_visual_edit() {
            return;
        }
        self.notice.borrow_mut().take();
        if self.source.composing(cx) {
            *self.notice.borrow_mut() = Some(t("editor.html.finishComposition").into());
            return;
        }
        if next == Mode::Edit {
            if !self.start_visual(window, cx) {
                return;
            }
        } else {
            self.visual.borrow_mut().take();
        }
        if next == Mode::Preview {
            self.refresh_preview(cx);
        }
        self.mode.set(next);
        if next == Mode::Source
            && let Some(focus) = self.source.focus_handle(cx)
        {
            focus.focus(window, cx);
        }
    }
    fn pane_item(&self, id: &'static str, window: &mut Window, cx: &mut App) {
        self.source.pane_item(id, window, cx);
    }
    #[cfg(test)]
    fn html_visual_deliver(&self, body: &str) -> bool {
        self.visual
            .borrow()
            .as_ref()
            .is_some_and(|s| s.deliver(body))
    }
    #[cfg(test)]
    fn code_editor(&self) -> Option<Entity<code::CodeView>> {
        self.source.code_editor()
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
    use core::prelude::v1::test;

    #[test]
    fn previews_carry_the_interaction_stylesheet_and_empty_pages_are_recognised() {
        let page = preview_html("<html><head><title>x</title></head><body>hi</body></html>");
        assert!(page.contains("puppyone-html-preview-interaction"));
        assert!(
            page.find("puppyone-html-preview-interaction").unwrap() < page.find("</head>").unwrap()
        );
        assert!(preview_html("<p>bare</p>").starts_with("<style"));
        assert!(is_empty_page(
            "<!DOCTYPE html>\n<html><head></head><body>\n</body></html>"
        ));
        assert!(is_empty_page("  <!-- nothing -->  "));
        assert!(!is_empty_page("<body><p>content</p></body>"));
    }
}
