//! Callouts (product `features/callout`, `TA-40`): header recognition lives in
//! [`syntax`], model parsing in [`model`], plan compilation in [`plan`], icon
//! assets in [`icons`], and fold/title-reveal state in [`state`].
pub mod icons;
pub mod model;
pub mod plan;
pub mod state;
pub mod syntax;

pub use model::{Callout, FoldedBody, callout_at, collect_callouts, parse_callout};
pub use state::{CalloutFoldState, CalloutFolds};

use crate::editor::{
    markdown::core::{
        decorations::{BlockDecoration, LineDecoration},
        features::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan},
        state::PreviewState,
    },
    text::state::{EditorState, Transaction},
    tokens::callout_color as color,
    view::{
        command::Command,
        style::{Paint, Rect, Trailing},
        widget::{BlockWidget, WidgetCx},
    },
};
use gpui::{IntoElement, Rgba, SharedString};
use std::{ops::Range, rc::Rc};

pub struct CalloutFeature;
pub static FEATURE: CalloutFeature = CalloutFeature;
pub const ID: &str = "callout";

/// Fold (or open) the callout whose marker starts at `at`.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct Fold {
    pub at: usize,
    pub folded: bool,
}

struct FoldedWidget;
impl BlockWidget for FoldedWidget {
    fn render(&self, cx: &mut WidgetCx) -> (gpui::AnyElement, f32) {
        (cx.block_box(0.).into_any_element(), 0.)
    }

    fn eq_widget(&self, other: &dyn BlockWidget) -> bool {
        (other as &dyn std::any::Any).is::<Self>()
    }

    fn estimate_height(&self, _lines: Range<usize>, _width: f32) -> f32 {
        0.
    }
}

impl MarkdownFeature for CalloutFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        plan::compile_blocks(cx, out);
    }

    fn block_widget(&self, embed: &BlockEmbed, _: &WidgetFactoryCx) -> Option<Rc<dyn BlockWidget>> {
        embed.model::<FoldedBody>()?;
        Some(Rc::new(FoldedWidget))
    }

    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(body) = embed.model::<FoldedBody>() {
            cx.atomic(body.range.clone());
        }
    }

    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let fold = command.payload::<Fold>()?;
        preview
            .state_mut::<CalloutFoldState>(ID)
            .set(fold.at, fold.folded, state.revision);
        Some(Transaction::select(state.selection))
    }

    fn decorate_line(&self, cx: &mut LineDecoration) {
        let Some(callout) = model::callout_at(cx.doc, cx.syntax, cx.line) else {
            return;
        };
        let folded = state::is_folded(&callout, cx.preview.state::<CalloutFoldState>(ID));
        let last = if folded {
            callout.first_line
        } else {
            callout.last_line
        };
        if cx.line > last {
            return;
        }
        let tint = color(callout.appearance);
        let radius = cx.theme.block.radius;
        let style = &mut *cx.style;
        style.border.left = 0.;
        style.border_color = None;
        style.background = Some(Rgba { a: 0.10, ..tint });
        style.text.color = cx.theme.body.text.color;
        let title = cx.line == callout.first_line;
        if title {
            style.text.color = tint;
            style.text.weight = 600.;
            style.padding.top += icons::TITLE_PADDING;
            style.background_radii[0] = radius;
            style.background_radii[1] = radius;
        }
        if cx.line == last {
            style.background_radii[2] = radius;
            style.background_radii[3] = radius;
        }
        if title && !state::is_title_revealed(cx.preview, cx.line) {
            let icon = Paint::Icon {
                rect: Rect::new(
                    style.border.left + style.padding.left,
                    style.border.top
                        + style.padding.top
                        + (style.text.line_height_px() - icons::ICON) / 2.,
                    icons::ICON,
                    icons::ICON,
                ),
                path: SharedString::from(icons::icon_path(callout.appearance)),
                color: tint,
            };
            style.padding.left += icons::ICON + icons::ICON_GAP;
            style.overlays.push(icon);
            if callout.fold.is_some() {
                style.trailing = Some(Trailing {
                    gap: icons::FOLD_GAP
                        + if callout.has_title {
                            0.
                        } else {
                            icons::ICON_GAP
                        },
                    size: icons::ICON,
                    icon: SharedString::from(icons::CHEVRON_ICON),
                    color: tint,
                    rotation: if folded { 0. } else { 90. },
                    command: Command::new(
                        ID,
                        Fold {
                            at: callout.marker.start,
                            folded: !folded,
                        },
                    )
                    .preserving_focus(),
                });
            }
            if callout.has_title {
                cx.hidden.push(callout.marker.clone());
            } else {
                style.padding.bottom += icons::HEADER_DEPTH * style.text.size;
                cx.replaced.push((
                    callout.marker.clone(),
                    SharedString::from(callout.default_title.clone()),
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::model::collect_callouts;
    use crate::editor::{markdown::core::syntax::Syntax, text::buffer::Buffer};
    use core::prelude::v1::test;

    #[test]
    fn callouts_follow_the_product_marker() {
        let doc =
            Buffer::new("> [!TIP]- Remember\n> body\n> more\n\n> [!unknown]\n> x\n\n> plain\n");
        let s = Syntax::parse(&doc);
        let callouts = collect_callouts(&doc, &s);
        assert_eq!(callouts.len(), 2);
        let tip = &callouts[0];
        assert_eq!(
            (
                tip.appearance,
                tip.has_title,
                tip.fold,
                tip.first_line,
                tip.last_line
            ),
            ("tip", true, Some(true), 0, 2)
        );
        assert_eq!(&doc.as_str()[tip.marker.clone()], "[!TIP]- ");
        let other = &callouts[1];
        assert_eq!(
            (
                other.appearance,
                other.default_title.as_str(),
                other.has_title
            ),
            ("note", "Unknown", false)
        );
    }
}
