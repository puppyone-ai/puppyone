//! Experimental Home Space layouts:
//! - Scheme A (`HomeSpaceLayout::Arc`): Arc-style horizontal swipeable Spaces
//!   with subtle top ambient wash, quiet spatial title, floating bottom Space
//!   dock, subtle edge arrows, and all creation/import actions tucked behind a
//!   single quiet `+` menu.
//! - Scheme B (`HomeSpaceLayout::Tabs`): single-row pure-text editorial Space
//!   tabs with zero secondary toolbar — quiet `+` and combined View & Sort
//!   icons sit at the trailing end of the same row, with horizontal swipe and
//!   drag-to-publish built in.
use super::*;
use crate::{
    features::settings::{HomeSpaceLayout, HomepageLayout, HomepageSort},
    ui::motion::{Timeline, cubic_bezier},
};

const SPACE_SLIDE_DURATION: Duration = Duration::from_millis(280);
const SPACE_SLIDE_DISTANCE: f32 = 120.;
/// Deliberate horizontal two-finger swipe distance required to commit one Space switch.
const SWIPE_COMMIT_PX: f32 = 84.;
/// Movement distance after which the gesture locks to horizontal vs vertical scrolling.
const SWIPE_AXIS_LOCK_PX: f32 = 10.;
/// Cooldown for discrete non-trackpad mouse wheel horizontal ticks (`ScrollDelta::Lines`).
const LINE_WHEEL_COOLDOWN: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum SwipePhase {
    /// Not inside an active finger touch. On macOS, AppKit momentum events arrive
    /// after `TouchPhase::Ended` as `TouchPhase::Moved`; ignoring `Moved` while
    /// `Idle` makes momentum double-triggers impossible.
    #[default]
    Idle,
    /// Active finger touch tracking horizontal displacement.
    Tracking,
    /// Finger touch identified as vertical scrolling; ignored until fingers lift.
    LockedVertical,
    /// Already committed one Space switch during this physical finger touch.
    Committed,
}

/// Native macOS-grade two-finger horizontal swipe recognizer for Home Spaces.
#[derive(Clone, Debug, Default)]
pub(in crate::app::home) struct SpaceSwipeGesture {
    phase: SwipePhase,
    accum_x: f32,
    accum_y: f32,
    /// Damped live follow-finger offset shown while tracking before commit.
    preview_x: f32,
    line_cooldown_until: Option<Instant>,
}

impl SpaceSwipeGesture {
    /// Processes one scroll-wheel event and returns `(step, needs_notify)` where
    /// `step` is `Some(-1)` (previous Space) or `Some(1)` (next Space) at most
    /// ONCE per physical finger touch.
    pub fn on_wheel(
        &mut self,
        touch_phase: TouchPhase,
        delta: ScrollDelta,
        now: Instant,
    ) -> (Option<isize>, bool) {
        match delta {
            ScrollDelta::Lines(lines) => {
                // Discrete mouse tilt-wheel (no touch phases): strictly gated by cooldown.
                let (dx, dy) = (lines.x, lines.y);
                if dx.abs() < 1.0 || dx.abs() <= dy.abs() * 1.5 {
                    return (None, false);
                }
                if self.line_cooldown_until.is_some_and(|until| now < until) {
                    return (None, false);
                }
                self.line_cooldown_until = Some(now + LINE_WHEEL_COOLDOWN);
                let step = if dx < 0. { 1 } else { -1 };
                (Some(step), false)
            }
            ScrollDelta::Pixels(pixels) => {
                let (dx, dy) = (f32::from(pixels.x), f32::from(pixels.y));
                match touch_phase {
                    TouchPhase::Started => {
                        let had_preview = self.preview_x != 0.;
                        self.phase = SwipePhase::Tracking;
                        self.accum_x = 0.;
                        self.accum_y = 0.;
                        self.preview_x = 0.;
                        (None, had_preview)
                    }
                    TouchPhase::Ended | TouchPhase::Cancelled => {
                        let had_preview = self.preview_x != 0.;
                        self.phase = SwipePhase::Idle;
                        self.accum_x = 0.;
                        self.accum_y = 0.;
                        self.preview_x = 0.;
                        (None, had_preview)
                    }
                    TouchPhase::Moved => {
                        if self.phase != SwipePhase::Tracking {
                            // Idle (momentum tail), LockedVertical, or Committed -> ignore!
                            return (None, false);
                        }
                        self.accum_x += dx;
                        self.accum_y += dy;
                        let total = self.accum_x.abs() + self.accum_y.abs();
                        if total >= SWIPE_AXIS_LOCK_PX
                            && self.accum_y.abs() >= self.accum_x.abs() * 0.85
                        {
                            let had_preview = self.preview_x != 0.;
                            self.phase = SwipePhase::LockedVertical;
                            self.preview_x = 0.;
                            return (None, had_preview);
                        }
                        if self.accum_x.abs() >= SWIPE_COMMIT_PX {
                            let step = if self.accum_x < 0. { 1 } else { -1 };
                            self.phase = SwipePhase::Committed;
                            self.accum_x = 0.;
                            self.accum_y = 0.;
                            self.preview_x = 0.;
                            return (Some(step), true);
                        }
                        let next_preview = if self.accum_x.abs() > 8.
                            && self.accum_x.abs() > self.accum_y.abs() * 1.2
                        {
                            (self.accum_x * 0.32).clamp(-28., 28.)
                        } else {
                            0.
                        };
                        let changed = (next_preview - self.preview_x).abs() > 0.4;
                        self.preview_x = next_preview;
                        (None, changed)
                    }
                }
            }
        }
    }

    pub fn preview_offset(&self) -> f32 {
        self.preview_x
    }
}

