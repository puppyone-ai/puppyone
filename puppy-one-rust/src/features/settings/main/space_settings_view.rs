//! Settings › Members and Space settings, on the owner-authorized
//! organization API, drawn as every Settings page is: rows with the label
//! at the start and the control at the end. Members: the owner's invitation
//! row, then who is in the space, each with a role its owner changes in
//! place and a menu for removing them, confirmed on the row under it. Space
//! settings (a team space's owner only): its name, its owner and handing it
//! on. Membership never starts a hidden purchase. A failure says so in one
//! fixed sentence; the server's own wording is not shown.
use super::super::settings_workspace_surface::SettingsWorkspaceSurface;
use crate::localization::{Arg, t as tr, tf};
use crate::theme::{self, Theme};
use crate::ui::components::{
    Button, ButtonVariant, PersonMark, PopoverMenu, RowActionButton, Select, SelectOption,
    SettingRow, SettingsChange, SettingsList, SettingsNote, SettingsSection, SettingsSubsection,
};
use crate::ui::form_input::TextInput;
use crate::workspace::cloud::services::{self, Member, MemberRole, SPACE_NAME_MAX};
use crate::workspace::cloud::spaces::{Space, mark_initial, mark_tone};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};

/// The role picker's width in a member's row.
const ROLE_WIDTH: f32 = 168.;

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
    /// The member whose removal waits for its confirmation.
    removing: Option<String>,
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
            removing: None,
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
    /// Someone besides the reader is in `space`, as last read.
    pub(in crate::features::settings) fn others_in(&self, space: &str) -> bool {
        self.org() == Some(space) && self.members.len() > 1
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
        self.removing = None;
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
            page.removing = None;
            let name = crate::features::cloud::space_name(&space);
            page.name.update(cx, |input, cx| input.set_text(name, cx));
            page.email.update(cx, |input, cx| input.set_text("", cx));
        }
        page.epoch += 1;
        page.loading = true;
        page.sync_disabled(cx);
        let epoch = page.epoch;
        let org = space.id;
        let loaded_org = org.clone();
        let task = cx.background_spawn(async move {
            Ok::<_, services::Error>((services.members(&org)?, billing.access(&org)?))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |s, cx| {
                let matches_requested = s
                    .requested_space
                    .as_deref()
                    .is_none_or(|requested| requested == loaded_org);
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
                        // reaches it on the next frame. Keep `focus_invite`
                        // armed if a fallback space resolved before the newly
                        // created requested space arrived in `global_spaces`.
                        if matches_requested
                            && let Some(handle) = page.focus_invite.take().filter(|_| page.owner)
                        {
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
    /// A member's menu asked to remove `user`; the row now asks to confirm.
    #[cfg(test)]
    pub fn ask_to_remove_for_test(&mut self, user: &str, cx: &mut Context<Self>) {
        self.space_page.removing = Some(user.to_owned());
        cx.notify();
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
    /// What Members and Space settings show before there is a space to
    /// manage: restoring, signed out, or none chosen.
    fn space_unavailable(
        &self,
        section: SettingsSection,
        cx: &mut Context<Self>,
    ) -> Result<(Space, String), AnyElement> {
        use crate::features::cloud::account::Status;
        if crate::features::cloud::account::status(cx) == Some(Status::Restoring) {
            return Err(section
                .child(SettingsNote::new(tr("settings.account.status.restoring")))
                .into_any_element());
        }
        let Some((_, binding)) = crate::features::cloud::account::broker_and_binding(cx) else {
            return Err(section
                .child(
                    SettingsList::new().lead(true).child(
                        SettingRow::new(tr("settings.account.statusLabel")).control(
                            Button::new("space-sign-in")
                                .variant(ButtonVariant::OutlinePrimary)
                                .label(tr("settings.account.signInWithBrowser"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.select_page(crate::features::settings::Page::Account, cx)
                                })),
                        ),
                    ),
                )
                .into_any_element());
        };
        match self.settings_space(cx) {
            Some(space) => Ok((space, binding.user.clone())),
            None => Err(section
                .child(SettingsNote::new(tr("settings.space.choose")))
                .into_any_element()),
        }
    }
    fn failure(&self) -> Option<SettingsNote> {
        self.space_page
            .failed
            .then(|| SettingsNote::new(tr("native.space.failed")).danger())
    }

    /// Settings › Members: for its owner, the invitation first; then who is
    /// in the space, one row each.
    pub(in crate::features::settings) fn members(
        &self,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let section = SettingsSection::new(tr("settings.space.membersAndSettings"));
        let (space, me) = match self.space_unavailable(section, cx) {
            Ok(found) => found,
            Err(page) => return page,
        };
        let page = &self.space_page;
        let disabled = page.busy || page.loading;
        let name = crate::features::cloud::space_name(&space);
        let owner_name = page
            .members
            .iter()
            .find(|m| m.role == "owner")
            .map(|m| m.label().to_owned());
        let count = if page.loading && page.members.is_empty() {
            tr("settings.plan.loading").to_owned()
        } else {
            tf(
                "settings.plan.peopleUnit",
                &[("count", Arg::Number(page.members.len() as i64))],
            )
        };
        let rows: Vec<AnyElement> = page
            .members
            .iter()
            .map(|member| self.member_row(member, &me, &name, disabled, t, cx))
            .collect();
        let mut section = SettingsSection::new(tr("settings.space.membersAndSettings"));
        if page.owner {
            section = section.child(self.invitation(disabled, t, cx));
        }
        section
            .child(
                v_flex()
                    .gap(px(6.))
                    .child(
                        div()
                            .id("space-members")
                            .child(SettingsSubsection::new().title(count).children(rows)),
                    )
                    .when(!page.owner && !page.loading, |d| {
                        d.children(owner_name.map(|owner| {
                            SettingsNote::new(tf(
                                "native.space.onlyOwner",
                                &[("name", owner.into())],
                            ))
                        }))
                    })
                    .children(self.failure()),
            )
            .into_any_element()
    }

    /// The owner's invitation: an email and a role in one row, the link
    /// the last invitation made, and the rule about seats.
    fn invitation(&self, disabled: bool, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let page = &self.space_page;
        let email = page.email.read(cx).text().trim().to_owned();
        let role = page.role;
        let entity = cx.entity();
        let link = page
            .invite_url
            .clone()
            .filter(|u| !u.is_empty())
            .map(|url| {
                let copy_key: SharedString = "space-invite-url".into();
                let copied = self.is_copied(&copy_key);
                let url_to_copy = url.clone();
                SettingRow::new(tr("settings.space.invitationLink")).control(
                    h_flex()
                        .gap(px(8.))
                        .min_w_0()
                        .child(
                            div()
                                .max_w(px(300.))
                                .min_w_0()
                                .truncate()
                                .font_family(theme::mono())
                                .text_size(px(theme::ty().ui.meta))
                                .text_color(t.subtle)
                                .child(url),
                        )
                        .child(
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
                )
            });
        let role_select = Select::new(
            "space-invite-role",
            tr(&format!("settings.space.role.{}", role.key())),
            move |_| {
                [MemberRole::Viewer, MemberRole::Member]
                    .into_iter()
                    .map(|choice| {
                        let entity = entity.clone();
                        SelectOption::new(tr(&format!("settings.space.role.{}", choice.key())))
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
        .disabled(disabled);
        v_flex()
            .gap(px(6.))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(
                        SettingRow::new(tr("native.space.inviteTitle")).control(
                            h_flex()
                                .gap(px(8.))
                                .child(div().w(px(220.)).child(page.email.clone()))
                                .child(role_select)
                                .child(
                                    Button::new("space-invite")
                                        .label(tr("settings.space.invite"))
                                        .disabled(disabled || email.is_empty())
                                        .on_click(
                                            cx.listener(|s, _, _, cx| s.submit_space_invite(cx)),
                                        ),
                                ),
                        ),
                    )
                    .children(link),
            )
            .child(SettingsNote::new(tr("native.space.seatNote")))
            .into_any_element()
    }

    /// One person: their circle, name and email, and their role; the owner
    /// changes another's role in place and removes them from the row's menu,
    /// confirming on the row under it.
    fn member_row(
        &self,
        member: &Member,
        me: &str,
        space: &str,
        disabled: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let page = &self.space_page;
        let user = member.user_id.clone();
        let mine = member.user_id == me;
        let manageable = page.owner && !mine && member.role != "owner";
        let key = member
            .email
            .clone()
            .unwrap_or_else(|| member.user_id.clone());
        let name = member.label().to_owned();
        let email = member
            .email
            .clone()
            .filter(|email| member.display_name.is_some() && email != &name);
        let short_role = {
            let key = format!("native.space.role.{}", member.role);
            match tr(&key) {
                text if text == key => member.role.clone(),
                text => text.to_owned(),
            }
        };
        let right: AnyElement = if manageable {
            let viewer = member.role == "viewer";
            let entity = cx.entity();
            let role_user = user.clone();
            let menu_user = user.clone();
            h_flex()
                .gap(px(4.))
                .child(
                    Select::new(
                        SharedString::from(format!("space-role-{user}")),
                        tr(if viewer {
                            "settings.space.role.viewer"
                        } else {
                            "settings.space.role.member"
                        }),
                        move |_| {
                            [MemberRole::Member, MemberRole::Viewer]
                                .into_iter()
                                .map(|choice| {
                                    let entity = entity.clone();
                                    let user = role_user.clone();
                                    SelectOption::new(tr(&format!(
                                        "settings.space.role.{}",
                                        choice.key()
                                    )))
                                    .selected((choice == MemberRole::Viewer) == viewer)
                                    .on_select(
                                        move |_, cx| {
                                            let user = user.clone();
                                            entity.update(cx, |s, cx| {
                                                s.change_space(
                                                    move |client, org| {
                                                        client
                                                            .set_member_role(org, &user, choice)
                                                            .map(|_| None)
                                                    },
                                                    cx,
                                                )
                                            })
                                        },
                                    )
                                })
                                .collect()
                        },
                    )
                    // One width for both roles keeps the column aligned.
                    .width_range(ROLE_WIDTH, ROLE_WIDTH)
                    .disabled(disabled),
                )
                .child(
                    PopoverMenu::new(SharedString::from(format!("space-member-menu-{user}")))
                        .anchor(Anchor::TopRight)
                        .trigger(
                            RowActionButton::more(SharedString::from(format!(
                                "space-member-more-{user}"
                            )))
                            .label(tr("native.space.memberActions"))
                            .disabled(disabled),
                        )
                        .menu({
                            let entity = cx.entity();
                            let label = tf(
                                "native.space.removeFrom",
                                &[("space", space.to_owned().into())],
                            );
                            move |menu, _, _| {
                                menu.item(
                                    crate::ui::components::MenuItem::new(label)
                                        .danger()
                                        .on_click(move |_, cx| {
                                            let user = menu_user.clone();
                                            entity.update(cx, |s, cx| {
                                                s.space_page.removing = Some(user);
                                                cx.notify();
                                            })
                                        }),
                                )
                            }
                        }),
                )
                .into_any_element()
        } else {
            div()
                .text_color(t.subtle)
                .child(short_role)
                .into_any_element()
        };
        let person = h_flex()
            .gap(px(10.))
            .min_w_0()
            .child(PersonMark::new(mark_tone(&key) as usize, mark_initial(&name)).side(20.))
            .child(
                div()
                    .text_color(t.text)
                    .whitespace_nowrap()
                    .child(name.clone()),
            )
            .when(mine, |d| {
                d.child(
                    div()
                        .text_color(t.subtle)
                        .whitespace_nowrap()
                        .child(format!("· {}", tr("native.space.you"))),
                )
            })
            .children(
                email.map(|email| div().min_w_0().truncate().text_color(t.subtle).child(email)),
            );
        let row = div()
            .id(SharedString::from(format!("space-member-{user}")))
            .child(SettingRow::new("").label_element(person).control(right));
        if page.removing.as_deref() != Some(user.as_str()) {
            return row.into_any_element();
        }
        let removed = user.clone();
        SettingsChange::new()
            .child(row)
            .child(
                SettingRow::new("")
                    .label_element(div().text_color(t.muted).child(tf(
                        "native.space.removeConfirm",
                        &[
                            ("name", name.clone().into()),
                            ("space", space.to_owned().into()),
                        ],
                    )))
                    .control(
                        h_flex()
                            .gap(px(8.))
                            .child(
                                Button::new("space-remove-cancel")
                                    .label(tr("common.action.cancel"))
                                    .disabled(disabled)
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        s.space_page.removing = None;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!("space-remove-{removed}")))
                                    .variant(ButtonVariant::OutlineDanger)
                                    .label(tr("settings.space.remove"))
                                    .disabled(disabled)
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        let user = removed.clone();
                                        s.space_page.removing = None;
                                        s.change_space(
                                            move |client, org| {
                                                client.remove_member(org, &user).map(|_| None)
                                            },
                                            cx,
                                        )
                                    })),
                            ),
                    ),
            )
            .into_any_element()
    }

    /// Settings › Space settings: a team space's name, its owner, and
    /// handing it to someone else.
    pub(in crate::features::settings) fn space_details(
        &self,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let section = SettingsSection::new(tr("settings.space.settings"));
        let (space, me) = match self.space_unavailable(section, cx) {
            Ok(found) => found,
            Err(page) => return page,
        };
        let page = &self.space_page;
        let disabled = page.busy || page.loading || !page.owner;
        let name = crate::features::cloud::space_name(&space);
        let typed = page.name.read(cx).text().trim().to_owned();
        let renamable = page.owner && !space.is_default;
        let save = Button::new("space-rename")
            .label(tr("settings.space.save"))
            .disabled(disabled || !renamable || typed.is_empty() || typed == name)
            .on_click(cx.listener(|s, _, _, cx| s.submit_space_rename(cx)));
        let owner = page.members.iter().find(|m| m.role == "owner").map(|m| {
            let key = m.email.clone().unwrap_or_else(|| m.user_id.clone());
            h_flex()
                .gap(px(10.))
                .child(PersonMark::new(mark_tone(&key) as usize, mark_initial(m.label())).side(20.))
                .child(div().text_color(t.text).child(m.label().to_owned()))
                .when(m.user_id == me, |d| {
                    d.child(
                        div()
                            .text_color(t.subtle)
                            .child(format!("· {}", tr("native.space.you"))),
                    )
                })
        });
        let others: Vec<Member> = page
            .members
            .iter()
            .filter(|m| m.user_id != me)
            .cloned()
            .collect();
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
        let transfer = Select::new("space-transfer", label, move |_| {
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
        .width_range(ROLE_WIDTH, ROLE_WIDTH)
        .disabled(disabled || others.is_empty());
        let confirm = Button::new("space-transfer-confirm")
            .variant(ButtonVariant::OutlineDanger)
            .label(tr("native.space.transferAction"))
            .disabled(disabled || chosen.is_none())
            .on_click(cx.listener(move |s, _, _, cx| {
                let Some(user) = chosen.clone() else { return };
                s.space_page.transfer_to = None;
                s.change_space(
                    move |client, org| client.transfer_ownership(org, &user).map(|_| None),
                    cx,
                )
            }));
        SettingsSection::new(tr("settings.space.settings"))
            .child(
                v_flex()
                    .gap(px(6.))
                    .child(
                        SettingsList::new()
                            .lead(true)
                            .child(
                                SettingRow::new(tr("settings.space.name")).control(
                                    h_flex()
                                        .gap(px(8.))
                                        .child(div().w(px(220.)).child(page.name.clone()))
                                        .child(save),
                                ),
                            )
                            .children(owner.map(|owner| {
                                SettingRow::new(tr("settings.space.role.owner")).control(owner)
                            }))
                            .child(
                                SettingRow::new(tr("settings.space.transfer"))
                                    .control(h_flex().gap(px(8.)).child(transfer).child(confirm)),
                            ),
                    )
                    .child(SettingsNote::new(format!(
                        "{} {}",
                        tf(
                            "native.space.nameRule",
                            &[("count", Arg::Number(SPACE_NAME_MAX as i64))],
                        ),
                        tf(
                            "native.space.transferRule",
                            &[("space", name.clone().into())]
                        ),
                    )))
                    .children(self.failure()),
            )
            .into_any_element()
    }
}
