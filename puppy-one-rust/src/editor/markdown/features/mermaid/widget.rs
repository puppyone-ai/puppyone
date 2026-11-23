//! `MermaidBlockWidget` (markdown-code-widgets.css `.cm-md-mermaid-*`): the
//! diagram in a 16px-padded panel of at least 132px and at most 720px,
//! scrolling sideways when zoomed wider; zoom controls and Edit at the
//! top-right; the source, while the caret is inside, above the diagram;
//! an error strip under it with `Retry` and `Source code` (`TA-52`), backed
//! by the bounded LRU last-good cache in [`platform::render`] (`TODO-34`).
use super::{
    Action, DiagramView, ID, MermaidBlock,
    controls::{
        ERROR_BANNER_HEIGHT, deferred_offer, edit_button, error_banner, h_row, source_fallback,
        zoom_controls,
    },
};
use crate::{
    editor::{
        markdown::{
            platform::brokers::render as render_broker,
            shared::widgets::ring,
            style::{BlockStyle, MarkdownTheme},
        },
        tokens::Tokens,
        view::{
            command::Command,
            style::TextStyle,
            widget::{BlockWidget, WidgetCx},
        },
    },
    localization::t,
    render_service::{self, Kind, MermaidTheme, Rendered, Request, State},
    theme::{self, Theme},
};
use gpui::{prelude::*, *};

const PAD_TOP: f32 = 14.;
const PAD_BOTTOM: f32 = 18.;
const GAP: f32 = 8.;
const EDITING_TOP: f32 = 18.;
const PREVIEW_PAD: f32 = 16.;
const PREVIEW_MIN: f32 = 132.;
const PREVIEW_MAX: f32 = 720.;
const SOURCE_MIN: f32 = 120.;
const SOURCE_MAX: f32 = 420.;
const DEFAULT_MIN_SCALE: f32 = 0.7;

#[cfg(test)]
pub(crate) fn request_for_tests(
    source: &str,
    dark: bool,
    scale: crate::typography::Scale,
    zoom_scale: f32,
) -> Request {
    let t = Tokens::get(dark, scale);
    let diagram = markdown_theme(t);
    Request {
        kind: Kind::Mermaid {
            config: render_service::mermaid_config(&diagram),
        },
        source: source.to_owned(),
        background: render_service::hex(diagram.panel),
        scale: zoom_scale,
    }
}

pub struct MermaidBlockWidget {
    block: MermaidBlock,
    dark: bool,
    chrome: BlockStyle,
    source: TextStyle,
    code_background: Rgba,
    code_padding: (f32, f32),
    radius: f32,
    panel: Rgba,
    request: Request,
    view: DiagramView,
}

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

fn bucket(scale: f32) -> f32 {
    ((scale * 4.).ceil() / 4.).max(0.25)
}

struct DiagramEvaluation {
    shown: Option<Rendered>,
    scale: f32,
    fit: f32,
    error: Option<SharedString>,
    zoomed_request: Option<Request>,
}

