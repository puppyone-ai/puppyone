//! Header popovers: the space's menu (`Popover::Place`: the projects in
//! this space, a new one, and Home where the other spaces are — never a list
//! of spaces), the project's menu (`Popover::Project`: its computer, Agents
//! and history or a folder's settings, then Account and Settings or Sign in),
//! and the Homepage brand's navigation. They hang 2px below their trigger,
//! start aligned, on the `.desktop-project-menu` surface. GPUI Kit places,
//! clamps and dismisses them; the shell holds which one is open so commands
//! and keys can open it too.
use super::*;
use crate::{
    localization::{t as tr, tf},
    theme::Theme,
    ui::appearance::ActiveAppearance,
    ui::components::{
        Button, ButtonVariant, Icon, IconButton, Menu, MenuItem, MenuVariant, PopoverMenu,
    },
};
use gpui_kit::{base::h_flex, component::Sizable as _};

/// `preferredWidth={240}` of the project menu.
const PROJECT_MENU_WIDTH: f32 = 240.;
/// The project button narrowed as far as it goes: its folder and a few
/// letters of the name.
pub(in crate::app) const PROJECT_MIN_WIDTH: f32 = 56.;
/// `DesktopTitlebarMenuLayer`'s gap below the trigger.
const MENU_GAP: f32 = 2.;
/// `.desktop-project-list` row gap.
const PROJECT_LIST_GAP: f32 = 2.;
/// `max-height: min(520px, calc(100vh - 58px))` on the surface.
const MENU_MAX_HEIGHT: f32 = 520.;
const MENU_VIEWPORT_INSET: f32 = 58.;
/// The Homepage brand's navigation is 260 wide, at most 560 tall.
const BRAND_MENU_WIDTH: f32 = 260.;
const PLACE_MENU_MAX_HEIGHT: f32 = 560.;
/// `.desktop-project-switcher-copy`: a 22px button in the row's end slot.
const COPY_BUTTON: f32 = 22.;
/// How long a copied path says so.
const COPIED_FOR: std::time::Duration = std::time::Duration::from_millis(1600);