fn is_local_group(id: &super::super::groups::GroupId) -> bool {
    use super::super::groups::GroupId;
    matches!(
        id,
        GroupId::LocalOnly | GroupId::LocalComputers | GroupId::PlainFolders
    )
}

/// The Space's tone index (`spaceMarkTone`), when the group is a Cloud Space.
/// Only the small dot and dock mark carry it; the page itself stays neutral.
fn group_tone(group: &super::super::groups::Group) -> Option<usize> {
    match &group.mark {
        Some(super::super::groups::Mark::Space(space)) => {
            Some(crate::workspace::cloud::spaces::mark_tone(&space.id) as usize)
        }
        _ => None,
    }
}

fn group_dot(group: &super::super::groups::Group, dark: bool) -> Option<Rgba> {
    group_tone(group).map(|tone| theme::space_dot(tone, dark))
}

fn space_dot(color: Rgba, size: f32, active: bool) -> Div {
    div()
        .flex_none()
        .size(px(size))
        .rounded_full()
        .bg(color)
        .opacity(if active { 1. } else { 0.72 })
}

impl Homepage {
    /// Resolves the active Space against the current `groups` list, falling
    /// back to the first group if the remembered selection disappeared.
    pub(in crate::app::home) fn resolve_active_group(
        &self,
        groups: &[super::super::groups::Group],
    ) -> Option<super::super::groups::GroupId> {
        if let Some(active) = &self.active_group
            && groups.iter().any(|g| &g.id == active)
        {
            return Some(active.clone());
        }
        groups.first().map(|g| g.id.clone())
    }

    /// Switches to `next` with a directional horizontal slide-in and smooth
    /// full-canvas atmosphere cross-fade.
    pub(in crate::app::home) fn select_group_animated(
        &mut self,
        groups: &[super::super::groups::Group],
        next: super::super::groups::GroupId,
        cx: &mut Context<Self>,
    ) {
        let prev = self.resolve_active_group(groups);
        if prev.as_ref() == Some(&next) {
            return;
        }
        let prev_canvas = self.home_palette(cx).canvas;
        let prev_idx = prev
            .as_ref()
            .and_then(|id| groups.iter().position(|g| &g.id == id));
        let next_idx = groups.iter().position(|g| g.id == next);
        let dir = match (prev_idx, next_idx) {
            (Some(a), Some(b)) if b > a => 1.,
            (Some(a), Some(b)) if b < a => -1.,
            _ => 0.,
        };
        self.active_group = Some(next);
        self.menu = None;
        self.scroll.scroll_to_top_of_item(0);
        if dir != 0. && !cx.reduce_motion() {
            self.space_slide = Some((Timeline::start(SPACE_SLIDE_DURATION), dir, prev_canvas));
        } else {
            self.space_slide = None;
        }
        cx.notify();
    }

    /// Steps left (`-1`) or right (`+1`) across the currently available Spaces.
    pub(in crate::app) fn step_active_space(&mut self, delta: isize, cx: &mut Context<Self>) {
        if self.session.busy || self.list_held() {
            return;
        }
        let items = self.visible_projects(cx);
        let groups = self.project_groups_now(items, cx);
        if groups.len() <= 1 {
            return;
        }
        let Some(active) = self.resolve_active_group(&groups) else {
            return;
        };
        let Some(idx) = groups.iter().position(|g| g.id == active) else {
            return;
        };
        let target = idx as isize + delta;
        if target < 0 || target >= groups.len() as isize {
            return;
        }
        let next = groups[target as usize].id.clone();
        self.select_group_animated(&groups, next, cx);
    }

    /// Native macOS two-finger horizontal swipe handler for Arc & Tabs layouts.
    pub(in crate::app::home) fn handle_space_swipe(
        &mut self,
        event: &ScrollWheelEvent,
        cx: &mut Context<Self>,
    ) {
        if !self.session.home || self.top_dialog(cx).is_some() {
            return;
        }
        let mode = self
            .preferences
            .read(cx)
            .state
            .experimental
            .home_space_layout;
        if mode == HomeSpaceLayout::Classic {
            return;
        }
        let (step, notify) = self
            .swipe
            .on_wheel(event.touch_phase, event.delta, Instant::now());
        if let Some(step) = step {
            self.step_active_space(step, cx);
        } else if notify {
            cx.notify();
        }
    }

    fn space_slide_frame(&mut self, window: &mut Window) -> (f32, f32) {
        let preview = self.swipe.preview_offset();
        let Some((timeline, dir, _)) = self.space_slide else {
            return (preview, 1.);
        };
        if timeline.finished() {
            self.space_slide = None;
            return (preview, 1.);
        }
        let eased = cubic_bezier(0.22, 1.0, 0.36, 1.0, timeline.time());
        window.request_animation_frame();
        let dx = dir * (1. - eased) * SPACE_SLIDE_DISTANCE + preview;
        let opacity = if dir == 0. { 1. } else { 0.22 + 0.78 * eased };
        (dx, opacity)
    }

    /// Quiet Space settings icon button for manageable Cloud Spaces.
    /// Project creation (including Agents, Open folder, Import) never sits in
    /// the top-right — it lives strictly inside the dashed `New project` tile.
    fn space_settings_button(
        &self,
        active: Option<&super::super::groups::Group>,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let space_id = active.and_then(|g| g.manage.clone())?;
        let t = self.home_palette(cx);
        Some(
            IconButton::new(
                "home-space-settings",
                Icon::new("settings").with_size(px(14.5)),
            )
            .debug_selector(|| "home-space-settings".into())
            .label(tr("home.menu.spaceSettings"))
            .tooltip(tr("home.menu.spaceSettings"))
            .color(t.subtle)
            .disabled(busy)
            .on_click(cx.listener(move |_, _, _, cx| {
                cx.emit(HomeEvent::ManageSpace(space_id.clone()));
            }))
            .into_any_element(),
        )
    }

