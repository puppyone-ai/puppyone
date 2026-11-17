//! The signed-in account at the Homepage Header's end: the person as a circle
//! with their initial (a Space is a rounded square, a person a circle), which
//! opens who is signed in, Account, Settings and Sign out. Signed out, the
//! same place offers Sign in.
use super::*;
use crate::{
    localization::t as tr,
    ui::{
        appearance::ActiveAppearance as _,
        components::{Menu, MenuItem, MenuVariant},
    },
    workspace::cloud::spaces::{mark_initial, mark_tone},
};
use gpui_kit::base::Selectable as _;

const AVATAR: f32 = 22.;
const MENU_WIDTH: f32 = 220.;

/// The person's circle: one tone per email, its first letter.
fn avatar(email: &str, dark: bool) -> Div {
    let ui = theme::ty().ui;
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(AVATAR))
        .rounded_full()
        .bg(theme::space_mark(mark_tone(email) as usize, dark))
        .text_color(theme::space_mark_letter())
        .text_size(px(ui.caption))
        .line_height(px(ui.caption))
        .font_weight(FontWeight::SEMIBOLD)
        .child(mark_initial(email))
}

/// Who is signed in, when someone is.
pub(super) fn email(cx: &App) -> Option<String> {
    crate::features::cloud::account::snapshot(cx)?
        .account
        .map(|account| account.email)
}

impl WindowChrome {
    /// The account's circle, opening its menu.
    pub(super) fn account(&self, email: &str, cx: &mut Context<Self>) -> AnyElement {
        let open = self.popover == Some(Popover::Account);
        let trigger = Button::new("header-account")
            .debug_selector(|| "header-account".into())
            .variant(ButtonVariant::Titlebar)
            .leading(avatar(email, cx.palette().dark))
            .accessibility_label(tr("settings.sidebar.account"))
            .tooltip(email.to_owned())
            .selected(open)
            .w(px(theme::metric::TITLEBAR_TOOL_ACTION_WIDTH))
            .px(px(0.));
        div()
            .ml(px(4.))
            .child(self.header_popover(Popover::Account, trigger, cx))
            .into_any_element()
    }

    /// The account menu's rows: the email as a fact, then where the account
    /// is managed, then Sign out.
    pub(super) fn account_menu(&self, cx: &App) -> impl FnOnce(Menu) -> Menu + 'static {
        let host = self.weak.clone();
        let email = email(cx).unwrap_or_default();
        let muted = cx.palette().muted;
        let go = move |navigate: navigation::Navigate| {
            let host = host.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.show_popover(None, cx);
                    cx.emit(ChromeEvent::Navigate(navigate.clone()));
                });
            }
        };
        move |menu| {
            menu.variant(MenuVariant::Project)
                .min_w(px(MENU_WIDTH))
                .max_w(px(320.))
                .item(MenuItem::new(email).fact(true).color(muted))
                .separator()
                .items([
                    MenuItem::new(tr("settings.sidebar.account"))
                        .on_click(go(navigation::Navigate::OpenAccount)),
                    MenuItem::new(tr("shell.navigation.settings"))
                        .on_click(go(navigation::Navigate::OpenSettings)),
                ])
                .separator()
                .item(
                    MenuItem::new(tr("settings.account.signOut"))
                        .on_click(|_, cx| crate::features::cloud::account::sign_out(cx)),
                )
        }
    }
}
