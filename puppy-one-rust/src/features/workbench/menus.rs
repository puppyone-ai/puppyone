//! Workbench menus on the product menu surface. A tab's context menu (its
//! session actions, then Close) and a launcher row's "open in a terminal"
//! menu are pinned at the pointer; the header's overflow list
//! (`AuxiliaryWorkbenchOverflowMenu`) hangs from its trigger. GPUI Kit
//! places and dismisses them; the workbench holds which one is open.
use super::*;
use crate::ui::components::{AnchoredMenu, Icon, IconButton, Menu, MenuItem, PopoverMenu};
use gpui_kit::component::Sizable as _;

/// `AuxiliaryWorkbenchOverflowMenu` `preferredWidth`.
const OVERFLOW_MENU_WIDTH: f32 = 260.;
const OVERFLOW_MENU_MAX_HEIGHT: f32 = 320.;

/// The open context menu and where it was opened.
pub(super) enum ContextMenu {
    Tab {
        tab: Id,
        at: Point<Pixels>,
    },
    Launcher {
        group: Id,
        tab: Option<Id>,
        installation: Installation,
        at: Point<Pixels>,
    },
}

impl Workbench {
    pub(super) fn open_context_menu(&mut self, menu: ContextMenu, cx: &mut Context<Self>) {
        self.context_menu = Some(menu);
        cx.notify();
    }
    fn close_context_menu(&mut self, cx: &mut Context<Self>) {
        if self.context_menu.take().is_some() {
            cx.notify();
        }
    }
    /// The open context menu, pinned at the pointer.
    pub(super) fn render_context_menu(&self, cx: &mut Context<Self>) -> Option<AnchoredMenu> {
        let host = cx.weak_entity();
        let (at, surface) = match self.context_menu.as_ref()? {
            ContextMenu::Tab { tab, at } => {
                let tab = *tab;
                let content = self.project()?.content.get(&tab)?;
                let title = self.tab_title(tab, content, cx);
                let mut surface = Menu::new("workbench-tab-menu").min_w(px(200.));
                if let Content::Chat(view) = content {
                    surface = AgentChat::session_menu(view.clone(), surface, cx).separator();
                }
                let host = host.clone();
                let close =
                    crate::localization::tf("terminal.closeSession", &[("title", title.into())]);
                (
                    *at,
                    surface.item(MenuItem::new(close).on_click(move |_, cx| {
                        let _ = host.update(cx, |s, cx| s.close(tab, false, cx));
                    })),
                )
            }
            ContextMenu::Launcher {
                group,
                tab,
                installation,
                at,
            } => {
                let (group, tab, installation) = (*group, *tab, installation.clone());
                let host = host.clone();
                (
                    *at,
                    Menu::new("workbench-launcher-menu").min_w(px(180.)).item(
                        MenuItem::new(crate::localization::t("terminal.title")).on_click(
                            move |w, cx| {
                                let _ = host.update(cx, |s, cx| {
                                    s.chat_mode = false;
                                    s.launch(group, tab, Some(installation.clone()), false, w, cx)
                                });
                            },
                        ),
                    ),
                )
            }
        };
        let close = move |cx: &mut App| {
            let _ = host.update(cx, |s, cx| s.close_context_menu(cx));
        };
        let close_after_item = close.clone();
        Some(
            AnchoredMenu::new(
                "workbench-context-menu",
                at,
                surface.on_dismiss(move |_, cx| close_after_item(cx)),
            )
            .on_dismiss(move |_, cx| close(cx)),
        )
    }
    /// The header's "N more" trigger and the hidden tabs it lists.
    pub(super) fn overflow_menu(
        &self,
        group: Id,
        label: SharedString,
        width: f32,
        cx: &mut Context<Self>,
    ) -> PopoverMenu {
        let t = cx.palette();
        let open = self.overflow == Some(group);
        let host = cx.weak_entity();
        let trigger = IconButton::new(
            ElementId::NamedInteger("overflow".into(), group),
            Icon::new("ellipsis").small().stroke(1.9),
        )
        .label(label)
        .with_size(px(header_layout::COMPACT))
        .color(t.muted)
        .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS));
        let mut popover = PopoverMenu::new(ElementId::NamedInteger("overflow-menu".into(), group))
            .offset(px(4.))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    s.overflow = opened.then_some(group);
                    cx.notify();
                });
            })
            .trigger(trigger);
        if open {
            let items = self.overflow_items(group, cx);
            let menu_width = OVERFLOW_MENU_WIDTH.min(width - 16.);
            popover = popover.menu(move |menu, _, _| {
                menu.w(px(menu_width))
                    .max_h(px(OVERFLOW_MENU_MAX_HEIGHT))
                    .items(items)
            });
        }
        popover
    }
    /// One row per hidden tab: its status glyph, title and a close button.
    fn overflow_items(&self, group: Id, cx: &mut Context<Self>) -> Vec<MenuItem> {
        let t = cx.palette();
        let hidden = self
            .overflow_hidden
            .get(&group)
            .cloned()
            .unwrap_or_default();
        hidden
            .into_iter()
            .filter_map(|tab| {
                let content = self.project()?.content.get(&tab)?;
                let title = self.tab_title(tab, content, cx);
                let status = self.tab_status(tab, content, t.muted, cx);
                let mut item = MenuItem::new(title.clone());
                if let Some(detail) = content.detail(cx) {
                    item = item.detail(detail);
                }
                let close_label = crate::localization::tf(
                    "terminal.closeSession",
                    &[("title", title.clone().into())],
                );
                let activate = cx.weak_entity();
                let close = cx.weak_entity();
                Some(
                    item.icon_element(status)
                        .trailing(
                            IconButton::new(
                                ("overflow-close", tab),
                                Icon::new("x").xsmall().stroke(1.8),
                            )
                            .label(close_label)
                            .with_size(px(theme::control()))
                            .color(t.subtle)
                            .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                            .on_click(move |_, _, cx| {
                                cx.stop_propagation();
                                let _ = close.update(cx, |s, cx| {
                                    s.overflow = None;
                                    s.close(tab, false, cx)
                                });
                            }),
                        )
                        .on_click(move |_, cx| {
                            let _ = activate.update(cx, |s, cx| {
                                if let Some(p) = s.project_mut() {
                                    p.layout.activate(group, tab);
                                }
                                s.overflow = None;
                                cx.notify();
                            });
                        }),
                )
            })
            .collect()
    }
}