impl MermaidBlockWidget {
    pub fn new(block: &MermaidBlock, theme: &MarkdownTheme, view: DiagramView) -> Self {
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

    fn render_source_editor(
        &self,
        top: f32,
        width: f32,
        y: f32,
        app: &Theme,
        cx: &mut WidgetCx,
    ) -> (AnyElement, AnyElement, f32) {
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
        let bg = div()
            .absolute()
            .left_0()
            .top(px(y))
            .w(px(width))
            .h(px(boxed))
            .rounded(px(self.radius))
            .border_1()
            .border_color(theme::mix(app.divider, app.accent, 0.54))
            .bg(self.code_background)
            .into_any_element();
        (bg, code, boxed)
    }

    fn evaluate_diagram(&self, inner_width: f32, cx: &mut WidgetCx) -> DiagramEvaluation {
        let editor = cx.render.view.entity_id();
        let at = cx.source.start;
        let slot = render_broker::slot_for(editor, at);
        let natural =
            render_broker::get_for_slot(slot, &self.request, cx.render.window, cx.render.app);
        let intrinsic = match &natural {
            State::Ready(r) => Some((r.width, r.height)),
            _ => render_broker::last_good(editor, at).map(|r| (r.width, r.height)),
        };
        let fit = intrinsic.map_or(1., |(w, _)| (inner_width / w).min(1.));
        let scale = self
            .view
            .zoom
            .map_or(fit.clamp(DEFAULT_MIN_SCALE, 1.), |p| p as f32 / 100.);
        let (drawn, zoomed_request) = if bucket(scale) == 1. {
            (natural, None)
        } else {
            let zoom_req = Request {
                scale: bucket(scale),
                ..self.request.clone()
            };
            let zoom_slot = render_broker::slot_for(editor, at.wrapping_add(1usize << 48));
            let res =
                render_broker::get_for_slot(zoom_slot, &zoom_req, cx.render.window, cx.render.app);
            (res, Some(zoom_req))
        };
        let mut error = None;
        let shown = match &drawn {
            State::Ready(r) => {
                render_broker::record_last_good(editor, at, r);
                Some(r.clone())
            }
            State::Failed(message) => {
                error = Some(message.clone());
                render_broker::last_good(editor, at)
            }
            State::Unavailable => {
                error = Some(SharedString::default());
                render_broker::last_good(editor, at)
            }
            State::Pending => render_broker::last_good(editor, at),
        };
        DiagramEvaluation {
            shown,
            scale,
            fit,
            error,
            zoomed_request,
        }
    }

    fn render_diagram_canvas(
        &self,
        r: &Rendered,
        scale: f32,
        inner_width: f32,
        cx: &WidgetCx,
    ) -> (AnyElement, f32) {
        let (w, h) = (r.width * scale, r.height * scale);
        let image = img(ImageSource::Render(r.image.clone()))
            .debug_selector(|| "md-mermaid-image".into())
            .w(px(w))
            .h(px(h))
            .flex_none();
        let content = div()
            .id(cx.id("mermaid-scroll"))
            .debug_selector(|| "md-mermaid-canvas".into())
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
        let viewport_h = f32::from(cx.render.window.viewport_size().height);
        let max_height = if viewport_h > 0. {
            PREVIEW_MAX.min(viewport_h * 0.68).max(PREVIEW_MIN)
        } else {
            PREVIEW_MAX
        };
        let height = (h + 2. * PREVIEW_PAD + 2.).clamp(PREVIEW_MIN, max_height);
        (content.into_any_element(), height)
    }
}

impl BlockWidget for MermaidBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let (top, width) = (cx.top, cx.width);
        let read_only = cx.state.read_only;
        let editing = cx.state.focus_within() && !read_only;
        let app = Theme::new(self.dark);
        let ty = theme::ty().ui;
        let send = cx.sender();
        let at = cx.source.start;
        let mut children: Vec<AnyElement> = Vec::new();
        let mut y = PAD_TOP + if editing { EDITING_TOP } else { 0. };

        if editing {
            let (bg, code, boxed) = self.render_source_editor(top, width, y, &app, cx);
            children.push(bg);
            children.push(code);
            y += boxed + GAP;
        }

        let inner_width = (width - 2. * PREVIEW_PAD - 2.).max(1.);
        let deferred = self.block.deferred && !self.view.activated && !editing;
        let mut error = None;
        let mut zoomed_request = None;
        let mut controls = None;
        let (panel, panel_height): (AnyElement, f32) = if deferred {
            (deferred_offer(at, send.clone(), cx, &app), PREVIEW_MIN)
        } else if self.block.source.trim().is_empty() {
            (
                source_fallback(&self.block.source, self.source.family(), &app).into_any_element(),
                PREVIEW_MIN,
            )
        } else {
            let eval = self.evaluate_diagram(inner_width, cx);
            error = eval.error;
            zoomed_request = eval.zoomed_request;
            match eval.shown {
                Some(ref r) => {
                    controls = Some(zoom_controls(at, eval.scale, eval.fit, cx, &app));
                    self.render_diagram_canvas(r, eval.scale, inner_width, cx)
                }
                None if error.is_some() => (
                    source_fallback(&self.block.source, self.source.family(), &app)
                        .into_any_element(),
                    PREVIEW_MIN,
                ),
                None => (
                    div()
                        .debug_selector(|| "md-mermaid-loading".into())
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
        };

        let open = (!editing && !read_only).then(|| send.clone());
        children.push(
            div()
                .id(cx.id("mermaid-preview"))
                .debug_selector(|| "md-mermaid-preview".into())
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
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(move |_, window, cx| {
                            send(Command::new(ID, Action::Edit { at }), window, cx);
                        })
                })
                .child(panel)
                .into_any_element(),
        );
        let toolbar_top = PAD_TOP + 4.;
        y += panel_height;

        if let Some(message) = error {
            y += GAP;
            children.push(error_banner(
                &self.block,
                &message,
                &self.request,
                zoomed_request,
                self.dark,
                (width, y),
                cx,
            ));
            y += ERROR_BANNER_HEIGHT;
        }

        let mut toolbar = h_row().gap(px(6.));
        if let Some(controls) = controls {
            toolbar = toolbar.child(controls);
        }
        if !read_only {
            toolbar = toolbar.child(edit_button(at, editing, send, cx, &app));
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