    /// The dashed New project tile at the end of the Space's projects: the
    /// page's single creation CTA. Transparent inside (zero background fill),
    /// crisp 1px dashed outline matching the adjacent folder body's footprint
    /// (`92 × 62`, `6px` radius, bottom-aligned at `y = 76` in the `104 × 78`
    /// stage), one identical tone for both border and `+` (`t.text_disabled` at
    /// rest -> `t.subtle` on hover), and `New project` matching the page's
    /// secondary caption color (`t.subtle` -> `t.text` on hover).
    fn new_project_tile(
        &self,
        group: &super::super::groups::Group,
        grid: bool,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        const HOVER_ID: &str = "__home_new_project__";
        let t = self.home_palette(cx);
        let ty = theme::ty().ui;
        let computer_mode = crate::features::flags::computer_mode_enabled(&self.preferences, cx);
        let (_, label_key) = super::super::components::create_action(computer_mode);
        let label = tr(label_key);
        let group_id = group.id.clone();
        let lit = !busy && self.hovered.as_deref() == Some(HOVER_ID);
        // Border and `+` share one identical neutral tone matching folder weight;
        // zero background fill inside the dashed outline.
        let line_ink = if lit { t.subtle } else { t.text_disabled };
        let outline = |w: f32, h: f32, r: f32, plus: f32| {
            div()
                .flex_none()
                .w(px(w))
                .h(px(h))
                .rounded(px(r))
                .border_1()
                .border_dashed()
                .border_color(line_ink)
                .flex()
                .items_center()
                .justify_center()
                .child(Icon::new("plus").with_size(px(plus)).color(line_ink))
        };
        let base = div()
            .id("home-new-project")
            .debug_selector(|| "home-new-project".into())
            .w_full()
            .min_w_0()
            .text_color(if lit { t.text } else { t.subtle })
            .when(lit, |d| d.bg(t.hover))
            .when(busy, |d| d.opacity(0.58))
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                let next = hovered.then(|| HOVER_ID.to_owned());
                if s.hovered != next && (*hovered || s.hovered.as_deref() == Some(HOVER_ID)) {
                    s.hovered = next;
                    cx.notify();
                }
            }))
            .when(!busy, |d| {
                d.cursor(theme::clickable_cursor()).on_click(
                    cx.listener(move |s, _, w, cx| s.begin_new_project_in(group_id.clone(), w, cx)),
                )
            });
        if grid {
            base.rounded(px(metric::CARD_RADIUS))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(2.))
                .pt(px(10.))
                .pb(px(8.))
                .px(px(6.))
                .child(
                    div()
                        .mb(px(8.))
                        .w(px(104.))
                        .h(px(78.))
                        .pb(px(2.))
                        .flex()
                        .items_end()
                        .justify_center()
                        .child(outline(92., 62., 6., 16.)),
                )
                .child(
                    div()
                        .max_w_full()
                        .truncate()
                        .text_size(px(ty.body))
                        .line_height(px(18.))
                        .child(label),
                )
                // Keeps the tile as tall as its neighbours' caption line.
                .child(div().h(px(16.)))
                .into_any_element()
        } else {
            base.h(px(44.))
                .rounded(px(metric::CONTROL_RADIUS))
                .flex()
                .items_center()
                .gap(px(12.))
                .px(px(metric::MENU_ITEM_PADDING_INLINE))
                .child(
                    div()
                        .w(px(34.))
                        .h(px(26.))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(outline(30., 20., 4., 11.)),
                )
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(ty.body))
                        .line_height(px(18.))
                        .child(label),
                )
                .into_any_element()
        }
    }

    /// Quiet combined Layout (`Grid`/`List`) + Sort (`Modified`/`Name`) menu.
    fn space_view_menu(&self, busy: bool, cx: &mut Context<Self>) -> PopoverMenu {
        let t = self.home_palette(cx);
        let prefs = &self.preferences.read(cx).state;
        let (sort, layout) = (prefs.homepage_project_sort, prefs.homepage_project_layout);
        let open = self.menu == Some(HomeMenu::SpaceView) && !busy;
        let host = self.weak.clone();
        let prefs_handle = self.preferences.clone();
        let icon = Icon::new(match layout {
            HomepageLayout::List => "list",
            HomepageLayout::Grid => "layout-grid",
        })
        .with_size(px(14.5));

        let trigger = IconButton::new("home-space-view", icon)
            .debug_selector(|| "home-space-view".into())
            .label(tr("home.menu.viewOptions"))
            .tooltip(tr("home.menu.viewOptions"))
            .selected(open)
            .color(if open { t.text } else { t.subtle })
            .disabled(busy);

        PopoverMenu::new("home-space-view-popover")
            .anchor(Anchor::TopRight)
            .offset(px(metric::MENU_PADDING))
            .open(open)
            .on_open_change(move |opened_now, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    let is = s.menu == Some(HomeMenu::SpaceView);
                    if *opened_now != is {
                        s.menu = opened_now.then_some(HomeMenu::SpaceView);
                        cx.notify();
                    }
                });
            })
            .trigger(trigger)
            .menu(move |surface, _, _| {
                let layout_items = [HomepageLayout::Grid, HomepageLayout::List].map(|opt| {
                    let p = prefs_handle.clone();
                    let label = tr(match opt {
                        HomepageLayout::Grid => "onboarding.projects.layout.grid",
                        HomepageLayout::List => "onboarding.projects.layout.list",
                    });
                    let icon = Icon::new(match opt {
                        HomepageLayout::Grid => "layout-grid",
                        HomepageLayout::List => "list",
                    })
                    .with_size(px(14.5));
                    checked_item(
                        MenuItem::new(label).icon_sized(icon).radio(layout == opt),
                        layout == opt,
                    )
                    .on_click(move |_, cx| {
                        p.update(cx, |p, cx| {
                            p.change(|p| p.homepage_project_layout = opt, cx)
                        })
                    })
                });
                let sort_items = [HomepageSort::Modified, HomepageSort::Name].map(|opt| {
                    let p = prefs_handle.clone();
                    let label = tr(match opt {
                        HomepageSort::Modified => "onboarding.projects.sort.modified",
                        HomepageSort::Name => "onboarding.projects.sort.name",
                    });
                    checked_item(MenuItem::new(label).radio(sort == opt), sort == opt).on_click(
                        move |_, cx| {
                            p.update(cx, |p, cx| p.change(|p| p.homepage_project_sort = opt, cx))
                        },
                    )
                });
                surface
                    .min_w(px(156.))
                    .keyboard_navigation()
                    .items(layout_items)
                    .separator()
                    .items(sort_items)
            })
    }

    /// Scheme A (`Arc`) floating bottom Space Switcher dock (no edge arrows).
    /// Also stays visible while signed out so users on This Mac have a quiet,
    /// direct Cloud sign-in entry right in the dock.
    pub(in crate::app::home) fn arc_overlays(
        &mut self,
        groups: &[super::super::groups::Group],
        active: Option<&super::super::groups::GroupId>,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        use super::super::groups::DropAction;
        let can_sign_in = crate::features::flags::account_available(cx)
            && crate::features::cloud::account::status(cx)
                != Some(crate::cloud::auth::Status::Restoring)
            && !crate::features::cloud::account::has_account(cx);
        if groups.len() <= 1 && !can_sign_in {
            return vec![];
        }
        let t = self.home_palette(cx);
        let ty = theme::ty().ui;
        let mut overlays = Vec::with_capacity(1);

        // Bottom floating Arc Space Switcher Dock.
        let dragging = groups.iter().any(|g| g.drop.is_some());
        let mut dock_items: Vec<AnyElement> = Vec::with_capacity(groups.len() + 3);
        let mut prev_local: Option<bool> = None;
        let groups_snapshot: Vec<super::super::groups::Group> = groups.to_vec();

        if groups.is_empty() {
            // Empty signed-out Home still shows the active local place on the
            // left of the dock beside the Cloud sign-in guidance.
            let local_label =
                tr(crate::platform::conventions::Conventions::current().this_computer_label_key);
            dock_items.push(
                div()
                    .id("home-arc-dock-local-empty")
                    .debug_selector(|| "home-arc-dock:local-only".into())
                    .flex_none()
                    .h(px(28.))
                    .px(px(11.))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .bg(t.selected)
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .font_weight(FontWeight::NORMAL)
                    .text_color(t.text)
                    .child(
                        Icon::product(ProductIcon::Local)
                            .with_size(px(13.))
                            .stroke(1.75)
                            .color(t.text),
                    )
                    .child(div().flex_none().child(local_label))
                    .into_any_element(),
            );
        }

        for (index, group) in groups.iter().enumerate() {
            let local_now = is_local_group(&group.id);
            if let Some(was_local) = prev_local
                && was_local != local_now
            {
                dock_items.push(
                    div()
                        .flex_none()
                        .w(px(1.))
                        .h(px(12.))
                        .mx(px(3.))
                        .bg(t.divider)
                        .into_any_element(),
                );
            }
            prev_local = Some(local_now);

            let id = group.id.clone();
            let is_active = active == Some(&id);
            let available = group.drop.as_ref().is_some_and(|d| d.enabled);
            let over = available && self.drop_over.as_ref() == Some(&id);
            let drop_action = group.drop.clone().filter(|d| d.enabled).map(|d| d.action);

            let lead: Option<AnyElement> = if local_now {
                Some(
                    Icon::product(ProductIcon::Local)
                        .with_size(px(13.))
                        .stroke(1.75)
                        .color(if is_active { t.text } else { t.subtle })
                        .into_any_element(),
                )
            } else if let Some(color) = group_dot(group, t.dark) {
                Some(space_dot(color, 6., is_active || available).into_any_element())
            } else if matches!(group.mark, Some(super::super::groups::Mark::Space(_))) {
                None
            } else {
                Some(
                    Icon::new("monitor")
                        .with_size(px(13.))
                        .stroke(1.75)
                        .color(if is_active { t.text } else { t.subtle })
                        .into_any_element(),
                )
            };

            let text_color = if available {
                t.accent
            } else if is_active {
                t.text
            } else {
                t.subtle
            };
            let bg_color: Hsla = if over {
                theme::alpha(t.accent, 0.16).into()
            } else if is_active {
                t.selected.into()
            } else {
                transparent_black()
            };
            let click_id = id.clone();
            let drag_id = id.clone();
            let groups_for_click = groups_snapshot.clone();
            let key = id.key();

            dock_items.push(
                div()
                    .id(("home-arc-dock-item", index))
                    .debug_selector(move || format!("home-arc-dock:{key}"))
                    .flex_none()
                    .h(px(28.))
                    .px(px(11.))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .bg(bg_color)
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .font_weight(FontWeight::NORMAL)
                    .text_color(text_color)
                    .when(dragging && !available && !is_active, |d| d.opacity(0.4))
                    .when(!busy, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| {
                                if is_active || over {
                                    s
                                } else {
                                    s.bg(t.hover).text_color(t.muted)
                                }
                            })
                            .on_click(cx.listener(move |s, _, _, cx| {
                                s.select_group_animated(&groups_for_click, click_id.clone(), cx);
                            }))
                    })
                    .children(lead)
                    .child(div().flex_none().child(group.title.clone()))
                    .on_drag_move::<ProjectDrag>(cx.listener(
                        move |s, event: &DragMoveEvent<ProjectDrag>, _, cx| {
                            let inside = event.bounds.contains(&event.event.position);
                            if inside && available && s.drop_over.as_ref() != Some(&drag_id) {
                                s.drop_over = Some(drag_id.clone());
                                cx.notify();
                            } else if !inside && s.drop_over.as_ref() == Some(&drag_id) {
                                s.drop_over = None;
                                cx.notify();
                            }
                        },
                    ))
                    .when_some(drop_action, |d, action| {
                        d.on_drop(cx.listener(move |s, drag: &ProjectDrag, _, cx| {
                            s.drop_over = None;
                            s.dragging_path = None;
                            match &action {
                                DropAction::Publish { space } => {
                                    cx.emit(HomeEvent::PublishToSpace {
                                        path: PathBuf::from(&drag.path),
                                        space: space.clone(),
                                    })
                                }
                                DropAction::ShareDevices => cx.emit(HomeEvent::ShareFolder {
                                    path: PathBuf::from(&drag.path),
                                }),
                            }
                            cx.notify();
                        }))
                    })
                    .into_any_element(),
            );
        }

        // Trailing `+` on dock to create a new Cloud Space when signed in,
        // or a quiet Cloud sign-in pill when signed out.
        let can_create_space = crate::features::flags::cloud_enabled(&self.preferences, cx)
            && crate::features::cloud::account::has_account(cx);
        if can_create_space {
            dock_items.push(
                div()
                    .flex_none()
                    .w(px(1.))
                    .h(px(12.))
                    .mx(px(3.))
                    .bg(t.divider)
                    .into_any_element(),
            );
            dock_items.push(
                div()
                    .id("home-arc-dock-new-space")
                    .debug_selector(|| "home-arc-dock-new-space".into())
                    .flex_none()
                    .size(px(28.))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(t.subtle)
                    .tooltip(crate::ui::components::tooltip(tr("settings.space.create")))
                    .when(!busy, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(t.hover).text_color(t.text))
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(HomeEvent::CreateSpace)))
                    })
                    .child(Icon::new("plus").with_size(px(13.5)).stroke(1.75))
                    .into_any_element(),
            );
        } else if can_sign_in {
            dock_items.push(
                div()
                    .flex_none()
                    .w(px(1.))
                    .h(px(12.))
                    .mx(px(3.))
                    .bg(t.divider)
                    .into_any_element(),
            );
            dock_items.push(
                div()
                    .id("home-arc-dock-sign-in")
                    .debug_selector(|| "home-arc-dock-sign-in".into())
                    .flex_none()
                    .h(px(28.))
                    .px(px(11.))
                    .rounded_full()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_size(px(ty.caption))
                    .line_height(px(16.))
                    .font_weight(FontWeight::NORMAL)
                    .text_color(t.muted)
                    .tooltip(crate::ui::components::tooltip(tr(
                        "cloud.auth.signInToCloud",
                    )))
                    .when(!busy, |d| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.bg(t.hover).text_color(t.text))
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(HomeEvent::SignIn)))
                    })
                    .child(
                        Icon::product(ProductIcon::Cloud)
                            .with_size(px(13.))
                            .stroke(1.75),
                    )
                    .child(div().flex_none().child(tr("home.dock.signInCloud")))
                    .into_any_element(),
            );
        }

        overlays.push(
            div()
                .absolute()
                .left_0()
                .right_0()
                .bottom(px(20.))
                .flex()
                .justify_center()
                .child(
                    h_flex()
                        .id("home-arc-dock")
                        .debug_selector(|| "home-arc-dock".into())
                        .occlude()
                        .items_center()
                        .gap(px(4.))
                        .children(dock_items),
                )
                .into_any_element(),
        );

        overlays
    }

    /// Scheme A (`Arc`) spatial top bar: the Space's dot and name on the
    /// left, a quiet `⋯` and View/Sort on the right. No create button here:
    /// the dashed New project tile in the grid is the one way in.
    fn arc_head(
        &self,
        active: Option<&super::super::groups::Group>,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = self.home_palette(cx);
        let title = active.map(|g| g.title.clone()).unwrap_or_default();
        let dot = active.and_then(|g| group_dot(g, t.dark));
        let heading = h_flex()
            .min_w_0()
            .items_center()
            .gap(px(9.))
            .children(dot.map(|c| space_dot(c, 7., true)))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(theme::font_size(18.)))
                    .line_height(px(24.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.text)
                    .child(title),
            );

        let hide_view = self
            .preferences
            .read(cx)
            .state
            .experimental
            .hide_home_view_controls;
        h_flex()
            .debug_selector(|| "home-arc-head".into())
            .flex_none()
            .w_full()
            .h(px(34.))
            .items_center()
            .justify_between()
            .mb(px(24.))
            .child(div().min_w_0().child(heading))
            .child(
                h_flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .children(self.space_settings_button(active, busy, cx))
                    .when(!hide_view, |d| d.child(self.space_view_menu(busy, cx))),
            )
            .into_any_element()
    }

    /// Scheme B (`Tabs`) single-row editorial header: pure-text Space tabs on
    /// the left, quiet `+` and View/Sort icons on the right — zero secondary
    /// toolbar, zero descriptions, zero right-side text.
    fn minimal_tabs_row(
        &mut self,
        groups: &[super::super::groups::Group],
        active: Option<&super::super::groups::GroupId>,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use super::super::groups::DropAction;
        let t = self.home_palette(cx);
        let ty = theme::ty().ui;
        let active_group = active.and_then(|id| groups.iter().find(|g| &g.id == id));
        let show_tabs = groups.len() > 1;
        let dragging = groups.iter().any(|g| g.drop.is_some());
        let groups_snapshot = groups.to_vec();

        let mut tab_els: Vec<AnyElement> = Vec::with_capacity(groups.len() + 1);
        if show_tabs {
            let mut prev_local: Option<bool> = None;
            for (index, group) in groups.iter().enumerate() {
                let local_now = is_local_group(&group.id);
                if let Some(was_local) = prev_local
                    && was_local != local_now
                {
                    tab_els.push(
                        div()
                            .flex_none()
                            .w(px(1.))
                            .h(px(11.))
                            .bg(t.divider)
                            .into_any_element(),
                    );
                }
                prev_local = Some(local_now);

                let id = group.id.clone();
                let is_active = active == Some(&id);
                let available = group.drop.as_ref().is_some_and(|d| d.enabled);
                let over = available && self.drop_over.as_ref() == Some(&id);
                let drop_action = group.drop.clone().filter(|d| d.enabled).map(|d| d.action);

                let dot =
                    group_dot(group, t.dark).map(|c| space_dot(c, 5.5, is_active || available));
                let text_color = if available {
                    t.accent
                } else if is_active {
                    t.text
                } else {
                    t.subtle
                };
                let hover_color = if available {
                    t.accent
                } else if is_active {
                    t.text
                } else {
                    t.muted
                };
                let click_id = id.clone();
                let drag_id = id.clone();
                let groups_for_click = groups_snapshot.clone();
                let key = id.key();

                tab_els.push(
                    div()
                        .id(("home-space-tab", index))
                        .debug_selector(move || format!("home-space-tab:{key}"))
                        .relative()
                        .flex_none()
                        .h(px(38.))
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .text_size(px(ty.meta))
                        .line_height(px(18.))
                        .font_weight(FontWeight::NORMAL)
                        .text_color(text_color)
                        .when(dragging && !available && !is_active, |d| d.opacity(0.42))
                        .when(over, |d| {
                            d.px(px(8.))
                                .mx(px(-8.))
                                .rounded(px(6.))
                                .bg(theme::alpha(t.accent, 0.12))
                        })
                        .when(!busy, |d| {
                            d.cursor(theme::clickable_cursor())
                                .hover(move |s| s.text_color(hover_color))
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.select_group_animated(
                                        &groups_for_click,
                                        click_id.clone(),
                                        cx,
                                    );
                                }))
                        })
                        .children(dot)
                        .child(div().flex_none().child(group.title.clone()))
                        .when(is_active && !over, |d| {
                            d.child(
                                div()
                                    .absolute()
                                    .left_0()
                                    .right_0()
                                    .bottom_0()
                                    .h(px(1.5))
                                    .rounded(px(1.))
                                    .bg(t.text),
                            )
                        })
                        .on_drag_move::<ProjectDrag>(cx.listener(
                            move |s, event: &DragMoveEvent<ProjectDrag>, _, cx| {
                                let inside = event.bounds.contains(&event.event.position);
                                if inside && available && s.drop_over.as_ref() != Some(&drag_id) {
                                    s.drop_over = Some(drag_id.clone());
                                    cx.notify();
                                } else if !inside && s.drop_over.as_ref() == Some(&drag_id) {
                                    s.drop_over = None;
                                    cx.notify();
                                }
                            },
                        ))
                        .when_some(drop_action, |d, action| {
                            d.on_drop(cx.listener(move |s, drag: &ProjectDrag, _, cx| {
                                s.drop_over = None;
                                s.dragging_path = None;
                                match &action {
                                    DropAction::Publish { space } => {
                                        cx.emit(HomeEvent::PublishToSpace {
                                            path: PathBuf::from(&drag.path),
                                            space: space.clone(),
                                        })
                                    }
                                    DropAction::ShareDevices => cx.emit(HomeEvent::ShareFolder {
                                        path: PathBuf::from(&drag.path),
                                    }),
                                }
                                cx.notify();
                            }))
                        })
                        .into_any_element(),
                );
            }
        }

        let hide_view = self
            .preferences
            .read(cx)
            .state
            .experimental
            .hide_home_view_controls;
        h_flex()
            .id("home-space-tabs")
            .debug_selector(|| "home-space-tabs".into())
            .flex_none()
            .w_full()
            .min_w_0()
            .h(px(38.))
            .items_center()
            .justify_between()
            .gap(px(12.))
            .when(show_tabs, |d| d.border_b_1().border_color(t.divider))
            .mb(px(22.))
            .child(
                h_flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(22.))
                    .children(tab_els),
            )
            .child(
                h_flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .children(self.space_settings_button(active_group, busy, cx))
                    .when(!hide_view, |d| d.child(self.space_view_menu(busy, cx))),
            )
            .into_any_element()
    }

    /// Unified composition for both experimental Space modes (`Arc` and `Tabs`).
    #[allow(clippy::too_many_arguments)]
    pub(in crate::app::home) fn render_space_home(
        &mut self,
        mode: HomeSpaceLayout,
        groups: Vec<super::super::groups::Group>,
        note: Option<AnyElement>,
        held: bool,
        width: f32,
        viewport_w: f32,
        narrow: bool,
        busy: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if held {
            let since = self.list_held_since.or(self.spaces_wait);
            let shown =
                since.is_some_and(|since| since.elapsed() >= std::time::Duration::from_millis(120));
            if !shown {
                window.request_animation_frame();
            }
            return div()
                .w(px(width))
                .flex_1()
                .min_h_0()
                .flex()
                .items_center()
                .justify_center()
                .when(shown, |d| {
                    d.child(
                        crate::ui::loading::LoadingMark::new("home-projects-loading")
                            .area()
                            .size(crate::ui::loading::LoaderSize::Md)
                            .tone(crate::ui::loading::Tone::Neutral)
                            .label(tr("common.status.loading")),
                    )
                })
                .into_any_element();
        }

        let _ = self.settle_place_focus(&groups, cx);
        let active_id = self.resolve_active_group(&groups);
        let active_ref = active_id
            .as_ref()
            .and_then(|id| groups.iter().find(|g| &g.id == id));

        let top_bar = match mode {
            HomeSpaceLayout::Arc => self.arc_head(active_ref, busy, cx),
            HomeSpaceLayout::Tabs => self.minimal_tabs_row(&groups, active_id.as_ref(), busy, cx),
            HomeSpaceLayout::Classic => div().into_any_element(),
        };

        let active_owned = groups
            .into_iter()
            .find(|g| active_id.as_ref() == Some(&g.id));
        let (slide_dx, slide_opacity) = self.space_slide_frame(window);

        let t = self.home_palette(cx);
        let layout = self.preferences.read(cx).state.homepage_project_layout;
        let grid = layout == HomepageLayout::Grid;
        let columns = if grid { GRID_COLUMNS } else { 1 };
        let col_gap = grid_column_gap(viewport_w);
        let cell_w = grid_cell_width(width, col_gap);
        let bottom_pad = if mode == HomeSpaceLayout::Arc {
            92.
        } else {
            44.
        };

        let content = active_owned.map(|group| {
            self.active_space_projects(group, columns, col_gap, cell_w, narrow, busy, window, cx)
        });

        let list = div()
            .id("home-projects")
            .w(px(width + SCROLLBAR_SIZE))
            .min_h_0()
            .flex_shrink(1.)
            .pt(px(2.))
            .pb(px(bottom_pad))
            .pr(px(SCROLLBAR_SIZE))
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .on_hover(cx.listener(|s, hovered: &bool, _, cx| {
                if !*hovered && s.hovered.take().is_some() {
                    cx.notify();
                }
            }))
            .flex()
            .flex_col()
            .gap(px(16.))
            .children(content.map(|view| {
                div().w(px(width)).overflow_hidden().child(
                    div()
                        .w(px(width))
                        .ml(px(slide_dx))
                        .mr(px(-slide_dx))
                        .opacity(slide_opacity)
                        .child(view),
                )
            }))
            .children(note.map(|note| div().w(px(width)).child(note)));

        let scroller = div()
            .relative()
            .flex_1()
            .min_h_0()
            .w_full()
            .flex()
            .flex_col()
            .rounded(px(metric::CARD_RADIUS))
            .when(self.dragging, |d| d.bg(t.hover))
            .child(list)
            .child(crate::ui::scrollbar::vertical(
                "home-projects-scrollbar",
                &self.scroll,
            ));

        if mode == HomeSpaceLayout::Arc {
            // Slide the whole Space (title + folders) together as one unified spatial canvas.
            v_flex()
                .w(px(width))
                .flex_1()
                .min_h_0()
                .max_h_full()
                .child(
                    div()
                        .w(px(width))
                        .ml(px(slide_dx))
                        .mr(px(-slide_dx))
                        .opacity(slide_opacity)
                        .child(top_bar),
                )
                .child(scroller)
                .into_any_element()
        } else {
            v_flex()
                .w(px(width))
                .flex_1()
                .min_h_0()
                .max_h_full()
                .child(top_bar)
                .child(scroller)
                .into_any_element()
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn active_space_projects(
        &mut self,
        group: super::super::groups::Group,
        columns: usize,
        col_gap: f32,
        cell_w: f32,
        narrow: bool,
        busy: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use super::super::{
            folder::ComputerKind,
            groups::{GroupId, Mark},
        };
        let t = self.home_palette(cx);
        let layout = self.preferences.read(cx).state.homepage_project_layout;
        let grid = layout == HomepageLayout::Grid;
        let id = group.id.clone();
        let computer_mode = crate::features::flags::computer_mode_enabled(&self.preferences, cx);
        let plain = id == GroupId::PlainFolders;
        let look = match &id {
            GroupId::Space(_) | GroupId::SharedUnresolved if computer_mode => {
                Look::Computer(ComputerKind::Cloud)
            }
            GroupId::LocalComputers => Look::Computer(ComputerKind::OnDevice),
            GroupId::PlainFolders if grid => Look::Plain,
            _ => Look::Folder,
        };
        let (columns, col_gap, cell_w, row_gap) = if plain && grid {
            let width = cell_w * columns as f32 + col_gap * (columns as f32 - 1.);
            let count = (((width + 8.) / 198.).floor() as usize).max(1);
            let cell = (width - 8. * (count as f32 - 1.)) / count as f32;
            (count, 8., cell, 8.)
        } else {
            (columns, col_gap, cell_w, CELL_ROW_GAP)
        };

        let ids: Vec<String> = group.items.iter().map(|i| i.id.clone()).collect();
        let list = std::rc::Rc::new(ids.clone());
        let stop = self.project_stop(&group.items);
        let mut cells = Vec::with_capacity(group.items.len());
        for (position, item) in group.items.iter().enumerate() {
            let index = self.cell_index(&item.id);
            self.action_bounds.entry(item.id.clone()).or_default();
            self.list_of.insert(item.id.clone(), list.clone());
            let lit = self.project_lit(item, window, cx);
            let is_stop = stop.as_deref() == Some(item.id.as_str());
            let focus = self.project_focus(&item.id, window, cx).tab_stop(is_stop);
            let keys = {
                let host = self.weak.clone();
                let ids = ids.clone();
                let open = item.clone();
                move |event: &KeyDownEvent, window: &mut Window, cx: &mut App| {
                    let key = event.keystroke.key.as_str();
                    let key = match key {
                        "up" | "down" | "left" | "right" | "home" | "end" => key,
                        "enter" | "space" => {
                            let _ = host.update(cx, |s, cx| s.open_item(&open, cx));
                            cx.stop_propagation();
                            return;
                        }
                        _ => return,
                    };
                    cx.stop_propagation();
                    let Some(target) =
                        key_target(key, position, ids.len().saturating_sub(1), columns, false)
                    else {
                        return;
                    };
                    let _ = host.update(cx, |s, cx| {
                        let id = ids[target].clone();
                        s.stop = Some(id.clone());
                        if let Some(handle) = s.focus.get(&id) {
                            handle.focus(window, cx);
                        }
                        cx.notify();
                    });
                }
            };
            cells.push(if grid {
                self.project_tile(
                    index, item, focus, cell_w, lit, is_stop, busy, look, keys, cx,
                )
            } else {
                self.project_row(
                    index, item, focus, lit, is_stop, narrow, busy, look, keys, cx,
                )
            });
        }

        let writable = id != GroupId::OtherComputers
            && match &group.mark {
                Some(Mark::Space(s)) => s.can_create_projects,
                _ => true,
            };
        // The dashed New project tile closes every writable Space's list.
        if writable {
            cells.push(self.new_project_tile(&group, grid, busy, cx));
        }

        let content = if cells.is_empty() {
            // A Space that takes no new projects and has none: its name, quietly.
            v_flex()
                .w_full()
                .py(px(72.))
                .items_center()
                .justify_center()
                .child(
                    div()
                        .text_size(px(theme::ty().ui.caption))
                        .text_color(t.subtle)
                        .child(group.title.clone()),
                )
                .into_any_element()
        } else if grid {
            let mut cells = cells.into_iter().peekable();
            let mut rows = Vec::new();
            while cells.peek().is_some() {
                rows.push(
                    h_flex().items_start().gap(px(col_gap)).children(
                        cells
                            .by_ref()
                            .take(columns)
                            .map(|cell| div().w(px(cell_w)).flex_none().child(cell)),
                    ),
                );
            }
            v_flex().gap(px(row_gap)).children(rows).into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .children(cells)
                .into_any_element()
        };

        let key = id.key();
        div()
            .id("home-active-group")
            .debug_selector(move || format!("home-group:{key}"))
            .w_full()
            .child(content)
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn px_delta(x: f32, y: f32) -> ScrollDelta {
        ScrollDelta::Pixels(point(px(x), px(y)))
    }

    #[test]
    fn one_swipe_with_long_macos_momentum_switches_at_most_once() {
        let mut g = SpaceSwipeGesture::default();
        let now = Instant::now();
        // Fingers touch trackpad.
        assert_eq!(
            g.on_wheel(TouchPhase::Started, px_delta(0., 0.), now).0,
            None
        );
        // Active swipe crosses threshold (-84px -> next space).
        assert_eq!(
            g.on_wheel(TouchPhase::Moved, px_delta(-40., 0.), now).0,
            None
        );
        assert!(g.preview_offset() < 0., "shows follow-finger preview");
        assert_eq!(
            g.on_wheel(TouchPhase::Moved, px_delta(-50., 0.), now).0,
            Some(1)
        );
        assert_eq!(g.preview_offset(), 0.);
        // Continued finger drag during the same touch never commits a second space.
        assert_eq!(
            g.on_wheel(TouchPhase::Moved, px_delta(-120., 0.), now).0,
            None
        );
        // Fingers lift.
        assert_eq!(g.on_wheel(TouchPhase::Ended, px_delta(0., 0.), now).0, None);
        // Long macOS momentum tail arrives as TouchPhase::Moved -> strictly ignored!
        for _ in 0..10 {
            assert_eq!(
                g.on_wheel(
                    TouchPhase::Moved,
                    px_delta(-60., 0.),
                    now + Duration::from_secs(1)
                )
                .0,
                None
            );
        }
        // Only a brand-new finger touch can switch again.
        assert_eq!(
            g.on_wheel(
                TouchPhase::Started,
                px_delta(0., 0.),
                now + Duration::from_secs(2)
            )
            .0,
            None
        );
        assert_eq!(
            g.on_wheel(
                TouchPhase::Moved,
                px_delta(90., 0.),
                now + Duration::from_secs(2)
            )
            .0,
            Some(-1)
        );
    }

    #[test]
    fn small_nudge_or_vertical_scroll_never_switches_spaces() {
        let mut g = SpaceSwipeGesture::default();
        let now = Instant::now();
        // Small accidental nudge (< 84px) snaps back on Ended without switching.
        g.on_wheel(TouchPhase::Started, px_delta(0., 0.), now);
        assert_eq!(
            g.on_wheel(TouchPhase::Moved, px_delta(-35., 0.), now).0,
            None
        );
        assert_eq!(
            g.on_wheel(TouchPhase::Ended, px_delta(0., 0.), now),
            (None, true)
        );
        assert_eq!(g.preview_offset(), 0.);

        // Diagonal/vertical scroll locks vertical for the whole touch.
        g.on_wheel(TouchPhase::Started, px_delta(0., 0.), now);
        assert_eq!(
            g.on_wheel(TouchPhase::Moved, px_delta(-12., -20.), now).0,
            None
        );
        assert_eq!(
            g.on_wheel(TouchPhase::Moved, px_delta(-120., 0.), now).0,
            None
        );
    }
}
