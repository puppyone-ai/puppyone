//! `DesktopDialog` (`.desktop-dialog-surface`) on GPUI Kit's headless dialog,
//! which owns centring, the focus trap, Escape, backdrop presses and layering.
use super::{Icon, IconButton, menu::child_id};
use crate::{theme, ui::appearance::ActiveAppearance};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Dialog as BaseDialog, StyledExt as _},
    component::Sizable as _,
};
use std::rc::Rc;

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

/// A modal dialog: an optional leading glyph and title, a body, and footer
/// actions. Escape, the close button and (unless `keep_on_backdrop`) a
/// backdrop press call `on_close`; the owner removes the dialog.
#[derive(IntoElement)]
pub struct Dialog {
    id: ElementId,
    width: Pixels,
    title: Option<SharedString>,
    leading: Option<(Icon, Hsla)>,
    inset: Option<f32>,
    header_bottom: Option<f32>,
    body_inline: Option<f32>,
    body_padding: (f32, f32),
    body: Vec<AnyElement>,
    footer: Vec<AnyElement>,
    on_close: Option<Handler>,
    close_on_backdrop: bool,
    focus: Option<FocusHandle>,
    style: StyleRefinement,
}
impl Dialog {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            width: px(420.),
            title: None,
            leading: None,
            inset: None,
            header_bottom: None,
            body_inline: None,
            body_padding: (12., 18.),
            body: Vec::new(),
            footer: Vec::new(),
            on_close: None,
            close_on_backdrop: true,
            focus: None,
            style: StyleRefinement::default(),
        }
    }
    /// `--desktop-dialog-width` (420 by default; never wider than the window
    /// minus 32px).
    pub fn width(mut self, width: f32) -> Self {
        self.width = px(width);
        self
    }
    pub fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }
    /// `.desktop-dialog-leading`: a 28px tile tinted with `tint` holding `icon`.
    pub fn leading(mut self, icon: impl Into<Icon>, tint: impl Into<Hsla>) -> Self {
        self.leading = Some((icon.into(), tint.into()));
        self
    }
    /// One inset for the header, body and footer edges (the entry dialogs'
    /// `--onboarding-entry-inset` / `--desktop-create-entry-inset`); the
    /// header then keeps 10px below its title row.
    pub fn inset(mut self, inset: f32) -> Self {
        self.inset = Some(inset);
        self
    }
    /// The body's top and bottom padding (12 / 18 by default).
    /// The header's bottom padding (8px; launchers use 10px).
    pub fn header_bottom(mut self, bottom: f32) -> Self {
        self.header_bottom = Some(bottom);
        self
    }
    /// The body's inline padding, without moving the header (24px).
    pub fn body_inline(mut self, inline: f32) -> Self {
        self.body_inline = Some(inline);
        self
    }
    pub fn body_padding(mut self, top: f32, bottom: f32) -> Self {
        self.body_padding = (top, bottom);
        self
    }
    pub fn footer(mut self, action: impl IntoElement) -> Self {
        self.footer.push(action.into_any_element());
        self
    }
    pub fn on_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }
    pub fn keep_on_backdrop(mut self) -> Self {
        self.close_on_backdrop = false;
        self
    }
    /// A focus handle the owner keeps (to restore focus or test focus).
    pub fn focus_handle(mut self, handle: FocusHandle) -> Self {
        self.focus = Some(handle);
        self
    }
}
impl ParentElement for Dialog {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.body.extend(elements);
    }
}
impl Styled for Dialog {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}
impl RenderOnce for Dialog {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let body_scroll =
            crate::ui::scrollbar::handle(child_id(&self.id, "body-scroll"), window, cx);
        let t = cx.palette();
        let focus = self.focus.unwrap_or_else(|| {
            window
                .use_keyed_state(child_id(&self.id, "focus"), cx, |_, cx| cx.focus_handle())
                .read(cx)
                .clone()
        });
        let viewport = window.viewport_size();
        let close = self.on_close.clone();
        let cancel = close.clone();
        let header = (self.title.is_some() || close.is_some()).then(|| {
            div()
                .flex()
                .flex_shrink_0()
                .items_start()
                .justify_between()
                .gap(px(16.))
                .pt(px(self.inset.unwrap_or(14.)))
                .px(px(self.inset.unwrap_or(20.)))
                .pb(px(self.header_bottom.unwrap_or(if self.inset.is_some() {
                    10.
                } else {
                    8.
                })))
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(10.))
                        .children(self.leading.map(|(icon, tint)| {
                            div()
                                .flex()
                                .flex_shrink_0()
                                .size(px(28.))
                                .items_center()
                                .justify_center()
                                .rounded(px(7.))
                                .bg(tint.opacity(0.11))
                                .child(icon.with_size(px(16.)).color(tint))
                        }))
                        // `--po-text-size-interface`.
                        .children(self.title.map(|title| {
                            div()
                                .text_size(px(theme::ty().ui.label))
                                .line_height(px(18.))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.muted)
                                .child(title)
                        })),
                )
                .children(close.clone().map(|close| {
                    IconButton::new(child_id(&self.id, "close"), "dialog-close")
                        .label(crate::localization::t("common.action.close"))
                        .no_tooltip()
                        .with_size(px(24.))
                        .color(t.subtle)
                        .on_click(move |_, window, cx| close(window, cx))
                }))
        });
        let surface = div()
            .id(self.id.clone())
            .flex()
            .flex_col()
            .w(self.width.min(viewport.width - px(32.)))
            .max_h(viewport.height - px(32.))
            .overflow_hidden()
            .border_1()
            .border_color(t.border)
            .rounded(px(theme::metric::DIALOG_RADIUS))
            .bg(t.overlay)
            .text_color(t.text)
            .shadow(vec![BoxShadow {
                inset: false,
                color: t.shadow.into(),
                offset: point(px(0.), px(24.)),
                blur_radius: px(48.),
                spread_radius: px(0.),
            }])
            .children(header)
            .child(
                div()
                    .id(child_id(&self.id, "body"))
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .overflow_y_scroll()
                    .track_scroll(&body_scroll)
                    .pt(px(self.body_padding.0))
                    .px(px(self.body_inline.or(self.inset).unwrap_or(24.)))
                    .pb(px(self.body_padding.1))
                    .text_size(px(theme::ty().ui.meta))
                    .line_height(px(20.))
                    .text_color(t.muted)
                    .children(self.body)
                    .child(crate::ui::scrollbar::vertical(
                        child_id(&self.id, "body-scrollbar"),
                        &body_scroll,
                    )),
            )
            .when(!self.footer.is_empty(), |d| {
                d.child(
                    div()
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .justify_end()
                        .gap(px(10.))
                        .px(px(self.inset.unwrap_or(20.)))
                        .pb(px(self.inset.unwrap_or(20.)))
                        .children(self.footer),
                )
            })
            .refine_style(&self.style);
        BaseDialog::new(cx)
            .focus_handle(focus)
            .close_on_escape(true)
            .close_on_backdrop_press(self.close_on_backdrop)
            // Enter belongs to the dialog's own controls.
            .on_ok(|_, _, _| false)
            .on_cancel(move |_, window, cx| {
                if let Some(cancel) = &cancel {
                    cancel(window, cx);
                }
                false
            })
            .backdrop(div().size_full().bg(t.backdrop))
            .popup(surface)
    }
}
