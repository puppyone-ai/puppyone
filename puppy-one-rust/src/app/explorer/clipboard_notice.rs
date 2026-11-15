//! `FileOperationNotice` (`useFileClipboard`): what the Explorer's file
//! clipboard says, bottom-end over the workspace — the items it holds, a
//! paste or duplicate while it runs, then how it went. Information goes
//! after 2.6s and a failure after 6s, never while the operation runs.
use super::session::ExplorerSession;
use crate::localization::{t, tf};
use crate::ui::components::{FloatingNotice, NoticePlacement, NoticeStack, NoticeTone};
use gpui::{App, Entity};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Copy,
    Move,
    Duplicate,
}
impl Mode {
    fn key(self) -> &'static str {
        match self {
            Self::Copy => "copy",
            Self::Move => "move",
            Self::Duplicate => "duplicate",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Notice {
    /// Copied or cut, waiting to be pasted.
    Selected {
        cut: bool,
        count: usize,
    },
    Working {
        mode: Mode,
        count: usize,
    },
    /// Into `target` (`None`: the workspace root).
    Done {
        mode: Mode,
        count: usize,
        target: Option<PathBuf>,
    },
    Failed {
        detail: String,
    },
}

impl Notice {
    /// `formatFileOperationNotice`.
    pub fn message(&self) -> String {
        let count = |n: usize| ("count", n.into());
        match self {
            Self::Selected { cut, count: n } => tf(
                if *cut {
                    "workspace.clipboard.selectedCut"
                } else {
                    "workspace.clipboard.selectedCopy"
                },
                &[count(*n)],
            ),
            Self::Working { mode, count: n } => tf(
                match mode {
                    Mode::Copy => "workspace.clipboard.copying",
                    Mode::Move => "workspace.clipboard.moving",
                    Mode::Duplicate => "workspace.clipboard.duplicating",
                },
                &[count(*n)],
            ),
            Self::Done {
                mode: Mode::Duplicate,
                count: n,
                ..
            } => tf("workspace.clipboard.completed.duplicate", &[count(*n)]),
            Self::Done {
                mode,
                count: n,
                target,
            } => tf(
                &format!("workspace.clipboard.completed.{}", mode.key()),
                &[
                    count(*n),
                    ("target", folder_label(target.as_deref()).into()),
                ],
            ),
            Self::Failed { detail } => tf(
                "workspace.clipboard.failedDetail",
                &[("detail", crate::localization::bidi_isolate(detail).into())],
            ),
        }
    }
    /// How long it stays (`None`: while its operation runs).
    pub fn lifetime(&self) -> Option<Duration> {
        match self {
            Self::Working { .. } => None,
            Self::Failed { .. } => Some(Duration::from_millis(6000)),
            _ => Some(Duration::from_millis(2600)),
        }
    }
    /// `fileOperationNoticePresentation`.
    pub fn view(&self) -> FloatingNotice {
        let tone = match self {
            Self::Failed { .. } => NoticeTone::Danger,
            Self::Done { .. } => NoticeTone::Success,
            _ => NoticeTone::Neutral,
        };
        FloatingNotice::new("file-operation-notice", self.message())
            .tone(tone)
            .busy(matches!(self, Self::Working { .. }))
    }
}

/// `.desktop-file-operation-notice-stack`: 16px from the window's bottom
/// and end edges, at most min(400px, 100% − the Explorer − 40px) wide.
pub fn stack(
    session: &Entity<ExplorerSession>,
    width: f32,
    explorer: f32,
    cx: &App,
) -> Option<NoticeStack> {
    let notice = session.read(cx).notice()?.view();
    let weak = session.downgrade();
    Some(
        NoticeStack::new(
            NoticePlacement::BottomEnd,
            16.,
            16.,
            (width - explorer - 40.).min(400.),
        )
        .child(notice.on_dismiss(move |_, cx| {
            let _ = weak.update(cx, |s, cx| s.dismiss_notice(cx));
        })),
    )
}

/// `formatFolderLabel`: the target folder's name, or the workspace root.
fn folder_label(path: Option<&Path>) -> String {
    path.and_then(Path::file_name)
        .map(|name| crate::localization::bidi_isolate(&name.to_string_lossy()))
        .unwrap_or_else(|| t("workspace.clipboard.workspaceRoot").to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn notices_say_what_the_product_says_and_last_as_long() {
        let selected = Notice::Selected {
            cut: true,
            count: 2,
        };
        assert_eq!(
            selected.message(),
            tf(
                "workspace.clipboard.selectedCut",
                &[("count", 2usize.into())]
            )
        );
        let working = Notice::Working {
            mode: Mode::Copy,
            count: 3,
        };
        assert_eq!(working.lifetime(), None);
        let done = Notice::Done {
            mode: Mode::Move,
            count: 1,
            target: None,
        };
        assert!(
            done.message()
                .contains(t("workspace.clipboard.workspaceRoot"))
        );
        assert_eq!(done.lifetime(), Some(Duration::from_millis(2600)));
        let failed = Notice::Failed {
            detail: "a.md: denied".into(),
        };
        assert_eq!(failed.lifetime(), Some(Duration::from_millis(6000)));
        assert!(failed.message().contains("a.md: denied"));
    }
}
