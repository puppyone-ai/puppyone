//! `MermaidBlockWidget` (markdown-code-widgets.css `.cm-md-mermaid-*`): the
//! diagram in a 16px-padded panel of at least 132px and at most 720px,
//! scrolling sideways when zoomed wider; zoom controls and Edit at the
//! top-right; the source, while the caret is inside, above the diagram;
//! an error strip under it, with the last good diagram (or the source)
//! kept in the panel.
use super::{Action, ID, MermaidBlock};
use crate::editor::{
    markdown::{
        shared::ring,
        style::{BlockStyle, MarkdownTheme},
    },
    tokens::Tokens,
    view::{
        command::Command,
        style::TextStyle,
        widget::{BlockWidget, CommandSender, WidgetCx},
    },
};
use crate::localization::{t, tf};
use crate::render_service::{self, Kind, MermaidTheme, Request, State};
use crate::theme::{self, Theme};
use gpui::{prelude::*, *};
use std::{cell::RefCell, collections::HashMap};

/// `.cm-md-mermaid-widget { padding: 14px 0 18px; gap: 8px }`.
const PAD_TOP: f32 = 14.;
const PAD_BOTTOM: f32 = 18.;
const GAP: f32 = 8.;
/// `.cm-md-mermaid-body.is-editing { padding-top: 18px }`.
const EDITING_TOP: f32 = 18.;
/// `.cm-md-mermaid-preview`: padding, border, minimum and maximum height.
const PREVIEW_PAD: f32 = 16.;
const PREVIEW_MIN: f32 = 132.;
const PREVIEW_MAX: f32 = 720.;
/// `.cm-md-mermaid-source`: `min-height: 120px; max-height: 420px`.
const SOURCE_MIN: f32 = 120.;
const SOURCE_MAX: f32 = 420.;
/// `createMermaidViewportController`.
const DEFAULT_MIN_SCALE: f32 = 0.7;
const MIN_SCALE: f32 = 0.1;
const MAX_SCALE: f32 = 2.;
const STEP: f32 = 0.1;

thread_local! {
    /// `lastGoodSvg`: each pane's last drawing of a block, shown while its
    /// next one is drawn or after it failed.
    static LAST_GOOD: RefCell<HashMap<(EntityId, usize), render_service::Rendered>> =
        RefCell::new(HashMap::new());
}

pub struct MermaidBlockWidget {
    block: MermaidBlock,
    dark: bool,
    chrome: BlockStyle,
    source: TextStyle,
    code_background: Rgba,
    code_padding: (f32, f32),
    radius: f32,
    /// `--po-md-mermaid-panel`.
    panel: Rgba,
    request: Request,
    view: crate::editor::markdown::core::state::DiagramView,
}

/// The Markdown profile's diagram colours and type (`--po-md-mermaid-*`).
fn markdown_theme(t: &Tokens) -> MermaidTheme<'_> {
    MermaidTheme {
        background: t.color("--po-md-mermaid-background"),
        panel: t.color("--po-md-mermaid-panel"),
        text: t.color("--po-md-mermaid-text"),
        muted: t.color("--po-md-mermaid-muted"),
        accent: t.color("--po-md-mermaid-accent"),
        border: t.color("--po-md-mermaid-border"),
        success: t.color("--po-md-mermaid-success"),
        warning: t.color("--po-md-mermaid-warning"),
        danger: t.color("--po-md-mermaid-danger"),
        font_family: t.raw("--po-md-mermaid-font"),
        font_size: t.len("--po-md-mermaid-font-size", 15.),
    }
}

/// The zoom an image is drawn at: a quarter step at or above `scale`, so
/// it is never stretched.
fn bucket(scale: f32) -> f32 {
    ((scale * 4.).ceil() / 4.).max(0.25)
}

impl MermaidBlockWidget {
    pub fn new(
        block: &MermaidBlock,
        theme: &MarkdownTheme,
        view: crate::editor::markdown::core::state::DiagramView,
    ) -> Self {
        let t = Tokens::get(theme.dark, theme.scale);
        let diagram = markdown_theme(t);
        let code = &theme.code_block;
        Self {
            block: block.clone(),
            dark: theme.dark,
            chrome: theme.block.clone(),
            source: code.text(),
            code_background: code.background,
            code_padding: (code.padding.left, code.padding.top),
            radius: t.len("--po-md-block-radius", 10.),
            panel: diagram.panel,
            request: Request {
                kind: Kind::Mermaid {
                    config: render_service::mermaid_config(&diagram),
                },
                source: block.source.clone(),
                background: render_service::hex(diagram.panel),
                scale: 1.,
            },
            view,
        }
    }

