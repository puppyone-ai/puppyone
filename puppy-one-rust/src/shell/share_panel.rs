//! `CloudWorkspaceShareDialog`: sharing a Cloud project with people, as a
//! 380px card under the Header's Share button. A link to what is open (the
//! selected folder, else the open file) and one to the whole project; each
//! row names what it opens, so a file called anything still reads as a file.
//! The links grant nothing: people sign in with their own access. Agents are
//! invited from their own card.
use super::*;
use crate::{
    localization::t as tr,
    theme::metric,
    ui::components::{Button, ButtonVariant, Icon, PopoverMenu, ProductIcon},
};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

/// `preferredWidth={380}`, `gap={6}`, `preferredMaxHeight={560}`.
const WIDTH: f32 = 380.;
const GAP: f32 = 6.;
const MAX_HEIGHT: f32 = 560.;
/// `--share-inset`.
const INSET: f32 = 16.;

#[derive(Clone, Debug, PartialEq)]
pub(super) struct ShareTarget {
    pub id: &'static str,
    pub name: String,
    pub caption: &'static str,
    pub directory: bool,
    pub url: String,
}
/// The card's snapshot, taken when it opens: what it links to and which
/// row just copied.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct SharePanel {
    pub targets: Vec<ShareTarget>,
    pub copied: Option<&'static str>,
}

fn last_name(path: &str) -> &str {
    path.rsplit('/').find(|s| !s.is_empty()).unwrap_or_default()
}
/// `shareTargets`: what is open first, when it is not simply the whole of
/// what can be shared. A resource that cannot be linked offers nothing.
pub(super) fn share_targets(
    web: &str,
    project: &str,
    project_name: &str,
    scope: Option<&str>,
    resource: Option<(&str, bool)>,
) -> Vec<ShareTarget> {
    use crate::workspace::cloud::locator::resource_url;
    let root = scope.unwrap_or_default();
    let root_name = Some(last_name(root))
        .filter(|n| !n.is_empty())
        .or(Some(project_name).filter(|n| !n.is_empty()))
        .unwrap_or(project)
        .to_owned();
    let Ok(root_url) = resource_url(web, project, root, true) else {
        return vec![];
    };
    let inner = resource.filter(|(path, _)| *path != root);
    let mut targets = Vec::new();
    if let Some((path, directory)) = inner {
        if scope.is_some_and(|scope| !path.starts_with(&format!("{scope}/"))) {
            return vec![];
        }
        let Ok(url) = resource_url(web, project, path, directory) else {
            return vec![];
        };
        targets.push(ShareTarget {
            id: "resource",
            name: Some(last_name(path))
                .filter(|n| !n.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| root_name.clone()),
            caption: if directory {
                "cloud.share.people.thisFolder"
            } else {
                "cloud.share.people.thisFile"
            },
            directory,
            url,
        });
    }
    targets.push(ShareTarget {
        id: "project",
        name: root_name,
        caption: if scope.is_some() {
            "cloud.share.people.thisFolder"
        } else {
            "cloud.share.people.wholeProject"
        },
        directory: true,
        url: root_url,
    });
    targets
}

impl Shell {
    /// One snapshot when Share opens owns the copied locators: the selected
    /// folder, else the active document, else the root.
    pub(super) fn snapshot_share_panel(&mut self, cx: &App) {
        let targets = (|| {
            let (_, binding) = crate::features::cloud_account::broker_and_binding(cx)?;
            let project = self.hosted_project()?;
            let resource = match self.explorer.read(cx).selected_folder() {
                Some(folder) => Some((folder.to_string_lossy().into_owned(), true)),
                None => self
                    .files
                    .opened()
                    .map(|(_, relative)| (relative.to_string_lossy().into_owned(), false)),
            };
            Some(share_targets(
                binding.environment.web(),
                &project,
                &self.window.name,
                None,
                resource.as_ref().map(|(p, d)| (p.as_str(), *d)),
            ))
        })()
        .unwrap_or_default();
        self.share_panel = SharePanel {
            targets,
            copied: None,
        };
    }
    /// The Header's Share button and the card it opens.
    pub(super) fn share_control(&self, cx: &mut Context<Self>) -> AnyElement {
        let open = self.popover == Some(Popover::Share);
        let host = self.weak.clone();
        let panel = self.share_panel.clone();
        let t = cx.palette();
        let copy_host = self.weak.clone();
        PopoverMenu::new("cloud-share-panel")
            .anchor(Anchor::TopCenter)
            .offset(px(GAP))
            .open(open)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    if *opened != (s.popover == Some(Popover::Share)) {
                        if *opened {
                            s.snapshot_share_panel(cx);
                        }
                        s.popover = opened.then_some(Popover::Share);
                        cx.notify();
                    }
                });
            })
            .trigger(header::share_entry())
            .content(move |_, window, _| {
                let max = (window.viewport_size().height - px(58.)).min(px(MAX_HEIGHT));
                share_card(panel, t, max, copy_host)
            })
            .into_any_element()
    }
}

