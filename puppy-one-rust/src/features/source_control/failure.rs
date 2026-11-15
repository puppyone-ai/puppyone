//! A failed Git operation as the product explains it (`operationDialogs.tsx`:
//! `classifyGitOperationError`, `cleanGitOperationError`,
//! `formatGitOperationErrorState`, `buildGitFixPrompt`,
//! `GitOperationErrorDialog`): a summary by kind, Git's raw output, a prompt
//! to hand an AI, and Pull when a push was rejected.
use super::SourceControl;
use crate::{
    localization::{t as tr, tf},
    platform::git::Operation,
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Dialog, Icon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{base::v_flex, component::Sizable as _};
use regex::Regex;
use std::{sync::LazyLock, time::Duration};

/// `GitOperationErrorCode`, the kinds a Changes operation can produce.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Code {
    Init,
    PullDiverged,
    PullConflict,
    Pull,
    PushRejected,
    Push,
    Commit,
    Generic,
}
impl Code {
    fn key(self) -> &'static str {
        match self {
            Self::Init => "source-control.error.init",
            Self::PullDiverged => "source-control.error.pull-diverged",
            Self::PullConflict => "source-control.error.pull-conflict",
            Self::Pull => "source-control.error.pull",
            Self::PushRejected => "source-control.error.push-rejected",
            Self::Push => "source-control.error.push",
            Self::Commit => "source-control.error.commit",
            Self::Generic => "source-control.error.generic",
        }
    }
}

/// `GitOperationErrorState`.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Failure {
    /// The operation's label (`runGitOperation(label, …)`).
    pub operation: &'static str,
    pub code: Code,
    /// The cleaned message, for kinds whose summary needs it.
    pub detail: Option<String>,
    /// What the operation reported, as it was.
    pub raw: Option<String>,
    pub workspace: Option<String>,
}
impl Failure {
    /// `createGitOperationErrorState`.
    pub fn new(operation: &'static str, error: &str, workspace: Option<String>) -> Self {
        let (code, detail) = classify(error, operation);
        Self {
            operation,
            code,
            detail,
            raw: Some(error.trim().to_owned()).filter(|r| !r.is_empty()),
            workspace,
        }
    }
    /// `formatGitOperationErrorState`.
    pub fn message(&self) -> String {
        let summary = tr(self.code.key());
        match &self.detail {
            Some(detail) => tf(
                "source-control.error.withDetail",
                &[
                    ("summary", summary.into()),
                    ("detail", detail.clone().into()),
                ],
            ),
            None => summary.to_owned(),
        }
    }
    /// `recommendsPull`: a rejected push is answered by pulling first.
    pub fn recommends_pull(&self) -> bool {
        self.code == Code::PushRejected
    }
    /// `buildGitFixPrompt`.
    pub fn prompt(&self) -> String {
        let mut lines = vec![
            tr("source-control.prompt.intro").to_owned(),
            String::new(),
            tf(
                "source-control.prompt.operation",
                &[("operation", self.operation.into())],
            ),
            tf(
                "source-control.prompt.workspace",
                &[(
                    "workspace",
                    self.workspace
                        .clone()
                        .unwrap_or_else(|| tr("source-control.prompt.unknown").into())
                        .into(),
                )],
            ),
            String::new(),
            tr("source-control.prompt.summary").to_owned(),
            self.message(),
        ];
        if let Some(raw) = &self.raw {
            lines.extend([
                String::new(),
                tr("source-control.prompt.rawOutput").to_owned(),
                "```text".into(),
                raw.clone(),
                "```".into(),
            ]);
        }
        lines.extend([
            String::new(),
            tr("source-control.prompt.request").to_owned(),
        ]);
        lines.join("\n")
    }
}

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("static pattern")
}
/// `classifyGitOperationError`.
fn classify(error: &str, operation: &str) -> (Code, Option<String>) {
    static CONFLICT: LazyLock<Regex> =
        LazyLock::new(|| regex(r"(?i)\bconflict\b|could not apply|resolve all conflicts manually"));
    static DIVERGED: LazyLock<Regex> = LazyLock::new(|| {
        regex(r"(?i)not possible to fast-forward|diverging branches|diverged|non-fast-forward")
    });
    static REJECTED: LazyLock<Regex> =
        LazyLock::new(|| regex(r"(?i)non-fast-forward|fetch first|rejected"));
    let message = clean(error);
    let detail = Some(message.clone()).filter(|m| !m.is_empty());
    match operation {
        "init" => (Code::Init, detail),
        "pull" if CONFLICT.is_match(&message) => (Code::PullConflict, None),
        "pull" if DIVERGED.is_match(&message) => (Code::PullDiverged, None),
        "pull" => (Code::Pull, detail),
        "push" | "publish" if REJECTED.is_match(&message) => (Code::PushRejected, None),
        "push" | "publish" => (Code::Push, detail),
        "commit" => (Code::Commit, detail),
        _ => (Code::Generic, detail),
    }
}
/// `cleanGitOperationError`: without the operation's prefix and the failed
/// command line, on one line.
fn clean(value: &str) -> String {
    static PREFIXES: LazyLock<[Regex; 3]> = LazyLock::new(|| {
        [
            r"(?i)^Error invoking remote method '[^']+':\s*",
            r"(?i)^Error:\s*",
            concat!(
                r"(?i)^Unable to (?:checkout branch|initialize repository|stage changes|",
                r"commit changes|pull changes|fetch cloud changes|pull cloud changes|",
                r"push changes|stash changes|preview remote change|preview committed change|",
                r"read remote file diff|read committed file diff):\s*",
            ),
        ]
        .map(regex)
    });
    static ERROR: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^Error:\s*"));
    static COMMAND: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^(?:Command failed:|git -C\s)"));
    let mut text = value.to_owned();
    for prefix in PREFIXES.iter() {
        text = prefix.replace(&text, "").into_owned();
    }
    let joined = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !COMMAND.is_match(line) && !line.contains(" git -C "))
        .collect::<Vec<_>>()
        .join(" ");
    ERROR.replace(&joined, "").trim().to_owned()
}

