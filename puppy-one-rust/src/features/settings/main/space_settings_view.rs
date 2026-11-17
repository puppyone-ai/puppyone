//! Settings › Members (`SpaceSettingsView`, `SpaceSettings`): the Settings
//! space's members, on the owner-authorized organization API. An owner may
//! rename a shared space (the account's own reads "Personal" and is never
//! renamed), change a member between a paid seat and a free viewer, remove
//! one, invite by email and transfer ownership. Membership never starts a
//! hidden purchase. A failure says so in one fixed sentence; the server's
//! own wording is not shown.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use crate::localization::t as tr;
use crate::theme::{self, Theme};
use crate::ui::components::{
    Button, ButtonVariant, Select, SelectOption, SettingsSection, SettingsSubsection, ValueRow,
};
use crate::ui::form_input::TextInput;
use crate::workspace::cloud::services::{self, Member, MemberRole, SPACE_NAME_MAX};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};

pub(in crate::features::settings) struct SpacePage {
    /// The session namespace and the space read.
    context: Option<(String, String)>,
    members: Vec<Member>,
    owner: bool,
    loading: bool,
    busy: bool,
    failed: bool,
    role: MemberRole,
    invite_url: Option<String>,
    transfer_to: Option<String>,
    pub(in crate::features::settings) name: Entity<TextInput>,
    pub(in crate::features::settings) email: Entity<TextInput>,
    epoch: u64,
    /// The window whose keyboard goes to the invitation field once the
    /// owner's page shows (`focusInvite`).
    pub(in crate::features::settings) focus_invite: Option<AnyWindowHandle>,
}
impl SpacePage {
    pub(in crate::features::settings) fn new(window: &mut Window, cx: &mut App) -> Self {
        let name = cx.new(|cx| {
            let mut input = TextInput::new("", false, SPACE_NAME_MAX, window, cx);
            input.submit_on_enter = true;
            input
        });
        let email = cx.new(|cx| {
            let mut input =
                TextInput::new(tr("settings.space.inviteEmail"), false, 320, window, cx);
            input.submit_on_enter = true;
            input
        });
        Self {
            context: None,
            members: vec![],
            owner: false,
            loading: false,
            busy: false,
            failed: false,
            role: MemberRole::Viewer,
            invite_url: None,
            transfer_to: None,
            name,
            email,
            epoch: 0,
            focus_invite: None,
        }
    }
    /// The session namespace and space read.
    pub(in crate::features::settings) fn context(&self) -> Option<&(String, String)> {
        self.context.as_ref()
    }
    /// The space the page read.
    pub(in crate::features::settings) fn org(&self) -> Option<&str> {
        self.context.as_ref().map(|(_, org)| org.as_str())
    }
    fn sync_disabled(&self, cx: &mut App) {
        let disabled = self.busy || self.loading;
        self.name.update(cx, |input, cx| {
            if input.disabled != disabled {
                input.disabled = disabled;
                cx.notify();
            }
        });
        self.email.update(cx, |input, cx| {
            if input.disabled != disabled {
                input.disabled = disabled;
                cx.notify();
            }
        });
    }
    pub(in crate::features::settings) fn reset(&mut self, cx: &mut App) {
        self.epoch += 1;
        self.context = None;
        self.members.clear();
        self.owner = false;
        self.loading = false;
        self.busy = false;
        self.failed = false;
        self.role = MemberRole::Viewer;
        self.invite_url = None;
        self.transfer_to = None;
        self.focus_invite = None;
        self.name.update(cx, |input, cx| {
            input.disabled = false;
            input.set_text("", cx);
        });
        self.email.update(cx, |input, cx| {
            input.disabled = false;
            input.set_text("", cx);
        });
    }
}

