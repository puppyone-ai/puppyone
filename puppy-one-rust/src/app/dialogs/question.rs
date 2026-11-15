//! A viewer's question (`editor::question`) as the product's dialog
//! (`HtmlFolderAccessDialog`'s shape): a 420px `DesktopDialog` with the
//! title, the description, and the two answers. The default answer holds
//! the focus, and closing or dismissing the dialog gives it.
use super::{DialogKey, DialogLayer};
use crate::editor::question::Question;
use crate::theme;
use crate::ui::{
    appearance::ActiveAppearance,
    components::{Button, ButtonVariant, Dialog},
};
use gpui::{prelude::*, *};
use std::{cell::RefCell, rc::Rc};

/// Gives the answer (once) and closes the dialog.
type Respond = Rc<dyn Fn(bool, &mut App)>;

/// Questions ask over the window that put them, on its dialog layer.
pub(in crate::app) fn install() {
    crate::editor::question::set_asker(ask);
}

fn ask(question: Question, cx: &mut App) {
    let Some(dialogs) = super::super::windows::shell_of(question.window, cx)
        .map(|shell| shell.read(cx).dialogs.clone())
    else {
        (question.answer)(false, cx);
        return;
    };
    let Question {
        window,
        title,
        detail,
        decline,
        accept,
        answer,
    } = question;
    let answer = Rc::new(RefCell::new(Some(answer)));
    let respond: Respond = {
        let dialogs = dialogs.downgrade();
        Rc::new(move |accepted, cx| {
            let pending = answer.borrow_mut().take();
            if let Some(answer) = pending {
                answer(accepted, cx);
            }
            let _ = dialogs.update(cx, |d, cx| d.close(DialogKey::Question, cx));
        })
    };
    let focus = cx.focus_handle();
    let (on_close, on_decline, on_accept, dismiss) =
        (respond.clone(), respond.clone(), respond.clone(), respond);
    let decline_focus = focus.clone();
    dialogs.update(cx, |d: &mut DialogLayer, cx| {
        d.open_owned(
            DialogKey::Question,
            move |_, _, cx| {
                let t = cx.palette();
                let (on_close, on_decline, on_accept) =
                    (on_close.clone(), on_decline.clone(), on_accept.clone());
                Dialog::new("viewer-question")
                    .width(420.)
                    .title(title.clone())
                    .on_close(move |_, cx| on_close(false, cx))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.body))
                            .line_height(relative(1.5))
                            .text_color(t.muted)
                            .child(detail.clone()),
                    )
                    .footer(
                        Button::new("viewer-question-decline")
                            .variant(ButtonVariant::Secondary)
                            .label(decline.clone())
                            .track_focus(&decline_focus)
                            .debug_selector(|| "viewer-question-decline".into())
                            .on_click(move |_, _, cx| on_decline(false, cx)),
                    )
                    .footer(
                        Button::new("viewer-question-accept")
                            .variant(ButtonVariant::Solid)
                            .label(accept.clone())
                            .debug_selector(|| "viewer-question-accept".into())
                            .on_click(move |_, _, cx| on_accept(true, cx)),
                    )
                    .into_any_element()
            },
            move |_, cx| dismiss(false, cx),
            cx,
        )
    });
    // "Don't allow" holds the focus: a page is not one Enter away.
    let _ = cx.update_window(window, |_, window, cx| window.focus(&focus, cx));
}
