//! `ProjectOpeningSurface` and `ProjectPreparation`: a chosen project is
//! entered at once. Until it answers, the window is that project's window:
//! its name in the Header, the Explorer column waiting for its first folder
//! (the tree's skeleton), and the loading mark at the exact centre of the
//! editor's region. A Cloud project says which stage it has reached and can
//! be abandoned (Cancel, or Escape); a local folder has no stages to name.
//! The project being left keeps its place behind the wait, so a failed or
//! cancelled open simply shows it again.
use super::*;
use crate::theme::metric;
use crate::{
    localization::t as tr,
    ui::{
        components::{Button, ButtonVariant},
        loading::{self, LoaderSize, LoadingMark, Tone, model::Shape},
    },
};
use gpui_kit::base::v_flex;

/// `ExplorerTreeSkeleton`: six rows, at these depths.
const SKELETON_DEPTHS: [f32; 6] = [0., 1., 1., 0., 1., 1.];
/// `.explorer-tree-skeleton-row:nth-child(n) .explorer-tree-skeleton-label`.
const SKELETON_LABELS: [f32; 6] = [0.52, 0.44, 0.58, 0.64, 0.38, 0.49];
/// `.desktop-project-opening-detail`: what is said hangs this far below the
/// centre, so text arriving never moves the mark.
const DETAIL_OFFSET: f32 = 24.;

impl Shell {
    /// A project is on its way into this window.
    pub(super) fn opening(&self) -> bool {
        self.files.cloud_opening().is_some() || self.files.preparing_root().is_some()
    }
    /// The skeleton of the Explorer tree in a column `width` wide.
    fn explorer_skeleton(width: f32, cx: &App) -> impl IntoElement {
        let stride = theme::sidebar_stride();
        let row = stride - 2.;
        let inner = (width - metric::SIDEBAR_ROW_LEFT_GAP * 2.).max(0.);
        let shapes = SKELETON_DEPTHS
            .iter()
            .zip(SKELETON_LABELS)
            .enumerate()
            .flat_map(|(index, (depth, label))| {
                let start = metric::TREE_ROW_CONTENT_LEFT + depth * metric::TREE_INDENT;
                let y = index as f32 * stride + 1.;
                let icon = Shape {
                    x: start as f64,
                    y: (y + (row - 14.) / 2.) as f64,
                    width: 14.,
                    height: 14.,
                    radius: 4.,
                };
                let label_x = start + 14. + metric::SIDEBAR_ICON_LABEL_GAP;
                let label = Shape {
                    x: label_x as f64,
                    y: (y + (row - 9.) / 2.) as f64,
                    width: ((inner - start) * label).max(0.) as f64,
                    height: 9.,
                    radius: 4.5,
                };
                [icon, label]
            })
            .collect::<Vec<_>>();
        let style = cx
            .try_global::<crate::ui::appearance::Appearance>()
            .map(|a| a.loading_style)
            .unwrap_or_default();
        div()
            .pt(px(12.))
            .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .child(loading::placeholder(
                "explorer-tree-skeleton",
                inner,
                stride * SKELETON_DEPTHS.len() as f32,
                shapes,
                style,
            ))
    }
    /// `ProjectPreparation` over the window below the Header, or nothing
    /// while no project is on its way in.
    pub(super) fn project_preparation(
        &self,
        w: f32,
        h: f32,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if !self.opening() {
            return None;
        }
        let t = cx.palette();
        let top = metric::CHROME_HEIGHT;
        let explorer = self.layout.explorer;
        let editor = self.layout.editor;
        let cloud = self.files.cloud_opening();
        // `CloudWorkspaceOpeningLoading`: one line for the stage, and Cancel.
        let detail = cloud.map(|phase| {
            use crate::workspace::cloud::opening::Phase;
            let label = tr(match phase {
                Phase::Checking | Phase::Connecting => "cloud.loading.startingWorkspace",
                Phase::Files => "cloud.loading.files",
            });
            let ty = theme::ty().ui;
            v_flex()
                .absolute()
                .top(px(editor.h / 2. + DETAIL_OFFSET))
                .left(px(32.))
                .right(px(32.))
                .items_center()
                .gap(px(12.))
                .child(
                    div()
                        .max_w_full()
                        .truncate()
                        .text_size(px(ty.body))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.text)
                        .child(label),
                )
                .child(
                    Button::new("project-opening-cancel")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("common.action.cancel"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.files.cancel_cloud();
                            cx.notify();
                        })),
                )
        });
        let opening = div()
            .absolute()
            .left(px(editor.x))
            .top(px(editor.y - top))
            .w(px(editor.w))
            .h(px(editor.h))
            .bg(t.canvas)
            .flex()
            .items_center()
            .justify_center()
            .child(
                LoadingMark::new("project-opening")
                    .area()
                    .size(LoaderSize::Md)
                    .tone(Tone::Neutral),
            )
            .children(detail);
        Some(
            div()
                .id("project-preparation")
                .debug_selector(|| "project-preparation".into())
                .absolute()
                .left_0()
                .top(px(top))
                .w(px(w))
                .h(px((h - top).max(0.)))
                .occlude()
                .bg(t.canvas)
                .when(self.panes.explorer().open && explorer.w > 0., |d| {
                    d.child(
                        div()
                            .absolute()
                            .left(px(explorer.x))
                            .top(px(explorer.y - top))
                            .w(px(explorer.w))
                            .h(px(explorer.h))
                            .bg(t.sidebar)
                            .overflow_hidden()
                            .child(Self::explorer_skeleton(explorer.w, cx)),
                    )
                })
                .child(opening)
                .into_any_element(),
        )
    }
}
