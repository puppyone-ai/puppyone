//! `.desktop-workspace-notice-stack`: what is wrong with the workspace's
//! change subscription (`workspaceSurfaceError`), with Retry, under the
//! notices about the window's folder that lead it.
use super::{ProjectEvent, ProjectLifecycle};
use crate::{
    geometry::Rect,
    localization::t as tr,
    ui::components::{FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone},
};
use gpui::{prelude::*, *};

impl ProjectLifecycle {
    /// The stack 12px below the top of the editor region `editor`, 16px in
    /// from its end (`end` from the window's), led by `folder` — what is
    /// said about the window's folder (it cannot be opened, its Cloud link).
    pub(in crate::app) fn notices(
        &self,
        editor: Rect,
        end: f32,
        folder: Vec<FloatingNotice>,
        weak: WeakEntity<Self>,
    ) -> Option<AnyElement> {
        let stack = || {
            NoticeStack::new(
                NoticePlacement::TopEnd,
                editor.y + 12.,
                end + 16.,
                (editor.w - 40.).min(400.),
            )
        };
        let Some(message) = &self.record.notice else {
            return (!folder.is_empty()).then(|| stack().children(folder).into_any_element());
        };
        let dismiss = weak.clone();
        Some(
            stack()
                .children(folder)
                .child(
                    FloatingNotice::new("workspace-notice", message.clone())
                        .tone(NoticeTone::Warning)
                        .action(NoticeAction::new(
                            "workspace-notice-retry",
                            tr("common.action.retry"),
                            move |_, cx| {
                                let _ = weak.update(cx, |p, cx| {
                                    p.record.notice = None;
                                    cx.emit(ProjectEvent::Retry);
                                });
                            },
                        ))
                        .on_dismiss(move |_, cx| {
                            let _ = dismiss.update(cx, |p, cx| {
                                p.record.notice = None;
                                cx.notify();
                            });
                        }),
                )
                .into_any_element(),
        )
    }
}
