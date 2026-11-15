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