impl WindowChrome {
    /// `DesktopTitlebarContext`: two levels, read like a path: the place,
    /// then the folder. With the project rail on, the rail names the
    /// project and the Header keeps the place alone. While a project is on
    /// its way in there is no place yet.
    ///
    /// In `compact` mode (headerless panes), the place stays icon-only (when
    /// paired with a project) and the project drops its folder glyph so the
    /// sidebar top row stays quiet and legible even when narrowed.
    pub(super) fn project_context(&self, project_hidden: bool, compact: bool, cx: &App) -> Div {
        let label = tf(
            "shell.workspaceSwitcher.openMenu",
            &[("workspace", self.session.name.clone().into())],
        );
        let opening = self.opening_project_name(cx);
        let name = match &opening {
            Some(name) => name.clone(),
            None if self.session.name.is_empty() => tr("onboarding.action.openFolder").to_owned(),
            None => self.session.name.clone(),
        };
        let ty = theme::ty().header;
        let t = cx.palette();
        // `.desktop-titlebar-workspace-button`.
        let mut project = Button::new("project")
            .debug_selector(|| "header-project".into())
            .variant(ButtonVariant::Ghost)
            .accessibility_label(label)
            .track_focus(&self.project_focus)
            .label(name)
            .flex_shrink(1.)
            .min_w_0()
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .label_offset_y(px(HEADER_TEXT_OPTICAL_Y));
        if !compact {
            project = project.icon(
                Icon::product(crate::ui::components::ProductIcon::Folder)
                    .stroke(1.65)
                    .large(),
            );
        }
        let items = self.owners.home.read(cx).project_items(cx);
        let cloud = self.owners.cloud.read(cx);
        let place = cloud.place_menu(&items, cx).filter(|_| opening.is_none());
        let compact_place = compact && !project_hidden;
        h_flex()
            .min_w_0()
            .when_some(place, |d, menu| {
                let place = cloud.place_button(&menu, compact_place, cx);
                let popover = if compact_place {
                    self.header_popover(Popover::Place, place, cx).flex_none()
                } else {
                    // Narrowed, the place gives way first, down to its mark.
                    self.header_popover(Popover::Place, place.flex_shrink(1.).min_w_0(), cx)
                        .flex_shrink(1000.)
                        .min_w(px(theme::control()))
                };
                d.child(popover).when(!project_hidden, |d| {
                    if compact {
                        d.child(header::action_divider(cx))
                    } else {
                        // `.desktop-titlebar-context-separator`.
                        d.child(
                            div()
                                .flex_none()
                                .text_size(px(ty.content))
                                .line_height(px(ty.line_height))
                                .text_color(t.text_disabled)
                                .when(HEADER_TEXT_OPTICAL_Y != 0., |d| {
                                    d.relative().top(px(HEADER_TEXT_OPTICAL_Y))
                                })
                                .child("/"),
                        )
                    }
                })
            })
            .when(!project_hidden, |d| {
                // Narrowed, the project keeps at least its first letters.
                d.child(
                    self.header_popover(Popover::Project, project, cx)
                        .flex_shrink(1.)
                        .min_w(px(PROJECT_MIN_WIDTH)),
                )
                .children(
                    cloud
                        .publish_header_mark(cx)
                        .map(|mark| div().ml(px(2.)).flex_none().child(mark)),
                )
            })
    }
    /// The Homepage's Header names the product; with places or an account
    /// to reach, the name opens them (`OnboardingBrandLockup`).
    pub(super) fn brand(&self, cx: &mut Context<Self>) -> AnyElement {
        let ty = theme::ty().header;
        let label = format!(
            "{}, {}",
            tr("shell.brand.name"),
            tr("shell.placeMenu.label")
        );
        let button = Button::new("homepage-brand")
            .debug_selector(|| "homepage-brand".into())
            .variant(ButtonVariant::Titlebar)
            .accessibility_label(label)
            .label(tr("shell.brand.name"))
            .px(px(6.))
            .text_size(px(ty.content))
            .line_height(px(ty.line_height))
            .label_offset_y(px(HEADER_TEXT_OPTICAL_Y));
        self.header_popover(Popover::Brand, button, cx)
            .into_any_element()
    }
    /// `trigger` and the header popover it opens.
    pub(super) fn header_popover(
        &self,
        popover: Popover,
        trigger: Button,
        cx: &App,
    ) -> PopoverMenu {
        let open = self.popover == Some(popover);
        let id = match popover {
            Popover::Project => "project-menu",
            Popover::Place => "place-menu",
            Popover::Brand => "brand-menu",
            Popover::Account => "account-menu",
        };
        let host = self.weak.clone();
        let anchor = match popover {
            // The account sits at the Header's end: its menu hangs inward.
            Popover::Account => Anchor::TopRight,
            _ => Anchor::TopLeft,
        };
        let mut menu = PopoverMenu::new(id)
            .anchor(anchor)
            .offset(px(MENU_GAP))
            .open(open)
            .on_open_change(move |opened, window, cx| {
                let _ = host.update(cx, |s, cx| {
                    let open = s.popover == Some(popover);
                    if *opened != open {
                        if *opened && popover == Popover::Project {
                            s.project_focus.focus(window, cx);
                        }
                        s.show_popover(opened.then_some(popover), cx);
                    }
                });
            })
            .trigger(trigger)
            .flex();
        if open {
            match popover {
                // The project's own menu: this project's information first,
                // then a horizontal row of the Agents in it, then its tools
                // (computer, history / folder info & path), then the person.
                Popover::Project => {
                    let fill = self.project_actions_menu(cx);
                    menu = menu.menu(move |surface, _, _| {
                        fill(
                            surface
                                .variant(MenuVariant::Project)
                                .min_w(px(256.))
                                .max_w(px(320.)),
                        )
                    });
                }
                // The space's menu: the projects in this space (and the way
                // Home, where the other spaces are), never the list of spaces.
                Popover::Place => {
                    let fill = self.project_menu(cx);
                    menu = menu.menu(move |surface, window, _| {
                        let max_height = (window.viewport_size().height - px(MENU_VIEWPORT_INSET))
                            .min(px(MENU_MAX_HEIGHT));
                        fill(
                            surface
                                .variant(MenuVariant::Project)
                                .w(px(PROJECT_MENU_WIDTH))
                                .max_h(max_height),
                        )
                    });
                }
                Popover::Account => {
                    let fill = self.account_menu(cx);
                    menu = menu.menu(move |surface, _, _| fill(surface));
                }
                Popover::Brand => {
                    let host = self.weak.clone();
                    let preferences = self.owners.preferences.clone();
                    menu = menu.menu(move |surface, _, cx| {
                        let host = host.clone();
                        super::navigation::rows(
                            surface
                                .variant(MenuVariant::Project)
                                .min_w(px(BRAND_MENU_WIDTH))
                                .max_w(px(320.))
                                .max_h(px(PLACE_MENU_MAX_HEIGHT)),
                            None,
                            false,
                            &preferences,
                            move |navigate, _, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    s.show_popover(None, cx);
                                    cx.emit(ChromeEvent::Navigate(navigate));
                                });
                            },
                            cx,
                        )
                    });
                }
            }
        }
        menu
    }
    /// `ProjectMenu`: this project's information first, then the Agents in it
    /// (as a horizontal row), then the project's tools (Computer, History, or
    /// a local folder's settings & path), and finally the person (Account and
    /// Settings, or Sign in).
    ///
    /// Home leads only while there is no space button to hold it.
    fn project_actions_menu(&self, cx: &App) -> impl FnOnce(Menu) -> Menu + 'static {
        use super::navigation::Navigate;
        use crate::app::project_place::{Place, place_name};
        let host = self.weak.clone();
        let t = cx.palette();
        let ty = theme::ty().ui;
        let opening = self.opening_project_name(cx).is_some();
        let items = self.owners.home.read(cx).project_items(cx);
        let cloud_entity = self.owners.cloud.clone();
        let cloud = cloud_entity.read(cx);
        let place_menu = (!opening).then(|| cloud.place_menu(&items, cx)).flatten();
        let has_place = place_menu.is_some();
        let hosted = self.session.hosted.is_some() || cloud.capture_hosted();
        let command = |command: Command| {
            let host = host.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.show_popover(None, cx);
                    s.command(command, cx);
                });
            }
        };
        let navigate = |navigate: Navigate| {
            let host = host.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| {
                    s.show_popover(None, cx);
                    cx.emit(ChromeEvent::Navigate(navigate.clone()));
                });
            }
        };
        type CloudAction = fn(&mut WindowCloud, &mut Window, &mut Context<WindowCloud>);
        let on_cloud = |action: CloudAction| {
            let host = host.clone();
            let cloud = cloud_entity.clone();
            move |window: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.show_popover(None, cx));
                cloud.update(cx, |c, cx| action(c, window, cx));
            }
        };
        let note = |text: SharedString, dot: Option<Rgba>| {
            h_flex()
                .max_w(px(150.))
                .min_w_0()
                .items_center()
                .gap(px(6.))
                .text_size(px(ty.caption))
                .text_color(t.subtle)
                .children(dot.map(|dot| div().size(px(6.)).flex_none().rounded_full().bg(dot)))
                .child(div().min_w_0().truncate().child(text))
        };

        // 1. This project's identity and where it lives.
        let project_name = self
            .opening_project_name(cx)
            .unwrap_or_else(|| self.session.name.clone());
        let project_info: Option<AnyElement> = (!project_name.is_empty()).then(|| {
            let (mark, subtitle): (AnyElement, Option<String>) = match &place_menu {
                Some(menu) => match (&menu.space, menu.place) {
                    (Some(space), _) => (
                        crate::features::cloud::space_mark(space).into_any_element(),
                        Some(format!(
                            "{} · {}",
                            crate::features::cloud::space_name(space),
                            tr("cloud.home.location.cloud")
                        )),
                    ),
                    (None, Place::Cloud) => (
                        Icon::product(crate::ui::components::ProductIcon::Cloud)
                            .with_size(px(16.))
                            .stroke(1.75)
                            .color(t.brand_blue)
                            .into_any_element(),
                        Some(place_name(menu).0),
                    ),
                    (None, Place::Computer) => (
                        Icon::product(crate::ui::components::ProductIcon::Local)
                            .with_size(px(16.))
                            .stroke(1.75)
                            .color(t.muted)
                            .into_any_element(),
                        Some(match &menu.detail {
                            Some(detail) => format!("{} · {detail}", place_name(menu).0),
                            None => place_name(menu).0,
                        }),
                    ),
                    (None, Place::Local) => (
                        Icon::product(crate::ui::components::ProductIcon::Folder)
                            .with_size(px(16.))
                            .stroke(1.75)
                            .color(t.muted)
                            .into_any_element(),
                        menu.address
                            .as_ref()
                            .map(|a| a.short.clone())
                            .or_else(|| Some(place_name(menu).0)),
                    ),
                },
                None => (
                    Icon::product(if hosted {
                        crate::ui::components::ProductIcon::Cloud
                    } else {
                        crate::ui::components::ProductIcon::Folder
                    })
                    .with_size(px(16.))
                    .stroke(1.75)
                    .color(if hosted { t.brand_blue } else { t.muted })
                    .into_any_element(),
                    self.session
                        .root
                        .as_deref()
                        .and_then(crate::app::project_place::local_address)
                        .map(|a| a.short),
                ),
            };
            h_flex()
                .id("project-menu-info")
                .debug_selector(|| "project-menu-info".into())
                .items_start()
                .gap(px(9.))
                .px(px(8.))
                .py(px(7.))
                .child(
                    div()
                        .size(px(18.))
                        .mt(px(1.))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(mark),
                )
                .child(
                    gpui_kit::base::v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap(px(2.))
                        .child(
                            div()
                                .truncate()
                                .text_size(px(ty.meta))
                                .line_height(px(18.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(t.text)
                                .child(project_name),
                        )
                        .children(subtitle.map(|sub| {
                            div()
                                .truncate()
                                .text_size(px(ty.micro))
                                .line_height(px(15.))
                                .text_color(t.subtle)
                                .child(sub)
                        })),
                )
                .into_any_element()
        });

        // 2. Agents in this project (horizontal strip for hosted Cloud projects).
        let agents_section: Option<AnyElement> = (hosted && !opening)
            .then(|| {
                cloud.project_menu_agents_section(
                    on_cloud(WindowCloud::press_agents_entry),
                    on_cloud(WindowCloud::press_agents_invite),
                    cx,
                )
            })
            .flatten();

        // 3. The project's other tools & actions.
        let mut lead = vec![];
        if !has_place {
            lead.push(
                MenuItem::new(tr("shell.workspaceSwitcher.home"))
                    .icon_sized(Icon::new("arrow-left").with_size(px(15.)).stroke(2.))
                    .on_click(command(Command::Home)),
            );
        }
        let mut project = vec![];
        let screen = cloud.screen.read(cx);
        if screen.entry_available(cx) {
            use crate::features::cloud::ScreenState;
            let dot = match screen.state(cx) {
                ScreenState::Running => Some(t.success),
                ScreenState::Provisioning => Some(t.warning),
                _ => None,
            };
            project.push(
                MenuItem::new(tr("native.computer.title"))
                    .icon_sized(Icon::new("monitor").with_size(px(15.)).stroke(1.75))
                    .selected(screen.is_shown(cx))
                    .trailing(note(screen.status_line(cx), dot))
                    .on_click(on_cloud(WindowCloud::toggle_computer)),
            );
        }
        if hosted && !opening {
            if crate::features::cloud::account::has_account(cx) {
                project.push(
                    MenuItem::new(tr("source-control.history.title"))
                        .icon_sized(Icon::new("history").with_size(px(15.)).stroke(1.75))
                        .on_click(command(Command::CloudHistory)),
                );
            }
        } else if let (Some(root), None, false) =
            (self.session.root.clone(), &self.session.device, opening)
        {
            project.push(
                MenuItem::new(tr("settings.sidebar.projectInfo"))
                    .icon_sized(Icon::new("folder-cog").with_size(px(15.)).stroke(1.75))
                    .on_click(navigate(Navigate::ProjectSettings)),
            );
            let path = root.to_string_lossy().into_owned();
            let copy_host = host.clone();
            project.push(
                MenuItem::new(tr("shell.workspaceSwitcher.copyPath"))
                    .icon_sized(Icon::new("copy").with_size(px(15.)).stroke(1.75))
                    .on_click(move |_, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(path.clone()));
                        let _ = copy_host.update(cx, |s, cx| s.show_popover(None, cx));
                    }),
            );
        }

        // 4. The person: Account and Settings, or Settings and Sign in.
        let mut person = vec![];
        if let Some(email) =
            super::account::email(cx).filter(|_| crate::features::cloud::account::has_account(cx))
        {
            use crate::workspace::cloud::spaces::{mark_initial, mark_tone};
            person.push(
                MenuItem::new(tr("settings.sidebar.account"))
                    .icon_element(
                        crate::ui::components::PersonMark::new(
                            mark_tone(&email) as usize,
                            mark_initial(&email),
                        )
                        .side(16.),
                    )
                    .detail_below(email)
                    .on_click(navigate(Navigate::OpenAccount)),
            );
        }
        person.push(
            MenuItem::new(tr("shell.navigation.settings"))
                .icon_sized(Icon::new("settings").with_size(px(15.)).stroke(1.75))
                .on_click(navigate(Navigate::OpenSettings)),
        );
        if super::navigation::signs_in(cx) {
            person.push(
                MenuItem::new(tr("cloud.auth.signIn"))
                    .icon_sized(Icon::new("log-in").with_size(px(15.)).stroke(1.75))
                    .on_click(navigate(Navigate::SignIn)),
            );
        }

        move |mut menu| {
            let mut has_above = false;
            if let Some(info) = project_info {
                menu = menu.child_element(info);
                has_above = true;
            }
            if !lead.is_empty() {
                if has_above {
                    menu = menu.separator();
                }
                menu = menu.items(lead);
                has_above = true;
            }
            if let Some(agents) = agents_section {
                if has_above {
                    menu = menu.separator();
                }
                menu = menu.child_element(agents);
                has_above = true;
            }
            for section in [project, person] {
                if section.is_empty() {
                    continue;
                }
                if has_above {
                    menu = menu.separator();
                }
                has_above = true;
                menu = menu.items(section);
            }
            menu
        }
    }
    /// `DesktopWorkspaceSwitcher` "projects" view over the shared project
    /// list (`projectCatalog.items`): inside a place, only that place's
    /// folders (`projectMenuGroupsInPlace`); another computer's folder, not
    /// in the account's catalog, lists every place under its heading. Home
    /// is offered only where no place menu is.
    fn project_menu(&self, cx: &App) -> impl FnOnce(Menu) -> Menu + 'static {
        let host = self.weak.clone();
        let action = move |command: Command| {
            let host = host.clone();
            move |_: &mut Window, cx: &mut App| {
                let _ = host.update(cx, |s, cx| s.command(command, cx));
            }
        };
        let current = self
            .session
            .root
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned());
        let hosted = self.session.hosted.clone();
        let t = cx.palette();
        let copied = self.copied_path.clone();
        let items = self.owners.home.read(cx).project_items(cx);
        let opening = self.opening_project_name(cx).is_some();
        let place_menu = self
            .owners
            .cloud
            .read(cx)
            .place_menu(&items, cx)
            .filter(|_| !opening);
        let spaces = if crate::features::flags::cloud_enabled(&self.owners.preferences, cx) {
            crate::features::cloud::global_spaces_read(cx)
                .map(|s| s.spaces().to_vec())
                .unwrap_or_default()
        } else {
            vec![]
        };
        let all = groups_by_place(&items, &spaces);
        let place = place_menu.as_ref().and_then(menu_place);
        let groups = match &place {
            Some(place) => in_place(all, place),
            None => all,
        };
        let headings = place.is_none() && needs_headings(&groups);
        let mut index = 0;
        let mut sections = vec![];
        for group in groups {
            let rows = group
                .items
                .into_iter()
                .map(|item| {
                    let selected = (item.local_path.is_some() && item.local_path == current)
                        || (hosted.is_some() && item.cloud_project == hosted);
                    index += 1;
                    self.project_item(index, item, selected, copied.as_ref(), t)
                })
                .collect::<Vec<_>>();
            let heading = headings.then(|| group_label(&group.kind, t));
            sections.push((heading, rows));
        }
        let home = Some(
            MenuItem::new(tr("shell.workspaceSwitcher.home"))
                .icon_sized(Icon::new("arrow-left").with_size(px(15.)).stroke(2.))
                .on_click(action(Command::Home)),
        );
        // `onCreateProject`: the Project entry launcher.
        let create = MenuItem::new(tr("shell.workspaceSwitcher.createNew"))
            .icon_sized(Icon::new("plus").with_size(px(15.)).stroke(2.))
            .on_click(action(Command::CreateNew));
        move |menu| {
            let listed = sections.iter().any(|(_, rows)| !rows.is_empty());
            let had_home = home.is_some();
            let mut menu = match home {
                Some(home) => menu.item(home),
                None => menu,
            };
            if listed {
                if had_home {
                    menu = menu.separator();
                }
                for (heading, rows) in sections {
                    if let Some(heading) = heading {
                        menu = menu.child_element(heading);
                    }
                    menu = menu.list(PROJECT_LIST_GAP, rows);
                }
                menu = menu.separator();
            }
            menu.item(create)
        }
    }
    /// `DesktopProjectMenuItem`: the current project carries a check at the
    /// row end; a folder's end slot copies its path (and says Copied for a
    /// moment). Choosing enters the project in this window, a Cloud project
    /// as much as a folder.
    fn project_item(
        &self,
        index: usize,
        item: crate::workspace::cloud::catalog::Item,
        current: bool,
        copied: Option<&(String, std::time::Instant)>,
        t: Theme,
    ) -> MenuItem {
        let open_host = self.weak.clone();
        let name = super::super::home::item_name_or(&item, tr("onboarding.projects.untitled"));
        let mut row = MenuItem::new(name.clone())
            .icon_element(super::super::home::folder::list_icon(item.location(), t))
            .selected(current)
            .trailing(
                div()
                    .w(px(COPY_BUTTON))
                    .flex()
                    .justify_center()
                    .when(current, |d| d.child(Icon::new("check").small().stroke(2.))),
            );
        if let Some(path) = item.local_path.clone() {
            let copy_host = self.weak.clone();
            let copied = copied.is_some_and(|(p, at)| *p == path && at.elapsed() < COPIED_FOR);
            let copy_label = tr(if copied {
                "common.action.copied"
            } else {
                "shell.workspaceSwitcher.copyPath"
            });
            let copy_path = path.clone();
            row = row.hover_trailing(
                IconButton::new(
                    ("copy-project-path", index),
                    Icon::new(if copied { "check" } else { "copy" })
                        .small()
                        .stroke(2.),
                )
                .label(format!("{copy_label}: {name}"))
                .tooltip(format!("{copy_label}\n{copy_path}"))
                .with_size(px(COPY_BUTTON))
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    cx.write_to_clipboard(ClipboardItem::new_string(copy_path.clone()));
                    let _ = copy_host.update(cx, |s, cx| {
                        s.copied_path = Some((copy_path.clone(), std::time::Instant::now()));
                        cx.notify();
                        // The check gives way after its moment.
                        cx.spawn(async move |this, cx| {
                            cx.background_executor().timer(COPIED_FOR).await;
                            let _ = this.update(cx, |_, cx| cx.notify());
                        })
                        .detach();
                    });
                }),
            );
            if copied {
                row = row.hold_hover(true);
            }
        }
        row.on_click(move |_, cx| {
            let _ = open_host.update(cx, |s, cx| {
                s.show_popover(None, cx);
                if !current {
                    cx.emit(ChromeEvent::OpenItem(Box::new(item.clone())));
                }
            });
        })
    }
}