fn share_card(
    panel: SharePanel,
    t: Theme,
    max_height: Pixels,
    host: WeakEntity<Shell>,
) -> Stateful<Div> {
    let ty = theme::ty().ui;
    let heading = v_flex()
        .gap(px(2.))
        .min_w_0()
        .child(
            div()
                .truncate()
                .text_size(px(ty.meta))
                .line_height(px(18.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.text)
                .child(tr("cloud.share.people.title")),
        )
        .child(
            div()
                .text_size(px(ty.caption))
                .line_height(px(16.))
                .text_color(t.muted)
                .child(tr("cloud.share.people.note")),
        );
    let rows: Vec<AnyElement> = panel
        .targets
        .iter()
        .map(|target| {
            let copied = panel.copied == Some(target.id);
            let (id, url) = (target.id, target.url.clone());
            let host = host.clone();
            h_flex()
                .min_h(px(36.))
                .gap(px(10.))
                .items_center()
                .min_w_0()
                .text_color(t.muted)
                .child(
                    if target.directory {
                        Icon::product(ProductIcon::Folder)
                    } else {
                        Icon::new("file-text")
                    }
                    .with_size(px(15.))
                    .stroke(1.75),
                )
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .truncate()
                                .text_size(px(ty.meta))
                                .line_height(px(18.))
                                .text_color(t.text)
                                .child(target.name.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(ty.caption))
                                .line_height(px(16.))
                                .text_color(t.muted)
                                .child(tr(target.caption)),
                        ),
                )
                .child(
                    Button::new(SharedString::from(format!("share-copy-{id}")))
                        .variant(ButtonVariant::Secondary)
                        .accessibility_label(format!(
                            "{} {}",
                            tr("cloud.share.people.copy"),
                            target.name
                        ))
                        .when(copied, |b| b.icon(Icon::new("check").with_size(px(14.))))
                        .label(tr(if copied {
                            "cloud.share.action.copied"
                        } else {
                            "cloud.share.people.copy"
                        }))
                        .h(px(theme::control_compact()))
                        .min_w(px(76.))
                        .px(px(11.))
                        .text_size(px(ty.caption))
                        .font_weight(FontWeight::MEDIUM)
                        .on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(url.clone()));
                            let _ = host.update(cx, |s, cx| {
                                s.share_panel.copied = Some(id);
                                cx.notify();
                            });
                        }),
                )
                .into_any_element()
        })
        .collect();
    let body = if rows.is_empty() {
        div()
            .text_size(px(ty.caption))
            .line_height(px(16.))
            .text_color(t.danger)
            .child(tr("cloud.share.publish.unavailable"))
            .into_any_element()
    } else {
        v_flex().gap(px(4.)).children(rows).into_any_element()
    };
    card("cloud-workspace-share", t, WIDTH, INSET, max_height)
        .gap(px(10.))
        .child(heading)
        .child(body)
}
/// `.desktop-cloud-workspace-share`: a card under the Header on the project
/// menu's own surface, `inset` from its edge.
pub(super) fn card(
    id: &'static str,
    t: Theme,
    width: f32,
    inset: f32,
    max_height: Pixels,
) -> Stateful<Div> {
    v_flex()
        .id(id)
        .debug_selector(move || id.into())
        .occlude()
        .w(px(width))
        .max_h(max_height)
        .overflow_y_scroll()
        .p(px(inset))
        .rounded(px(metric::MENU_RADIUS))
        .border_1()
        .border_color(t.shell_divider)
        .bg(t.header)
        .text_color(t.text)
        .shadow(vec![
            BoxShadow {
                color: theme::alpha(t.shadow, 0.45).into(),
                offset: point(px(0.), px(2.)),
                blur_radius: px(4.),
                spread_radius: px(0.),
                inset: false,
            },
            BoxShadow {
                color: theme::alpha(t.shadow, 0.70).into(),
                offset: point(px(0.), px(12.)),
                blur_radius: px(28.),
                spread_radius: px(-8.),
                inset: false,
            },
        ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn what_is_open_comes_first_then_the_whole_project() {
        let web = "https://www.puppyone.ai";
        let p1 = "0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab";
        let targets = share_targets(web, p1, "Docs", None, Some(("notes/plan.md", false)));
        assert_eq!(
            targets
                .iter()
                .map(|t| (t.id, t.name.as_str(), t.caption))
                .collect::<Vec<_>>(),
            vec![
                ("resource", "plan.md", "cloud.share.people.thisFile"),
                ("project", "Docs", "cloud.share.people.wholeProject"),
            ]
        );
        // The root itself is just the project.
        assert_eq!(targets[1].url, format!("https://www.puppyone.ai/{p1}/"));
        let targets = share_targets(web, p1, "Docs", None, Some(("", true)));
        assert_eq!(targets.len(), 1);
        // A scope names its folder, and nothing outside it is linked.
        let targets = share_targets(web, p1, "Docs", Some("team"), None);
        assert_eq!(
            (targets[0].name.as_str(), targets[0].caption),
            ("team", "cloud.share.people.thisFolder")
        );
        assert!(
            share_targets(web, p1, "Docs", Some("team"), Some(("other/a.md", false))).is_empty()
        );
        // A project the website cannot address offers nothing.
        assert!(share_targets(web, "project-a", "Docs", None, None).is_empty());
    }
}