impl SourceControl {
    /// The failure the dialog shows, while one is open.
    pub fn has_failure(&self) -> bool {
        self.failure.is_some()
    }
    /// An operation's failure, as a run reports it (window tests).
    #[cfg(test)]
    pub fn fail(&mut self, operation: &'static str, error: &str, cx: &mut Context<Self>) {
        self.failure = Some(Failure::new(operation, error, None));
        cx.emit(super::SourceControlEvent::Failure);
    }
    /// The dialog closed (Close, Escape or the backdrop).
    pub fn dismiss_failure(&mut self, cx: &mut Context<Self>) {
        if self.failure.take().is_some() {
            self.prompt_copied = false;
            cx.emit(super::SourceControlEvent::Failure);
            cx.notify();
        }
    }
    /// `GitOperationErrorDialog`.
    pub fn failure_dialog(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let Some(failure) = self.failure.clone() else {
            return Empty.into_any_element();
        };
        let t = cx.palette();
        let m = theme::ty();
        let host = cx.weak_entity();
        let close = host.clone();
        let mut body = v_flex().gap(px(12.)).child(
            div()
                .text_size(px(m.ui.body))
                .line_height(px(20.))
                .text_color(t.muted)
                .child(failure.message()),
        );
        if let Some(raw) = failure.raw.clone() {
            // `.desktop-git-error-dialog-raw`.
            body = body.child(
                v_flex()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(m.ui.meta))
                            .font_weight(FontWeight(650.))
                            .text_color(t.subtle)
                            .child(tr("source-control.dialog.error.rawOutput")),
                    )
                    .child(
                        div()
                            .id("git-error-raw")
                            .max_h(px(220.))
                            .overflow_y_scroll()
                            .p(px(10.))
                            .border_1()
                            .border_color(t.border_subtle)
                            .rounded(px(8.))
                            .bg(theme::alpha(t.text, 0.07))
                            .font_family(theme::MONO)
                            .text_size(px(m.ui.meta))
                            .line_height(px(17.))
                            .text_color(t.muted)
                            .child(raw),
                    ),
            );
        }
        let copy = host.clone();
        let prompt = failure.prompt();
        let dialog = Dialog::new("git-operation-error")
            .width(720.)
            .title(tr("source-control.dialog.error.title"))
            .leading(Icon::new("triangle-alert").with_size(px(17.)), t.warning)
            .on_close(move |_, cx| {
                let _ = close.update(cx, |s, cx| s.dismiss_failure(cx));
            })
            .child(body)
            .footer(
                Button::new("git-error-copy-prompt")
                    .variant(ButtonVariant::Secondary)
                    .label(tr(if self.prompt_copied {
                        "common.action.copied"
                    } else {
                        "source-control.dialog.error.copyPrompt"
                    }))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(prompt.clone()));
                        let _ = copy.update(cx, |s, cx| s.show_prompt_copied(cx));
                    }),
            );
        if failure.recommends_pull() {
            dialog
                .footer(
                    Button::new("git-error-pull")
                        .variant(ButtonVariant::Solid)
                        .label(tr("source-control.sync.pull"))
                        .on_click(move |_, _, cx| {
                            let _ = host.update(cx, |s, cx| {
                                s.dismiss_failure(cx);
                                s.operation(Operation::Pull, cx);
                            });
                        }),
                )
                .into_any_element()
        } else {
            dialog
                .footer(
                    Button::new("git-error-close")
                        .variant(ButtonVariant::Secondary)
                        .label(tr("common.action.close"))
                        .on_click(move |_, _, cx| {
                            let _ = host.update(cx, |s, cx| s.dismiss_failure(cx));
                        }),
                )
                .into_any_element()
        }
    }
    /// "Copied" for 1.4s after the prompt is on the clipboard.
    fn show_prompt_copied(&mut self, cx: &mut Context<Self>) {
        self.prompt_copied = true;
        cx.notify();
        self.prompt_reset = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(1400))
                .await;
            let _ = this.update(cx, |s, cx| {
                s.prompt_copied = false;
                cx.notify();
            });
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `gitOperationErrorDialog.test.tsx` and `classifyGitOperationError`.
    #[test]
    fn failures_are_classified_like_the_product() {
        let kind = |error: &str, operation| classify(error, operation);
        assert_eq!(
            kind(
                "CONFLICT (content): Merge conflict in shared.md\nerror: could not apply abc123",
                "pull"
            ),
            (Code::PullConflict, None)
        );
        assert_eq!(
            kind(
                "Unable to pull changes: fatal: Not possible to fast-forward, aborting.",
                "pull"
            ),
            (Code::PullDiverged, None)
        );
        assert_eq!(
            kind(
                "Unable to pull changes: fatal: unable to access 'x'",
                "pull"
            ),
            (Code::Pull, Some("fatal: unable to access 'x'".into()))
        );
        let rejected =
            " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs";
        for operation in ["push", "publish"] {
            assert_eq!(
                kind(&format!("Unable to push changes: {rejected}"), operation),
                (Code::PushRejected, None)
            );
        }
        assert_eq!(
            kind(
                "Unable to push changes: no Git remote is configured.",
                "push"
            ),
            (Code::Push, Some("no Git remote is configured.".into()))
        );
        assert_eq!(
            kind("nothing to commit, working tree clean", "commit").0,
            Code::Commit
        );
        // "Conflicts" is not the word "conflict"; other operations are generic.
        assert_eq!(kind("Conflicts ahead", "pull").0, Code::Pull);
        assert_eq!(
            kind("Error: Command failed: git -C /x add\nfatal: bad", "stage"),
            (Code::Generic, Some("fatal: bad".into()))
        );
        assert_eq!(kind("", "init"), (Code::Init, None));
    }
    #[test]
    fn the_prompt_carries_the_summary_and_the_raw_output() {
        let failure = Failure::new(
            "push",
            "Unable to push changes: ! [rejected] main -> main (fetch first)",
            Some("/workspace".into()),
        );
        assert!(failure.recommends_pull());
        let prompt = failure.prompt();
        assert!(prompt.starts_with(tr("source-control.prompt.intro")));
        assert!(prompt.contains("Operation: push"));
        assert!(prompt.contains("Workspace: /workspace"));
        assert!(prompt.contains(&failure.message()));
        assert!(prompt.contains("```text\nUnable to push changes: ! [rejected]"));
        assert!(prompt.ends_with(tr("source-control.prompt.request")));
        let quiet = Failure::new("commit", "  ", None);
        assert!(!quiet.recommends_pull() && quiet.raw.is_none());
        assert_eq!(quiet.message(), tr("source-control.error.commit"));
        assert!(quiet.prompt().contains(tr("source-control.prompt.unknown")));
    }
}
