//! `OnboardingProjectToolbar` and `OnboardingProjectLayoutSwitch`: sort and
//! layout at the end of Projects Home's toolbar; and the second half of
//! `New project`, the menu of Local Agents that can start one.
use super::{super::components::HomepageAgentBrandMark, *};
use crate::localization::bidi_isolate;

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

    /// `New project`'s menu: each Local Agent that can start a project, said
    /// as what choosing it does, then where Agents are set up.
    pub(in crate::app::home) fn new_project_menu(
        &self,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> PopoverMenu {
        let open = self.menu == Some(HomeMenu::NewProject) && !busy;
        let host = self.weak.clone();
        let agents = self.visible_local_agents(cx);
        let more = tr("onboarding.action.moreEntries");
        let trigger = Button::new("home-new-project-agents")
            .debug_selector(|| "home-new-project-agents".into())
            .variant(ButtonVariant::PatternDeep)
            .icon(Icon::new("chevron-down").small().stroke(2.))
            .accessibility_label(more)
            .tooltip(more)
            .disabled(busy)
            .w(px(24.))
            .px(px(0.))
            .rounded_l(px(0.));
        let opened = host.clone();
        PopoverMenu::new("home-new-project-menu")
            .anchor(Anchor::TopLeft)
            .offset(px(metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened_now, _, cx| {
                let _ = opened.update(cx, |s, cx| {
                    let is = s.menu == Some(HomeMenu::NewProject);
                    if *opened_now != is {
                        s.menu = opened_now.then_some(HomeMenu::NewProject);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu(move |surface, _, cx| {
                let t = cx.palette();
                let starts: Vec<MenuItem> = if agents.is_empty() {
                    vec![
                        MenuItem::new(tr("settings.localAgents.empty"))
                            .fact(true)
                            .color(t.subtle),
                    ]
                } else {
                    agents
                        .into_iter()
                        .map(|agent| {
                            let label = tf(
                                "onboarding.agents.start",
                                &[("agent", bidi_isolate(&agent.label).into())],
                            );
                            let mark = HomepageAgentBrandMark::new(
                                Some(&agent.icon_key),
                                agent.label.clone(),
                            )
                            .size(16.);
                            let host = host.clone();
                            MenuItem::new(label)
                                .icon_element(mark)
                                .on_click(move |w, cx| {
                                    let agent = agent.clone();
                                    let _ =
                                        host.update(cx, |s, cx| s.begin_agent_start(agent, w, cx));
                                })
                        })
                        .collect()
                };
                let settings = host.clone();
                surface.min_w(px(240.)).items(starts).separator().item(
                    MenuItem::new(tr("settings.localAgents.title"))
                        .icon("settings")
                        .on_click(move |_, cx| {
                            let _ = settings.update(cx, |_, cx| {
                                cx.emit(HomeEvent::OpenSettings(
                                    crate::features::settings::Page::LocalAgents,
                                ))
                            });
                        }),
                )
            })
    }

    /// `OnboardingProjectToolbar` + the layout switch: Sort and Layout,
    /// aligned to the end of Projects Home's toolbar.
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
            .debug_selector(|| "home-view-controls".into())
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