    fn zoom_controls(&self, scale: f32, fit: f32, cx: &WidgetCx, app: &Theme) -> AnyElement {
        let at = self.block.range.start;
        let send = cx.sender();
        let percent = (scale * 100.).round() as u16;
        let ty = theme::ty().ui;
        let divider = theme::alpha(app.divider, 0.68);
        let button = |id: &'static str, label: SharedString, enabled: bool, target: f32| {
            let send = send.clone();
            div()
                .id(cx.id(id))
                .h(px(22.))
                .min_w(px(26.))
                .px(px(6.))
                .flex()
                .items_center()
                .justify_center()
                .border_r_1()
                .border_color(divider)
                .text_size(px(ty.meta))
                .text_color(if enabled {
                    app.muted
                } else {
                    theme::alpha(app.muted, 0.42)
                })
                .when(enabled, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(|d| d.bg(app.control_hover).text_color(app.text))
                        .on_click(move |_, window, cx| {
                            cx.stop_propagation();
                            let percent =
                                (target.clamp(MIN_SCALE, MAX_SCALE) * 100.).round() as u16;
                            send(Command::new(ID, Action::Zoom { at, percent }), window, cx);
                        })
                })
                .child(label)
        };
        h_row()
            .h(px(24.))
            .rounded(px(5.))
            .overflow_hidden()
            .border_1()
            .border_color(theme::mix(app.divider, app.muted, 0.96))
            .bg(theme::alpha(app.panel_raised, 0.94))
            .child(button(
                "mermaid-zoom-out",
                "−".into(),
                scale > MIN_SCALE + 0.001,
                scale - STEP,
            ))
            .child(
                div()
                    .min_w(px(42.))
                    .px(px(5.))
                    .text_size(px(ty.micro))
                    .line_height(px(22.))
                    .text_center()
                    .text_color(app.muted)
                    .child(format!("{percent}%")),
            )
            .child(button(
                "mermaid-zoom-in",
                "+".into(),
                scale < MAX_SCALE - 0.001,
                scale + STEP,
            ))
            .child(
                button(
                    "mermaid-fit",
                    t("editor.markdown.mermaid.fit").into(),
                    true,
                    fit,
                )
                .min_w(px(38.))
                .border_r_0()
                .text_size(px(ty.caption))
                .font_weight(FontWeight(650.)),
            )
            .into_any_element()
    }

    fn edit_button(
        &self,
        editing: bool,
        send: CommandSender,
        cx: &WidgetCx,
        app: &Theme,
    ) -> AnyElement {
        let at = self.block.range.start;
        let ty = theme::ty().ui;
        let (label, action) = if editing {
            (t("editor.markdown.mermaid.done"), Action::Done { at })
        } else {
            (t("editor.markdown.mermaid.edit"), Action::Edit { at })
        };
        div()
            .id(cx.id("mermaid-edit"))
            .h(px(24.))
            .px(px(9.))
            .rounded(px(5.))
            .border_1()
            .border_color(theme::mix(app.divider, app.muted, 0.96))
            .bg(theme::alpha(app.panel_raised, 0.92))
            .text_size(px(ty.caption))
            .font_weight(FontWeight(650.))
            .line_height(px(22.))
            .text_color(app.muted)
            .cursor(theme::clickable_cursor())
            .hover(|d| d.bg(app.control_hover).text_color(app.text))
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                send(Command::new(ID, action), window, cx);
            })
            .child(label)
            .into_any_element()
    }
}

fn h_row() -> Div {
    div().flex().flex_row().items_center()
}

