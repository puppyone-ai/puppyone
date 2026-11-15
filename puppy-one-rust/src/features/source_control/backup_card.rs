//! `GitRemotePrompt` (`sidebar/GitRemoteSections.tsx`,
//! `.desktop-git-backup-card`): a repository with nowhere to send its
//! commits is reminded that it is not in Puppyone Cloud, with Publish and a
//! dismissal.
use super::{SourceControl, SourceControlEvent};
use crate::{
    localization::t as tr,
    platform::git::Snapshot,
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        components::{Icon, IconButton, ProductIcon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};

impl SourceControl {
    /// What the window's Cloud says: whether Cloud is on, and whether a
    /// first publication is running (`cloudBackup.enabled` / `.loading`).
    pub fn set_cloud_backup(&mut self, enabled: bool, publishing: bool, cx: &mut Context<Self>) {
        if (self.cloud_enabled, self.cloud_publishing) != (enabled, publishing) {
            self.cloud_enabled = enabled;
            self.cloud_publishing = publishing;
            cx.notify();
        }
    }
    /// `!cloudEnabled || !state.setupRequired || dismissed` hides it.
    pub(super) fn shows_backup_card(&self, snapshot: &Snapshot) -> bool {
        self.cloud_enabled && snapshot.setup_required() && !self.backup_dismissed
    }
    /// The card: the reminder, then dismiss at the start and Publish at the
    /// end of one row.
    pub(super) fn backup_card(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let m = theme::ty();
        let loading = self.cloud_publishing;
        let disabled = self.busy || loading;
        let (bg, fg, border) = if disabled {
            (t.control, t.text_disabled, t.border_subtle)
        } else {
            (t.text, t.text_inverse, theme::mix(t.text, t.border, 0.32))
        };
        let hover = theme::mix(t.text, t.accent, 0.9);
        let action = div()
            .id("git-backup-action")
            .flex()
            .items_center()
            .justify_center()
            .gap(px(5.))
            .h(px(24.))
            .min_w(px(82.))
            .px(px(7.))
            .border_1()
            .border_color(border)
            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
            .bg(bg)
            .text_color(fg)
            .text_size(px(m.left.content))
            .font_weight(FontWeight(650.))
            .child(Icon::product(ProductIcon::Cloud).with_size(px(13.)))
            .child(tr("source-control.backup.getCloud"))
            .when(!disabled, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(hover))
                    .on_click(cx.listener(|_, _, _, cx| cx.emit(SourceControlEvent::BackUpToCloud)))
            });
        v_flex()
            .flex_shrink_0()
            .gap(px(8.))
            .mt(px(5.))
            .mb(px(10.))
            .ml(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .mr(px(metric::SIDEBAR_ROW_RIGHT_GAP))
            .p(px(8.))
            .border_1()
            .border_color(t.border_subtle)
            .rounded(px(8.))
            .bg(theme::alpha(t.control, 0.36))
            .child(
                div()
                    .min_w_0()
                    .text_size(px(m.left.content))
                    .line_height(relative(1.4))
                    .text_color(t.muted)
                    .child(tr("source-control.backup.reminder")),
            )
            .child(
                h_flex()
                    .justify_between()
                    .gap(px(6.))
                    .child(
                        IconButton::new("git-backup-dismiss", Icon::new("x").with_size(px(13.)))
                            .label(tr("source-control.backup.dismissAriaLabel"))
                            .tooltip(tr("source-control.action.dismiss"))
                            .with_size(px(24.))
                            .color(t.text_disabled)
                            .rounded(px(metric::TOOLBAR_ACTION_RADIUS))
                            .disabled(loading)
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.backup_dismissed = true;
                                cx.notify();
                            })),
                    )
                    .child(action),
            )
    }
}
