//! `WindowNavigation.tsx` and `WindowNavigationRows.tsx`: two levels, places
//! and the folders in them, and this menu is the places. Home (where the
//! window is not on it), then this computer and every space the account
//! reaches with a way to start another, then the account. A place opens on
//! the Homepage scrolled to its folders: Home is the map, folders move
//! between places there, and a place is never a mode the window switches
//! into. The place menu of a project and the Homepage's brand both open it.
use crate::features::settings::PreferencesStore;
use crate::localization::t as tr;
use crate::ui::appearance::ActiveAppearance as _;
use crate::ui::components::{Icon, Menu, MenuItem, ProductIcon};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use std::rc::Rc;

/// `LOCAL_PLACE`: this computer's key among the places; a space's is its id.
pub(in crate::app) const LOCAL_PLACE: &str = "local";

/// What a navigation row asks of the window.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::app) enum Navigate {
    Home,
    /// The Homepage, with one place's folders in view.
    ShowPlace(String),
    CreateSpace,
    OpenAccount,
    OpenSettings,
    SignIn,
}

/// `WindowAccountMenu`: whether the account rows show, and who is in.
fn account(cx: &App) -> Option<bool> {
    use crate::cloud::auth::Status;
    let available = crate::features::flags::account_available(cx)
        && crate::features::cloud::account::status(cx) != Some(Status::Restoring);
    available.then(|| crate::features::cloud::account::has_account(cx))
}

/// `navigation.account`: the account rows show (the Homepage's brand then
/// opens the menu even before anything is listed).
pub(super) fn account_rows(cx: &App) -> bool {
    account(cx).is_some()
}

/// `windowNavigation.trailing`: Sign in at the Header's end, only while the
/// account is available and no one is signed in.
pub(super) fn signs_in(cx: &App) -> bool {
    account(cx) == Some(false)
}

/// `WindowNavigationRows` into `menu`: `current` is the place the window
/// shows, checked among the others; `home` adds the way back.
pub(super) fn rows(
    menu: Menu,
    current: Option<&str>,
    home: bool,
    preferences: &Entity<PreferencesStore>,
    go: impl Fn(Navigate, &mut Window, &mut App) + 'static,
    cx: &App,
) -> Menu {
    let go = Rc::new(go);
    let action = |navigate: Navigate| {
        let go = go.clone();
        move |window: &mut Window, cx: &mut App| go(navigate.clone(), window, cx)
    };
    let cloud = crate::features::flags::cloud_enabled(preferences, cx);
    let spaces: Vec<_> = if cloud {
        crate::features::cloud::global_spaces_read(cx)
            .map(|s| s.spaces().to_vec())
            .unwrap_or_default()
    } else {
        vec![]
    };
    let signed_in = account(cx);
    let t = cx.palette();
    let place = |key: &str, label: String, icon: AnyElement| {
        let checked = current == Some(key);
        let mut item = MenuItem::new(label)
            .icon_element(icon)
            .on_click(action(Navigate::ShowPlace(key.to_owned())));
        if checked {
            item = item
                .selected(true)
                .trailing(Icon::new("check").small().stroke(2.).color(t.muted));
        }
        item
    };
    let mut sections: Vec<Vec<MenuItem>> = vec![];
    if home {
        sections.push(vec![
            MenuItem::new(tr("shell.workspaceSwitcher.home"))
                .icon_sized(Icon::new("arrow-left").with_size(px(15.)).stroke(2.))
                .on_click(action(Navigate::Home)),
        ]);
    }
    let mut places = vec![place(
        LOCAL_PLACE,
        tr(if cfg!(target_os = "macos") {
            "shell.workspaceSwitcher.location.thisMac"
        } else {
            "shell.workspaceSwitcher.location.thisComputer"
        })
        .to_owned(),
        Icon::product(ProductIcon::Local)
            .with_size(px(15.))
            .stroke(1.75)
            .into_any_element(),
    )];
    for space in &spaces {
        places.push(place(
            &space.id,
            crate::features::cloud::space_name(space),
            crate::features::cloud::space_mark(space).into_any_element(),
        ));
    }
    // A space belongs to the account that starts it.
    if cloud && signed_in == Some(true) {
        places.push(
            MenuItem::new(tr("settings.space.create"))
                .icon_sized(Icon::new("plus").with_size(px(15.)).stroke(2.))
                .on_click(action(Navigate::CreateSpace)),
        );
    }
    sections.push(places);
    match signed_in {
        Some(true) => sections.push(vec![
            MenuItem::new(tr("settings.sidebar.account"))
                .icon_sized(Icon::new("user-round").with_size(px(15.)))
                .on_click(action(Navigate::OpenAccount)),
            MenuItem::new(tr("shell.navigation.settings"))
                .icon_sized(Icon::new("settings").with_size(px(15.)))
                .on_click(action(Navigate::OpenSettings)),
        ]),
        Some(false) => sections.push(vec![
            MenuItem::new(tr("cloud.auth.signIn"))
                .icon_sized(Icon::new("log-in").with_size(px(15.)))
                .on_click(action(Navigate::SignIn)),
        ]),
        None => {}
    }
    let mut menu = menu;
    for (index, section) in sections.into_iter().enumerate() {
        if index > 0 {
            menu = menu.separator();
        }
        menu = menu.items(section);
    }
    menu
}