impl BlockWidget for MermaidBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let (top, width) = (cx.top, cx.width);
        let read_only = cx.state.read_only;
        let editing = cx.state.focus_within() && !read_only;
        let app = Theme::new(self.dark);
        let ty = theme::ty().ui;
        let send = cx.sender();
        let at = self.block.range.start;
        let mut children: Vec<AnyElement> = Vec::new();
        let mut y = PAD_TOP + if editing { EDITING_TOP } else { 0. };

        // The source, edited where the diagram is read.
        if editing {
            let (px_x, px_y) = self.code_padding;
            let inner = (width - 2. * px_x - 2.).max(0.);
            let (code, height) = cx.render.code(
                self.block.code.clone(),
                &self.source,
                2,
                top,
                px_x + 1.,
                y + px_y + 1.,
                inner,
                |_| Vec::new().into(),
            );
            let boxed = (height + 2. * px_y + 2.).clamp(SOURCE_MIN, SOURCE_MAX);
            children.push(
                div()
                    .absolute()
                    .left_0()
                    .top(px(y))
                    .w(px(width))
                    .h(px(boxed))
                    .rounded(px(self.radius))
                    .border_1()
                    .border_color(theme::mix(app.divider, app.accent, 0.54))
                    .bg(self.code_background)
                    .into_any_element(),
            );
            children.push(code);
            y += boxed + GAP;
        }

        // The panel: the diagram, its loading line, the deferred offer or
        // the source when there is nothing to show.
        let inner_width = (width - 2. * PREVIEW_PAD - 2.).max(1.);
        let key = (cx.render.view.entity_id(), at);
        let deferred = self.block.deferred && !self.view.activated && !editing;
        let state = if deferred || self.block.source.trim().is_empty() {
            None
        } else {
            // A first pass learns the intrinsic size; the zoom then picks
            // the image's own scale.
            let natural = render_service::get(&self.request, cx.render.window, cx.render.app);
            let intrinsic = match &natural {
                State::Ready(r) => Some((r.width, r.height)),
                _ => LAST_GOOD.with(|l| l.borrow().get(&key).map(|r| (r.width, r.height))),
            };
            let fit = intrinsic.map_or(1., |(w, _)| (inner_width / w).min(1.));
            let scale = self
                .view
                .zoom
                .map_or(fit.clamp(DEFAULT_MIN_SCALE, 1.), |p| p as f32 / 100.);
            let drawn = if bucket(scale) == 1. {
                natural
            } else {
                render_service::get(
                    &Request {
                        scale: bucket(scale),
                        ..self.request.clone()
                    },
                    cx.render.window,
                    cx.render.app,
                )
            };
            Some((drawn, scale, fit))
        };
        let mut error = None;
        let mut controls = None;
        let (panel, panel_height): (AnyElement, f32) = match state {
            None if deferred => {
                let send = send.clone();
                let row = h_row()
                    .size_full()
                    .justify_between()
                    .gap(px(16.))
                    .text_size(px(ty.meta))
                    .text_color(app.muted)
                    .child(t("editor.markdown.mermaid.largePreviewPaused"))
                    .child(
                        div()
                            .id(cx.id("mermaid-render"))
                            .h(px(24.))
                            .px(px(9.))
                            .rounded(px(5.))
                            .border_1()
                            .border_color(theme::mix(app.divider, app.muted, 0.96))
                            .text_size(px(ty.caption))
                            .font_weight(FontWeight(650.))
                            .line_height(px(22.))
                            .cursor(theme::clickable_cursor())
                            .hover(|d| d.bg(app.control_hover).text_color(app.text))
                            .on_click(move |_, window, cx| {
                                cx.stop_propagation();
                                send(Command::new(ID, Action::Activate { at }), window, cx);
                            })
                            .child(t("editor.markdown.mermaid.renderDiagram")),
                    );
                (row.into_any_element(), PREVIEW_MIN)
            }
            None => (
                source_fallback(&self.block.source, self.source.family(), &app).into_any_element(),
                PREVIEW_MIN,
            ),
            Some((drawn, scale, fit)) => {
                let shown = match &drawn {
                    State::Ready(r) => {
                        LAST_GOOD.with(|l| l.borrow_mut().insert(key, r.clone()));
                        Some(r.clone())
                    }
                    State::Failed(message) => {
                        error = Some(message.clone());
                        LAST_GOOD.with(|l| l.borrow().get(&key).cloned())
                    }
                    State::Pending => LAST_GOOD.with(|l| l.borrow().get(&key).cloned()),
                };
                match shown {
                    Some(r) => {
                        controls = Some(self.zoom_controls(scale, fit, cx, &app));
                        let (w, h) = (r.width * scale, r.height * scale);
                        let image = img(ImageSource::Render(r.image.clone()))
                            .w(px(w))
                            .h(px(h))
                            .flex_none();
                        let content = div()
                            .id(cx.id("mermaid-scroll"))
                            .size_full()
                            .overflow_scroll()
                            .child(
                                div()
                                    .min_w_full()
                                    .w(px(w.max(inner_width)))
                                    .flex()
                                    .justify_center()
                                    .child(image),
                            );
                        let height = (h + 2. * PREVIEW_PAD + 2.).clamp(PREVIEW_MIN, PREVIEW_MAX);
                        (content.into_any_element(), height)
                    }
                    None if error.is_some() => (
                        source_fallback(&self.block.source, self.source.family(), &app)
                            .into_any_element(),
                        PREVIEW_MIN,
                    ),
                    None => (
                        div()
                            .size_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(ty.meta))
                            .text_color(app.muted)
                            .child(t("editor.markdown.mermaid.rendering"))
                            .into_any_element(),
                        PREVIEW_MIN,
                    ),
                }
            }
        };
        let open = (!editing && !read_only).then(|| send.clone());
        children.push(
            div()
                .id(cx.id("mermaid-preview"))
                .absolute()
                .left_0()
                .top(px(y))
                .w(px(width))
                .h(px(panel_height))
                .p(px(PREVIEW_PAD))
                .rounded(px(self.radius))
                .border_1()
                .border_color(theme::alpha(app.divider, 0.7))
                .bg(self.panel)
                .when_some(open, |d, send| {
                    d.cursor(theme::clickable_cursor())
                        .on_click(move |_, window, cx| {
                            send(Command::new(ID, Action::Edit { at }), window, cx);
                        })
                })
                .child(panel)
                .into_any_element(),
        );
        // The toolbar sits over the panel's top-right corner.
        let toolbar_top = PAD_TOP + 4.;
        y += panel_height;

        if let Some(message) = error {
            let text = if message.is_empty() {
                t("editor.markdown.mermaid.renderFailed").to_owned()
            } else {
                tf(
                    "editor.markdown.mermaid.renderFailedDetail",
                    &[("detail", crate::localization::bidi_isolate(&message).into())],
                )
            };
            y += GAP;
            let danger = app.danger;
            children.push(
                div()
                    .absolute()
                    .left_0()
                    .top(px(y))
                    .w(px(width))
                    .px(px(9.))
                    .py(px(7.))
                    .rounded(px(5.))
                    .border_1()
                    .border_color(theme::mix(danger, app.divider, 0.28))
                    .bg(theme::alpha(danger, 0.08))
                    .text_size(px(ty.meta))
                    .line_height(px(ty.meta * 1.4))
                    .text_color(theme::mix(danger, app.text, 0.58))
                    .child(text)
                    .into_any_element(),
            );
            y += ty.meta * 1.4 + 14. + 2.;
        }

        let mut toolbar = h_row().gap(px(6.));
        if let Some(controls) = controls {
            toolbar = toolbar.child(controls);
        }
        if !read_only {
            toolbar = toolbar.child(self.edit_button(editing, send, cx, &app));
        }
        children.push(
            toolbar
                .absolute()
                .top(px(toolbar_top))
                .right(px(6. + PREVIEW_PAD / 4.))
                .into_any_element(),
        );

        let height = y + PAD_BOTTOM;
        let c = &self.chrome;
        let size = (width, height);
        let frame = if cx.state.selected {
            ring::ring(size, c.radius, c.ring_width, c.selected_ring)
        } else if editing {
            ring::ring(size, c.radius, c.ring_width, c.hover_ring)
        } else {
            let hover = c.hover_ring;
            ring::outline(size, c.radius, c.ring_width)
                .group_hover("md-mermaid", move |st| st.border_color(hover))
        };
        let surface = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-mermaid")
            .children(children)
            .child(frame);
        (
            cx.block_box(height).child(surface).into_any_element(),
            height,
        )
    }
}

/// `createMermaidSourceFallback`: the source as monospace text.
fn source_fallback(source: &str, mono: SharedString, app: &Theme) -> Div {
    div()
        .size_full()
        .overflow_hidden()
        .font_family(mono)
        .text_size(px(theme::ty().ui.meta))
        .text_color(app.muted)
        .child(if source.trim().is_empty() {
            t("editor.markdown.mermaid.empty").to_owned()
        } else {
            source.to_owned()
        })
}
