//! `HtmlViewer` (`viewers/html/HtmlViewer.tsx`): Interact (the page running
//! in the system web engine, relative assets from the document's folder,
//! the product's interaction CSS) and Source (the native code editor, which
//! owns the text, undo and saves). The pane menu's "HTML view mode"
//! segmented control switches between them; an empty page offers Source.
//!
//! Visual editing (the product's Edit mode) maps elements back to source
//! offsets with its own compiler; it is not offered here yet, as the product
//! itself hides Edit when a document cannot be mapped.
use super::{code, web::WebFrame};
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
use std::{cell::Cell, path::PathBuf, rc::Rc};

const INTERACTION_CSS: &str = include_str!("../../../assets/web/html-preview-interaction.css");
/// `html-artifact` resourcePolicy.maxSourceBytes.
const BUDGET: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Preview,
    Source,
}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let source = code::open(request, window, cx);
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
        dark: request.dark,
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
    }
}

struct HtmlSurface {
    source: Box<dyn ViewerSurface>,
    frame: Entity<WebFrame>,
    empty: Entity<EmptyPage>,
    is_empty: Rc<Cell<bool>>,
    mode: Rc<Cell<Mode>>,
    folder: Option<PathBuf>,
    assets: Option<Source>,
    dark: bool,
}
impl HtmlSurface {
    fn refresh_preview(&self, cx: &mut App) {
        let text = self.source.text(cx).unwrap_or_default();
        self.is_empty.set(is_empty_page(&text));
        let content = content(&text, self.folder.clone(), self.assets.clone());
        self.frame
            .update(cx, |f, cx| f.set_content(Some(content), cx));
    }
}
impl ViewerSurface for HtmlSurface {
    fn element(&self) -> AnyElement {
        match self.mode.get() {
            Mode::Source => self.source.element(),
            Mode::Preview if self.is_empty.get() => self.empty.clone().into_any_element(),
            Mode::Preview => div()
                .size_full()
                .child(self.frame.clone())
                .into_any_element(),
        }
    }
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        self.source.subscribe(events, cx)
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
        if self.mode.get() == Mode::Preview {
            self.refresh_preview(cx);
        }
    }
    fn rebind_name(&self, name: &str, cx: &mut App) {
        self.source.rebind_name(name, cx);
    }
    fn undo(&self, redo: bool, window: &mut Window, cx: &mut App) {
        if self.mode.get() == Mode::Source {
            self.source.undo(redo, window, cx);
        }
    }
    fn apply(&self, read_only: bool, dark: bool, scale: Scale, window: &mut Window, cx: &mut App) {
        self.source.apply(read_only, dark, scale, window, cx);
        let _ = self.dark;
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
            Mode::Preview => None,
        }
    }
    /// `html-view-mode`: Interact | Source (`HtmlViewMenu`).
    fn pane(&self, cx: &App) -> PaneEntries {
        let mut entries = match self.mode.get() {
            Mode::Source => self.source.pane(cx),
            Mode::Preview => PaneEntries::default(),
        };
        entries.segmented = Some(Segmented {
            label: t("editor.html.mode").into(),
            options: vec![
                Segment {
                    id: "preview",
                    icon: "mouse-pointer-2",
                    label: t("editor.html.interact").into(),
                },
                Segment {
                    id: "source",
                    icon: "editor-mode-source",
                    label: t("editor.mode.source").into(),
                },
            ],
            value: match self.mode.get() {
                Mode::Preview => "preview",
                Mode::Source => "source",
            },
        });
        entries
    }
    fn pane_segment(&self, id: &'static str, window: &mut Window, cx: &mut App) {
        let next = if id == "source" {
            Mode::Source
        } else {
            Mode::Preview
        };
        if next == self.mode.get() {
            return;
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
