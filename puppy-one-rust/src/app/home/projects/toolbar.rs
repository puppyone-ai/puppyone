//! `OnboardingProjectsHead`, `OnboardingProjectToolbar` and
//! `OnboardingProjectLayoutSwitch`: the section heading and sort/layout
//! controls at the trailing end of `.onboarding-projects-head`.
use super::*;

/// `.onboarding-projects-head`: `Projects` on the left, sort and layout on the right.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingProjectsHead {
    toolbar: AnyElement,
}

impl OnboardingProjectsHead {
    pub fn new(toolbar: impl IntoElement) -> Self {
        Self {
            toolbar: toolbar.into_any_element(),
        }
    }
}

impl RenderOnce for OnboardingProjectsHead {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        h_flex()
            .debug_selector(|| "home-projects-head".into())
            .flex_none()
            .w_full()
            .min_w_0()
            .items_center()
            .justify_between()
            .gap(px(8.))
            .child(
                div()
                    .text_size(px(theme::ty().ui.meta))
                    .font_weight(FontWeight::MEDIUM)
                    .line_height(px(20.))
                    .text_color(t.text)
                    .child(tr("onboarding.projects.title")),
            )
            .child(self.toolbar)
    }
}

impl Homepage {
    /// `OnboardingToolbarMenu`: a quiet control that opens its own menu,
    /// aligned to its trailing edge so it stays inside narrow windows; its
    /// tooltip says what it is set to.
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
            .anchor(Anchor::TopRight)
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
    /// aligned to the end of `.onboarding-projects-head`.
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
        div()
            .flex()
            .flex_none()
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
}