impl SettingsWorkspaceSurface {
    /// The members and the reader's access for the Settings space, again
    /// after every change; a new space or session starts the page over.
    pub(in crate::features::settings) fn load_space(&mut self, cx: &mut Context<Self>) {
        let Some(space) = self.settings_space(cx) else {
            self.space_page.reset(cx);
            return;
        };
        let (Some((_, binding)), Some(services), Some(billing)) = (
            crate::features::cloud::account::broker_and_binding(cx),
            crate::features::cloud::services_client(cx),
            crate::features::cloud::billing_client(cx),
        ) else {
            self.space_page.reset(cx);
            return;
        };
        let context = (
            crate::features::cloud::billing_namespace(&binding),
            space.id.clone(),
        );
        let page = &mut self.space_page;
        if page.context.as_ref() != Some(&context) {
            page.context = Some(context);
            page.members.clear();
            page.owner = false;
            page.failed = false;
            page.invite_url = None;
            page.transfer_to = None;
            let name = crate::features::cloud::space_name(&space);
            page.name.update(cx, |input, cx| input.set_text(name, cx));
            page.email.update(cx, |input, cx| input.set_text("", cx));
        }
        page.epoch += 1;
        page.loading = true;
        page.sync_disabled(cx);
        let epoch = page.epoch;
        let org = space.id;
        let task = cx.background_spawn(async move {
            Ok::<_, services::Error>((services.members(&org)?, billing.access(&org)?))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                let page = &mut s.space_page;
                if page.epoch != epoch {
                    return;
                }
                page.loading = false;
                page.sync_disabled(cx);
                match result {
                    Ok((members, access)) => {
                        page.members = members;
                        page.owner = access.can_manage_billing;
                        page.failed = false;
                        // The field draws with this read; the keyboard
                        // reaches it on the next frame.
                        if let Some(handle) = page.focus_invite.take().filter(|_| page.owner) {
                            let email = page.email.clone();
                            cx.defer(move |cx| {
                                let _ = cx.update_window(handle, |_, window, cx| {
                                    email.read(cx).focus_handle(cx).focus(window, cx)
                                });
                            });
                        }
                    }
                    Err(_) => {
                        page.owner = false;
                        page.failed = true;
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }
    /// `run`: one change at a time; the page rereads after it, and the
    /// window's spaces after a rename or a transfer (`onChanged`).
    fn change_space(
        &mut self,
        change: impl FnOnce(&services::Client, &str) -> Result<Option<String>, services::Error>
        + Send
        + 'static,
        cx: &mut Context<Self>,
    ) {
        let page = &mut self.space_page;
        let (Some((_, org)), Some(client)) = (
            page.context.clone(),
            crate::features::cloud::services_client(cx),
        ) else {
            return;
        };
        if page.busy {
            return;
        }
        page.busy = true;
        page.failed = false;
        page.sync_disabled(cx);
        let epoch = page.epoch;
        let task = cx.background_spawn(async move { change(&client, &org) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                if s.space_page.epoch != epoch {
                    return;
                }
                s.space_page.busy = false;
                s.space_page.sync_disabled(cx);
                match result {
                    Ok(invite) => {
                        if let Some(url) = invite {
                            s.space_page.invite_url = Some(url);
                            s.space_page.email.update(cx, |i, cx| i.set_text("", cx));
                        }
                        s.load_space(cx);
                        crate::features::cloud::global_spaces(cx)
                            .update(cx, |spaces, cx| spaces.ensure(true, true, true, cx));
                    }
                    Err(_) => s.space_page.failed = true,
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }
    /// Submits a space rename when the reader owns a non-personal space and
    /// typed a distinct non-empty name.
    pub(in crate::features::settings) fn submit_space_rename(&mut self, cx: &mut Context<Self>) {
        let Some(space) = self.settings_space(cx) else {
            return;
        };
        let page = &self.space_page;
        if !page.owner || space.is_default || page.busy || page.loading {
            return;
        }
        let current = crate::features::cloud::space_name(&space);
        let typed = page.name.read(cx).text().trim().to_owned();
        if typed.is_empty() || typed == current {
            return;
        }
        self.change_space(
            move |client, org| client.rename_space(org, &typed).map(|_| None),
            cx,
        );
    }
    /// Submits an email invitation when the reader owns the space and typed
    /// an email address.
    pub(in crate::features::settings) fn submit_space_invite(&mut self, cx: &mut Context<Self>) {
        let page = &self.space_page;
        if !page.owner || page.busy || page.loading {
            return;
        }
        let email = page.email.read(cx).text().trim().to_owned();
        if email.is_empty() {
            return;
        }
        let role = page.role;
        self.change_space(
            move |client, org| {
                client
                    .invite(org, &email, role)
                    .map(|url| Some(url.unwrap_or_default()))
            },
            cx,
        );
    }

    /// How many members the page lists, and whether the reader owns it.
    #[cfg(test)]
    pub fn space_members(&self) -> Option<(usize, bool)> {
        let page = &self.space_page;
        (!page.loading && page.context.is_some()).then_some((page.members.len(), page.owner))
    }
    /// The invitation link returned by the last invite, if any.
    #[cfg(test)]
    pub fn space_invite_url(&self) -> Option<&str> {
        self.space_page
            .invite_url
            .as_deref()
            .filter(|url| !url.is_empty())
    }
    /// Type into Members' email field and submit an invitation in tests.
    #[cfg(test)]
    pub fn invite_member_for_test(&mut self, email: &str, cx: &mut Context<Self>) {
        self.space_page
            .email
            .update(cx, |input, cx| input.set_text(email, cx));
        self.submit_space_invite(cx);
    }
    /// The keyboard is in the invitation field.
    #[cfg(test)]
    pub fn invite_focused(&self, window: &Window, cx: &App) -> bool {
        self.space_page
            .email
            .read(cx)
            .focus_handle(cx)
            .is_focused(window)
    }
    pub(in crate::features::settings) fn space_settings(
        &self,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use crate::features::cloud::account::Status;
        let section = SettingsSection::new(tr("settings.space.membersAndSettings"));
        let note = |text: &str| {
            div()
                .px(px(10.))
                .text_size(px(theme::ty().ui.meta))
                .line_height(px(theme::ty().ui.meta * 1.5))
                .text_color(t.subtle)
                .child(text.to_owned())
        };
        if crate::features::cloud::account::status(cx) == Some(Status::Restoring) {
            return section
                .child(note(tr("settings.account.status.restoring")))
                .into_any_element();
        }
        let Some((_, binding)) = crate::features::cloud::account::broker_and_binding(cx) else {
            return section
                .child(
                    h_flex().px(px(10.)).child(
                        Button::new("space-sign-in")
                            .label(tr("settings.account.signInWithBrowser"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.select_page(crate::features::settings::Page::Account, cx)
                            })),
                    ),
                )
                .into_any_element();
        };
        let Some(space) = self.settings_space(cx) else {
            return section
                .child(note(tr("settings.space.choose")))
                .into_any_element();
        };
        let page = &self.space_page;
        let disabled = page.busy || page.loading;
        let renamable = page.owner && !space.is_default;
        let name = crate::features::cloud::space_name(&space);
        let typed = page.name.read(cx).text().trim().to_owned();
        let me = binding.user.clone();
        let mut rows = SettingsSubsection::new().child(if renamable {
            ValueRow::new(tr("settings.space.name"), "")
                .action(
                    h_flex()
                        .gap(px(8.))
                        .child(div().w(px(220.)).child(page.name.clone()))
                        .child(
                            Button::new("space-rename")
                                .label(tr("settings.space.save"))
                                .disabled(disabled || typed.is_empty() || typed == name)
                                .on_click(cx.listener(|s, _, _, cx| s.submit_space_rename(cx))),
                        ),
                )
                .into_any_element()
        } else {
            ValueRow::new(tr("settings.space.name"), name).into_any_element()
        });
        for member in &page.members {
            let role = format!("settings.space.role.{}", member.role);
            let role = match tr(&role) {
                text if text == role => member.role.clone(),
                text => text.to_owned(),
            };
            let manageable = page.owner && member.user_id != me && member.role != "owner";
            let row = ValueRow::new(member.label().to_owned(), role);
            let user = member.user_id.clone();
            let viewer = member.role == "viewer";
            rows = rows.child(if manageable {
                let removed = user.clone();
                row.action(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            Button::new(SharedString::from(format!("space-role-{user}")))
                                .label(tr(if viewer {
                                    "settings.space.makeMember"
                                } else {
                                    "settings.space.makeViewer"
                                }))
                                .disabled(disabled)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    let user = user.clone();
                                    let role = if viewer {
                                        MemberRole::Member
                                    } else {
                                        MemberRole::Viewer
                                    };
                                    s.change_space(
                                        move |client, org| {
                                            client.set_member_role(org, &user, role).map(|_| None)
                                        },
                                        cx,
                                    )
                                })),
                        )
                        .child(
                            Button::new(SharedString::from(format!("space-remove-{removed}")))
                                .label(tr("settings.space.remove"))
                                .disabled(disabled)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    let user = removed.clone();
                                    s.change_space(
                                        move |client, org| {
                                            client.remove_member(org, &user).map(|_| None)
                                        },
                                        cx,
                                    )
                                })),
                        ),
                )
            } else {
                row
            });
        }
        if page.loading {
            rows = rows.child(note(tr("settings.plan.loading")));
        }
        if page.owner {
            let email = page.email.read(cx).text().trim().to_owned();
            let role = page.role;
            let entity = cx.entity();
            rows = rows
                .child(
                    h_flex()
                        .px(px(10.))
                        .gap(px(8.))
                        .child(div().flex_1().min_w_0().child(page.email.clone()))
                        .child(
                            Select::new(
                                "space-invite-role",
                                tr(&format!("settings.space.role.{}", role.key())),
                                move |_| {
                                    [MemberRole::Viewer, MemberRole::Member]
                                        .into_iter()
                                        .map(|choice| {
                                            let entity = entity.clone();
                                            SelectOption::new(tr(&format!(
                                                "settings.space.role.{}",
                                                choice.key()
                                            )))
                                            .selected(choice == role)
                                            .on_select(move |_, cx| {
                                                entity.update(cx, |s, cx| {
                                                    s.space_page.role = choice;
                                                    cx.notify();
                                                })
                                            })
                                        })
                                        .collect()
                                },
                            )
                            .disabled(disabled),
                        )
                        .child(
                            Button::new("space-invite")
                                .label(tr("settings.space.invite"))
                                .disabled(disabled || email.is_empty())
                                .on_click(cx.listener(|s, _, _, cx| s.submit_space_invite(cx))),
                        ),
                )
                .child(note(tr("settings.space.seatNotice")));
        }
        if let Some(url) = page.invite_url.clone().filter(|u| !u.is_empty()) {
            let copy_key: SharedString = "space-invite-url".into();
            let copied = self.is_copied(&copy_key);
            let url_to_copy = url.clone();
            rows = rows.child(
                ValueRow::new(tr("settings.space.invitationLink"), url)
                    .monospace(true)
                    .action(
                        Button::new("space-copy-invite")
                            .debug_selector(|| "space-copy-invite".into())
                            .icon("copy")
                            .label(tr(if copied {
                                "common.action.copied"
                            } else {
                                "common.action.copy"
                            }))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.copy(copy_key.clone(), url_to_copy.clone(), cx)
                            })),
                    ),
            );
        }
        let others: Vec<Member> = page
            .members
            .iter()
            .filter(|m| m.user_id != me)
            .cloned()
            .collect();
        if page.owner && !others.is_empty() {
            let chosen = page
                .transfer_to
                .clone()
                .filter(|id| others.iter().any(|m| &m.user_id == id));
            let label = chosen
                .as_ref()
                .and_then(|id| others.iter().find(|m| &m.user_id == id))
                .map_or_else(
                    || tr("settings.space.chooseMember").to_owned(),
                    |m| m.label().to_owned(),
                );
            let entity = cx.entity();
            let choices = others.clone();
            let target = chosen.clone();
            rows = rows.child(
                ValueRow::new(tr("settings.space.transfer"), "").action(
                    h_flex()
                        .gap(px(8.))
                        .child(
                            Select::new("space-transfer", label, move |_| {
                                choices
                                    .iter()
                                    .map(|member| {
                                        let entity = entity.clone();
                                        let id = member.user_id.clone();
                                        SelectOption::new(member.label().to_owned())
                                            .selected(target.as_ref() == Some(&id))
                                            .on_select(move |_, cx| {
                                                let id = id.clone();
                                                entity.update(cx, |s, cx| {
                                                    s.space_page.transfer_to = Some(id);
                                                    cx.notify();
                                                })
                                            })
                                    })
                                    .collect()
                            })
                            .disabled(disabled),
                        )
                        .child(
                            Button::new("space-transfer-confirm")
                                .variant(ButtonVariant::OutlineDanger)
                                .label(tr("settings.space.confirmTransfer"))
                                .disabled(disabled || chosen.is_none())
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    let Some(user) = chosen.clone() else { return };
                                    s.space_page.transfer_to = None;
                                    s.change_space(
                                        move |client, org| {
                                            client.transfer_ownership(org, &user).map(|_| None)
                                        },
                                        cx,
                                    )
                                })),
                        ),
                ),
            );
        }
        section
            .child(rows)
            .when(page.failed, |d| {
                d.child(note(tr("native.space.failed")).text_color(t.danger))
            })
            .into_any_element()
    }
}
