//! `OnboardingProjectToolbar`, `OnboardingProjectLayoutSwitch` and
//! `OnboardingEntryMenu`: sort, layout and New project.
use super::*;

impl Homepage {
    // ------------------------------------------------------------- toolbar
    /// `OnboardingToolbarMenu`: a quiet control that opens its own menu,
    /// centred under it; its tooltip says what it is set to.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn view_menu(
        &self,
        menu: HomeMenu,
        icon: Icon,
        trigger_label: String,
        active: bool,
        disabled: bool,
        build: impl FnOnce(Menu) -> Menu + 'static,
        cx: &App,
    ) -> PopoverMenu {
        let open = self.menu == Some(menu) && !disabled;
        let host = self.weak.clone();
        let t = cx.palette();
        let trigger = IconButton::new(("home-view-menu", menu as usize), icon)
            .label(trigger_label)
            .selected(open)
            .when(active, |b| b.color(t.text))
            .disabled(disabled);
        PopoverMenu::new(("home-view-menu-popover", menu as usize))
            .anchor(Anchor::TopCenter)
            .offset(px(metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let is = s.menu == Some(menu);
                    if *opened != is {
                        s.menu = opened.then_some(menu);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu(move |surface, _, _| build(surface.min_w(px(VIEW_MENU_MIN_WIDTH))))
    }
    /// `OnboardingProjectToolbar` + the layout switch: Sort and Layout,
    /// aligned to the end. Nothing narrows the projects: the groups already
    /// say who can open each one and the marks where it lives.
    pub(in crate::app::home) fn project_toolbar(
        &self,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let prefs = &self.preferences.read(cx).state;
        let (sort, layout) = (prefs.homepage_project_sort, prefs.homepage_project_layout);
        let sort_label = tr("onboarding.projects.sort.label");
        let sort_name = |s: HomepageSort| {
            tr(match s {
                HomepageSort::Modified => "onboarding.projects.sort.modified",
                HomepageSort::Name => "onboarding.projects.sort.name",
            })
        };
        let sort_menu = {
            let prefs = self.preferences.clone();
            self.view_menu(
                HomeMenu::Sort,
                Icon::new("arrow-up-down").small(),
                format!("{sort_label}: {}", sort_name(sort)),
                false,
                disabled,
                move |menu| {
                    menu.items([HomepageSort::Modified, HomepageSort::Name].map(|option| {
                        let prefs = prefs.clone();
                        checked_item(MenuItem::new(sort_name(option)), sort == option).on_click(
                            move |_, cx| {
                                prefs.update(cx, |p, cx| {
                                    p.change(|p| p.homepage_project_sort = option, cx)
                                })
                            },
                        )
                    }))
                },
                cx,
            )
        };
        let layout_label = tr("onboarding.projects.layout.label");
        let layout_name = |l: HomepageLayout| {
            tr(match l {
                HomepageLayout::List => "onboarding.projects.layout.list",
                HomepageLayout::Grid => "onboarding.projects.layout.grid",
            })
        };
        let layout_icon = |l: HomepageLayout| {
            Icon::new(match l {
                HomepageLayout::List => "list",
                HomepageLayout::Grid => "layout-grid",
            })
            .with_size(px(15.))
        };
        let layout_menu = {
            let prefs = self.preferences.clone();
            self.view_menu(
                HomeMenu::Layout,
                layout_icon(layout),
                format!("{layout_label}: {}", layout_name(layout)),
                false,
                disabled,
                move |menu| {
                    menu.items([HomepageLayout::List, HomepageLayout::Grid].map(|option| {
                        let prefs = prefs.clone();
                        checked_item(
                            MenuItem::new(layout_name(option)).icon_sized(layout_icon(option)),
                            layout == option,
                        )
                        .on_click(move |_, cx| {
                            prefs.update(cx, |p, cx| {
                                p.change(|p| p.homepage_project_layout = option, cx)
                            })
                        })
                    }))
                },
                cx,
            )
        };
        // `.onboarding-project-toolbar` > `.onboarding-project-view`.
        div()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .justify_end()
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(4.))
                    .child(sort_menu)
                    .child(layout_menu),
            )
    }
    /// `OnboardingEntryMenu`: New project, one click away, and the arrow
    /// holding Open a folder and Import. `narrow` hides New's words.
    pub(in crate::app::home) fn entry_menu(
        &self,
        busy: bool,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        let t = cx.palette();
        let open = self.menu == Some(HomeMenu::Entry) && !busy;
        let host = self.weak.clone();
        let more = tr("onboarding.action.moreEntries");
        let trigger = Button::new("home-entry-more")
            .variant(ButtonVariant::PatternPrimary)
            .icon(Icon::new("chevron-down").small().stroke(1.85))
            .accessibility_label(more)
            .tooltip(more)
            .disabled(busy)
            .w(px(theme::control()))
            .px_0()
            .rounded_l(px(0.))
            .rounded_r(px(metric::CONTROL_RADIUS));
        let menu = PopoverMenu::new("home-entry-menu")
            .anchor(Anchor::TopRight)
            .offset(px(metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let is = s.menu == Some(HomeMenu::Entry);
                    if *opened != is {
                        s.menu = opened.then_some(HomeMenu::Entry);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu({
                let host = self.weak.clone();
                move |surface, _, _| {
                    let open_folder = {
                        let host = host.clone();
                        MenuItem::new(tr("onboarding.action.openFolder"))
                            .icon_sized(Icon::product(ProductIcon::Folder).small().stroke(1.85))
                            .on_click(move |_, cx| {
                                let _ = host.update(cx, |s, cx| s.command(Command::OpenFolder, cx));
                            })
                    };
                    let import = {
                        let host = host.clone();
                        MenuItem::new(tr("onboarding.action.importFromApps"))
                            .icon_sized(Icon::new("download").small().stroke(1.85))
                            .trailing(super::project_entry::import_badges(t, t.menu_bg, false))
                            .on_click(move |w, cx| {
                                let _ = host.update(cx, |s, cx| s.begin_import(w, cx));
                            })
                    };
                    surface
                        .w(px(ENTRY_MENU_WIDTH))
                        .item(open_folder)
                        .item(import)
                }
            });
        // `.onboarding-entry-menu-root`: New and the arrow, 1px apart.
        div()
            .flex()
            .flex_none()
            .gap(px(1.))
            .ml_auto()
            .child(
                self.create_action_compact(narrow, busy, cx)
                    .rounded_r(px(0.)),
            )
            .child(menu)
    }
}
