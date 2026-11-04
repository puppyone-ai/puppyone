//! Callouts (product features/callout): a blockquote opening with
//! `[!type]` is a tinted box in its type's colour — no quote rule, rounded
//! top and bottom, 8px above the title — whose first line is its title in that
//! colour at weight 600 behind the type's glyph. Without a title the type
//! word stands in. While the caret is on the title line, the marker shows
//! as source. A foldable callout (`[!type]-` folded, `[!type]+` open) has
//! a chevron after its title that folds it to its title alone in this pane.
use crate::editor::{
    markdown::core::{
        decorations::{BlockDecoration, LineDecoration},
        feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan, Presentation},
        state::PreviewState,
    },
    text::state::{EditorState, Transaction},
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

/// `.cm-md-callout-icon`: 18px, 8px before the title.
const ICON: f32 = 18.;
const ICON_GAP: f32 = 8.;
/// `.is-title { padding-top: 8px }`. (`.is-last`'s 8px bottom padding
/// loses to the line rhythm's, so the last line keeps its own.)
const TITLE_PADDING: f32 = 8.;
/// The type word's header (`inline-flex`, 1lh, `vertical-align:
/// text-bottom`) deepens its line by a quarter em below the text (measured
/// in the product: 41.75px against 38px for a titled callout at 15px).
const HEADER_DEPTH: f32 = 0.25;
/// `.cm-md-callout-fold`: 6px after the title (and the header's 8px margin
/// before it when the type word stands in).
const FOLD_GAP: f32 = 6.;

/// Fold (or open) the callout whose marker starts at `at`.
#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub struct Fold {
    pub at: usize,
    pub folded: bool,
}

use crate::editor::tokens::callout_color as color;

/// The body of a folded callout, out of the flow.
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct FoldedBody {
    pub range: Range<usize>,
}
struct FoldedWidget;
impl BlockWidget for FoldedWidget {
    fn render(&self, cx: &mut WidgetCx) -> (gpui::AnyElement, f32) {
        (cx.block_box(0.).into_any_element(), 0.)
    }
}

impl MarkdownFeature for CalloutFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        for callout in &cx.syntax.callouts {
            if cx.folds.folded(callout) && callout.last_line > callout.first_line {
                let range = cx.doc.line_range(callout.first_line + 1).start
                    ..cx.doc.line_range(callout.last_line).end;
                out.push(Plan {
                    element: None,
                    source: range.clone(),
                    presentation: Presentation::BlockAtom(BlockEmbed::new(
                        ID,
                        FoldedBody { range },
                    )),
                    delete_units: Vec::new(),
                });
            }
        }
    }

    fn block_widget(&self, embed: &BlockEmbed, _: &WidgetFactoryCx) -> Option<Rc<dyn BlockWidget>> {
        embed.model::<FoldedBody>()?;
        Some(Rc::new(FoldedWidget))
    }

    /// The folded lines are no caret position.
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
        preview.callout_folds.set(fold.at, fold.folded);
        Some(Transaction::select(state.selection))
    }

    fn decorate_line(&self, cx: &mut LineDecoration) {
        let Some(callout) = cx.syntax.callout_at(cx.line) else {
            return;
        };
        let folded = cx.preview.callout_folds.folded(callout);
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
            style.padding.top += TITLE_PADDING;
            style.background_radii[0] = radius;
            style.background_radii[1] = radius;
        }
        if cx.line == last {
            style.background_radii[2] = radius;
            style.background_radii[3] = radius;
        }
        // The header stands in for the marker, unless the caret is there.
        if title && cx.preview.callout_title != Some(cx.line) {
            let icon = Paint::Icon {
                rect: Rect::new(
                    style.border.left + style.padding.left,
                    style.border.top
                        + style.padding.top
                        + (style.text.line_height_px() - ICON) / 2.,
                    ICON,
                    ICON,
                ),
                path: SharedString::from(format!("icons/callout-{}.svg", callout.appearance)),
                color: tint,
            };
            style.padding.left += ICON + ICON_GAP;
            style.overlays.push(icon);
            if callout.fold.is_some() {
                style.trailing = Some(Trailing {
                    gap: FOLD_GAP + if callout.has_title { 0. } else { ICON_GAP },
                    size: ICON,
                    icon: SharedString::from("icons/callout-chevron.svg"),
                    color: tint,
                    // `rotate(90deg)` while open.
                    rotation: if folded { 0. } else { 90. },
                    command: Command::new(
                        ID,
                        Fold {
                            at: callout.marker.start,
                            folded: !folded,
                        },
                    ),
                });
            }
            if callout.has_title {
                cx.hidden.push(callout.marker.clone());
            } else {
                style.padding.bottom += HEADER_DEPTH * style.text.size;
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
    use crate::editor::{markdown::core::syntax::Syntax, text::buffer::Buffer};
    use core::prelude::v1::test;

    #[test]
    fn callouts_follow_the_product_marker() {
        let doc =
            Buffer::new("> [!TIP]- Remember\n> body\n> more\n\n> [!unknown]\n> x\n\n> plain\n");
        let s = Syntax::parse(&doc);
        assert_eq!(s.callouts.len(), 2);
        let tip = &s.callouts[0];
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
        let other = &s.callouts[1];
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
