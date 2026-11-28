//! A question a viewer puts to the person over its window, answered once:
//! the app shows it as its own dialog (`DesktopDialog`) when it has said how
//! (`set_asker`), else the system's prompt asks it.
use gpui::*;
use std::{cell::RefCell, rc::Rc};

pub struct Question {
    pub window: AnyWindowHandle,
    pub title: String,
    pub detail: String,
    /// The default answer's label (focused first; dismissing gives it).
    pub decline: String,
    pub accept: String,
    pub answer: Answer,
}

/// What the question does with the answer (`true`: accepted).
pub type Answer = Box<dyn FnOnce(bool, &mut App)>;

type Asker = Rc<dyn Fn(Question, &mut App)>;

thread_local! {
    static ASKER: RefCell<Option<Asker>> = const { RefCell::new(None) };
}

/// How the app shows questions over its windows.
pub fn set_asker(asker: impl Fn(Question, &mut App) + 'static) {
    ASKER.with(|a| *a.borrow_mut() = Some(Rc::new(asker)));
}

pub fn ask(question: Question, cx: &mut App) {
    if let Some(asker) = ASKER.with(|a| a.borrow().clone()) {
        asker(question, cx);
        return;
    }
    let Question {
        window,
        title,
        detail,
        decline,
        accept,
        answer,
    } = question;
    let asked = cx.update_window(window, |_, window, cx| {
        window.prompt(
            PromptLevel::Info,
            &title,
            Some(&detail),
            &[PromptButton::new(decline), PromptButton::new(accept)],
            cx,
        )
    });
    cx.spawn(async move |cx| {
        let accepted = match asked {
            Ok(reply) => matches!(reply.await, Ok(1)),
            Err(_) => false,
        };
        cx.update(|cx| answer(accepted, cx));
    })
    .detach();
}

/// "Open in default app" (`workspace:open-entry-external`): a file that may
/// run code asks first over `window`, and the path is checked again when
/// the answer comes (`open` refuses a link put there meanwhile).
pub fn open_external(
    window: Option<AnyWindowHandle>,
    path: std::path::PathBuf,
    failed: impl FnOnce(String, &mut App) + 'static,
    cx: &mut App,
) {
    use crate::localization::{t, tf};
    use crate::platform::desktop;
    // Failures are reported once the caller's update ends: a pane menu
    // command reports through the shell it is still updating.
    if !desktop::potentially_executable(&path) {
        if let Err(error) = desktop::open(&path) {
            cx.defer(move |cx| failed(error, cx));
        }
        return;
    }
    // A click asks over its own window; with none to ask over, nothing runs.
    let Some(window) = window.or_else(|| cx.active_window()) else {
        let error = t("native.executable.open.detail").to_owned();
        cx.defer(move |cx| failed(error, cx));
        return;
    };
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Asked once the caller's update ends: the dialog layer belongs to the
    // window's shell, which a pane menu command is still updating.
    let question = Question {
        window,
        title: t("native.executable.open.title").into(),
        detail: format!(
            "{} {}",
            tf(
                "native.executable.open.message",
                &[("fileName", name.into())]
            ),
            t("native.executable.open.detail")
        ),
        decline: t("native.executable.open.cancel").into(),
        accept: t("native.executable.open.confirm").into(),
        answer: Box::new(move |accepted, cx| {
            if accepted && let Err(error) = desktop::open(&path) {
                failed(error, cx);
            }
        }),
    };
    cx.defer(move |cx| ask(question, cx));
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `workspace-files-ipc`: an executable asks before it opens, a link
    /// swapped in while the question is open is refused, and a document
    /// opens without asking.
    #[gpui::test]
    fn executables_ask_first_and_are_checked_again_after_the_answer(cx: &mut TestAppContext) {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("run.command");
        let note = dir.path().join("note.md");
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(&script, "echo safe").unwrap();
        std::fs::write(&note, "# note").unwrap();
        std::fs::write(outside.path().join("replacement.command"), "echo outside").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o644)).unwrap();
        let window = cx.add_window(|_, _| gpui::Empty).into();
        let opened = crate::platform::desktop::record_opens();
        let asked: Rc<RefCell<Vec<Question>>> = Rc::default();
        let questions = asked.clone();
        cx.update(|_| set_asker(move |question, _| questions.borrow_mut().push(question)));
        let failures: Rc<RefCell<Vec<String>>> = Rc::default();
        let open = |path: &std::path::Path, cx: &mut TestAppContext| {
            let failures = failures.clone();
            let path = path.to_path_buf();
            cx.update(|cx| {
                open_external(
                    Some(window),
                    path,
                    move |e, _| failures.borrow_mut().push(e),
                    cx,
                )
            });
        };

        open(&note, cx);
        assert!(asked.borrow().is_empty(), "a document opens without asking");
        assert_eq!(*opened.borrow(), std::slice::from_ref(&note));

        open(&script, cx);
        let question = asked.borrow_mut().pop().expect("an executable asks first");
        assert_eq!(question.title, "Open executable file?");
        assert!(question.detail.contains("run.command"));
        assert_eq!(
            (question.decline.as_str(), question.accept.as_str()),
            ("Cancel", "Open")
        );
        cx.update(|cx| (question.answer)(false, cx));
        assert_eq!(opened.borrow().len(), 1, "declining opens nothing");

        #[cfg(unix)]
        {
            open(&script, cx);
            let question = asked.borrow_mut().pop().unwrap();
            std::fs::remove_file(&script).unwrap();
            std::os::unix::fs::symlink(outside.path().join("replacement.command"), &script)
                .unwrap();
            cx.update(|cx| (question.answer)(true, cx));
            assert_eq!(opened.borrow().len(), 1, "a link swapped in is not opened");
            assert_eq!(failures.borrow().len(), 1);
            std::fs::remove_file(&script).unwrap();
            std::fs::write(&script, "echo safe").unwrap();
        }
        open(&script, cx);
        let question = asked.borrow_mut().pop().unwrap();
        cx.update(|cx| (question.answer)(true, cx));
        assert_eq!(opened.borrow().last(), Some(&script));
    }
}