/// `ProjectMenuGroup`'s kind.
#[derive(Clone, Debug, PartialEq)]
enum GroupKind {
    Local,
    Space(crate::workspace::cloud::spaces::Space),
    Cloud,
}
struct Group {
    kind: GroupKind,
    items: Vec<Item>,
}
/// `ProjectMenuPlace`.
#[derive(Clone, Debug, PartialEq)]
enum MenuPlace {
    Local,
    Space(String),
    Cloud,
}
/// `groupProjectsByPlace`: this computer, then each space as the account
/// orders them, then Cloud projects whose space is not known yet.
fn groups_by_place(
    items: &[Item],
    spaces: &[crate::workspace::cloud::spaces::Space],
) -> Vec<Group> {
    let (local, cloud): (Vec<Item>, Vec<Item>) =
        items.iter().cloned().partition(|i| i.local_path.is_some());
    let mut groups = vec![];
    if !local.is_empty() {
        groups.push(Group {
            kind: GroupKind::Local,
            items: local,
        });
    }
    for space in spaces {
        let held: Vec<Item> = cloud
            .iter()
            .filter(|i| i.cloud_organization.as_deref() == Some(space.id.as_str()))
            .cloned()
            .collect();
        if !held.is_empty() {
            groups.push(Group {
                kind: GroupKind::Space(space.clone()),
                items: held,
            });
        }
    }
    let unplaced: Vec<Item> = cloud
        .into_iter()
        .filter(|i| {
            !spaces
                .iter()
                .any(|s| i.cloud_organization.as_deref() == Some(s.id.as_str()))
        })
        .collect();
    if !unplaced.is_empty() {
        groups.push(Group {
            kind: GroupKind::Cloud,
            items: unplaced,
        });
    }
    groups
}
/// `projectMenuPlace`: another computer's folders keep every place.
fn menu_place(menu: &crate::app::project_place::PlaceMenu) -> Option<MenuPlace> {
    use crate::app::project_place::Place;
    if let Some(space) = &menu.space {
        return Some(MenuPlace::Space(space.id.clone()));
    }
    match menu.place {
        Place::Computer => None,
        Place::Local => Some(MenuPlace::Local),
        Place::Cloud => Some(MenuPlace::Cloud),
    }
}
/// `projectMenuGroupsInPlace`.
fn in_place(groups: Vec<Group>, place: &MenuPlace) -> Vec<Group> {
    groups
        .into_iter()
        .filter(|g| match (place, &g.kind) {
            (MenuPlace::Space(id), GroupKind::Space(space)) => &space.id == id,
            (MenuPlace::Local, GroupKind::Local) | (MenuPlace::Cloud, GroupKind::Cloud) => true,
            _ => false,
        })
        .collect()
}
/// `projectMenuGroupsNeedHeadings`: only this computer's folders need none.
fn needs_headings(groups: &[Group]) -> bool {
    groups.len() > 1 || groups.first().is_some_and(|g| g.kind != GroupKind::Local)
}
/// `.desktop-project-menu-group-label`.
fn group_label(kind: &GroupKind, t: Theme) -> AnyElement {
    let ty = theme::ty().ui;
    let (mark, name): (AnyElement, String) = match kind {
        GroupKind::Space(space) => (
            crate::features::cloud::space_mark(space)
                .size(crate::ui::components::SpaceMarkSize::Small)
                .into_any_element(),
            crate::features::cloud::space_name(space),
        ),
        GroupKind::Local => (
            Icon::product(crate::ui::components::ProductIcon::Local)
                .with_size(px(12.))
                .stroke(1.8)
                .into_any_element(),
            tr(crate::platform::conventions::Conventions::current().this_computer_label_key)
                .to_owned(),
        ),
        GroupKind::Cloud => (
            Icon::product(crate::ui::components::ProductIcon::Cloud)
                .with_size(px(12.))
                .stroke(1.8)
                .into_any_element(),
            tr("cloud.home.location.cloud").to_owned(),
        ),
    };
    h_flex()
        .min_w_0()
        .gap(px(6.))
        .pt(px(4.))
        .pb(px(2.))
        .px(px(8.))
        .text_color(t.subtle)
        .text_size(px(ty.meta))
        .line_height(px(16.))
        .font_weight(FontWeight::MEDIUM)
        .child(mark)
        .child(div().min_w_0().truncate().child(name))
        .into_any_element()
}
