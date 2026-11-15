//! `HomepageAgentBrandMark` and `HomepageAgentStrip` (`HomepageAgentStrip.tsx`
//! and `.onboarding-agent-strip` in `styles/onboarding.css`).
use super::super::discovery::{
    HomepageCloudAgent, HomepageLocalAgent, format_cloud_agent_activity,
};
use crate::{
    app::cloud_agents_ui::compact_agent_face,
    localization::{bidi_isolate, t as tr, tf},
    theme::{self, metric},
    ui::{
        agent_brands,
        appearance::ActiveAppearance as _,
        components::{Icon, ProductIcon, tooltip},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{base::h_flex, component::Sizable as _};
use std::{rc::Rc, time::SystemTime};

/// `HomepageAgentBrandMark`: compact optical brand mark (`18×18` in the strip,
/// `20×20` / `28×28` / `16×16` in `AgentProjectStartDialog`). Only `chatgpt`
/// and `codex` draw monochrome in `ink`; every other brand renders through
/// [`agent_brands::image`] so its optical scale (`0.84` Claude/Cursor, `1.28`
/// Pi, `1.3` OpenCode, `0.82` Hermes) matches `<AgentBrandImage />` 1:1.
#[derive(IntoElement)]
pub(in crate::app::home) struct HomepageAgentBrandMark {
    icon_key: Option<SharedString>,
    label: SharedString,
    size: f32,
    radius: f32,
    ink: Option<Rgba>,
}

impl HomepageAgentBrandMark {
    pub fn new(icon_key: Option<&str>, label: impl Into<SharedString>) -> Self {
        Self {
            icon_key: icon_key.map(|k| SharedString::from(k.to_owned())),
            label: label.into(),
            size: 18.,
            radius: 4.,
            ink: None,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = radius;
        self
    }

    pub fn ink(mut self, ink: Rgba) -> Self {
        self.ink = Some(ink);
        self
    }
}

impl RenderOnce for HomepageAgentBrandMark {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let ink = self.ink.unwrap_or(t.text);
        let brand = self
            .icon_key
            .as_deref()
            .and_then(agent_brands::get)
            .or_else(|| {
                agent_brands::resolve(None, self.icon_key.as_deref(), Some(self.label.as_ref()))
            });
        if let Some(brand) = brand {
            let monochrome_path = matches!(brand.id, "chatgpt" | "codex")
                .then(|| agent_brands::monochrome(brand))
                .flatten();
            let artwork: AnyElement = match monochrome_path {
                Some(path) => svg()
                    .path(path)
                    .size(px(self.size))
                    .text_color(ink)
                    .into_any_element(),
                None => agent_brands::image(brand, t.dark, self.size).into_any_element(),
            };
            return div()
                .size(px(self.size))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .overflow_hidden()
                .rounded(px(self.radius))
                .text_color(ink)
                .child(artwork);
        }
        let initials: String = self
            .label
            .split_whitespace()
            .take(2)
            .filter_map(|word| word.chars().next())
            .flat_map(char::to_uppercase)
            .collect();
        let initials = if initials.is_empty() {
            "A".to_owned()
        } else {
            initials
        };
        div()
            .size(px(self.size))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .rounded(px(self.radius))
            .bg(theme::alpha(ink, 0.12))
            .text_color(ink)
            .text_size(px(theme::ty().ui.caption))
            .font_weight(FontWeight::SEMIBOLD)
            .line_height(px(self.size))
            .child(initials)
    }
}

type StartAgentHandler = Rc<dyn Fn(HomepageLocalAgent, &mut Window, &mut App)>;
type ConnectAgentHandler = Rc<dyn Fn(&mut Window, &mut App)>;

/// `HomepageAgentStrip`: compact `28×28` brand marks for local Agents, Cloud
/// Agents in the personal Space, and `+` (`Settings -> Local Agents`).
///
/// Sits at the trailing end of [`super::OnboardingBrandLockup`] (`justify_between`
/// WITHOUT `.ml_auto()`, avoiding Taffy's double-`free_space` bug) and wraps
/// the Agent groups in a shrinkable horizontal scroll track so narrow windows
/// or many installed Agents never overflow the `760px` column or hide `+`.
#[derive(IntoElement)]
pub(in crate::app::home) struct HomepageAgentStrip {
    local: Vec<HomepageLocalAgent>,
    cloud: Vec<HomepageCloudAgent>,
    busy: bool,
    on_start: Option<StartAgentHandler>,
    on_connect: Option<ConnectAgentHandler>,
}

impl HomepageAgentStrip {
    pub fn new(local: Vec<HomepageLocalAgent>, cloud: Vec<HomepageCloudAgent>, busy: bool) -> Self {
        Self {
            local,
            cloud,
            busy,
            on_start: None,
            on_connect: None,
        }
    }

    pub fn on_start(
        mut self,
        handler: impl Fn(HomepageLocalAgent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_start = Some(Rc::new(handler));
        self
    }

    pub fn on_connect(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_connect = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for HomepageAgentStrip {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let size = theme::control_compact();
        let busy = self.busy;
        let now = SystemTime::now();
        let on_start = self.on_start;

        let local_group = (!self.local.is_empty()).then(|| {
            let tiles = self.local.iter().enumerate().map(|(idx, agent)| {
                let isolated = bidi_isolate(&agent.label);
                let start = tf("onboarding.agents.start", &[("agent", isolated.into())]);
                let headline = if on_start.is_some() {
                    start.clone()
                } else {
                    agent.label.clone()
                };
                let tip = if agent.connected {
                    format!("{headline} · {}", tr("onboarding.agents.connected"))
                } else {
                    headline
                };
                let runtime_id = agent.runtime_id.clone();
                let agent_clone = agent.clone();
                let disabled = busy || on_start.is_none();
                let ink = if disabled { t.text_disabled } else { t.text };
                let on_start = on_start.clone();
                div()
                    .id(("home-local-agent", idx))
                    .debug_selector(move || format!("home-agent:{runtime_id}"))
                    .relative()
                    .size(px(size))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(metric::CONTROL_RADIUS))
                    .border_1()
                    .border_color(t.border_subtle)
                    .bg(t.panel_raised)
                    .text_color(ink)
                    .when(disabled, |d| d.opacity(0.6))
                    .when_some(on_start.filter(|_| !busy), |d, handler| {
                        d.cursor(theme::clickable_cursor())
                            .hover(move |s| s.border_color(t.border).bg(t.hover))
                            .on_click(move |_, w, cx| handler(agent_clone.clone(), w, cx))
                    })
                    .tooltip(tooltip(tip))
                    .child(
                        HomepageAgentBrandMark::new(Some(&agent.icon_key), agent.label.clone())
                            .ink(ink),
                    )
                    .when(agent.connected, |d| {
                        // `.onboarding-agent-connected`: 6px dot with 1.5px canvas ring.
                        d.child(
                            div()
                                .absolute()
                                .right(px(-1.5))
                                .bottom(px(-1.5))
                                .size(px(9.))
                                .rounded_full()
                                .bg(t.canvas)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(div().size(px(6.)).rounded_full().bg(t.success)),
                        )
                    })
            });
            h_flex()
                .debug_selector(|| "home-agent-group:local".into())
                .flex_none()
                .items_center()
                .gap(px(4.))
                .children(tiles)
        });

        let sep = (!self.local.is_empty() && !self.cloud.is_empty()).then(|| {
            div()
                .w(px(1.))
                .h(px(14.))
                .mx(px(3.))
                .flex_none()
                .bg(t.divider)
        });

        let cloud_group = (!self.cloud.is_empty()).then(|| {
            let cloud_label = tr("onboarding.agents.cloud");
            let place_mark = div()
                .id("home-agent-cloud-mark")
                .w(px(20.))
                .h(px(size))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .text_color(t.subtle)
                .tooltip(tooltip(cloud_label))
                .child(
                    Icon::product(ProductIcon::Cloud)
                        .with_size(px(13.))
                        .stroke(1.85)
                        .color(t.subtle),
                );
            let faces = self.cloud.iter().enumerate().map(|(idx, agent)| {
                let last_active = format_cloud_agent_activity(agent.last_active_at.as_deref(), now);
                let tip = match last_active {
                    Some(time) => {
                        let isolated = bidi_isolate(&agent.name);
                        tf(
                            "onboarding.agents.lastActive",
                            &[("agent", isolated.into()), ("time", time.into())],
                        )
                    }
                    None => agent.name.clone(),
                };
                let agent_id = agent.id.clone();
                div()
                    .id(("home-cloud-agent", idx))
                    .debug_selector(move || format!("home-cloud-agent:{agent_id}"))
                    .size(px(size))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(metric::CONTROL_RADIUS))
                    .border_1()
                    .border_color(t.border_subtle)
                    .bg(t.panel_raised)
                    .text_color(t.text)
                    .tooltip(tooltip(tip))
                    .child(compact_agent_face(
                        &agent.name,
                        agent.avatar.as_deref(),
                        18.,
                        4.,
                        t.panel_raised,
                        t,
                    ))
            });
            h_flex()
                .debug_selector(|| "home-agent-group:cloud".into())
                .flex_none()
                .items_center()
                .gap(px(4.))
                .child(place_mark)
                .children(faces)
        });

        let has_agents = !self.local.is_empty() || !self.cloud.is_empty();
        let track = has_agents.then(|| {
            div()
                .id("home-agent-strip-track")
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(4.))
                .overflow_x_scroll()
                // Keep a 2px pad around tiles so the 1.5px connected ring is never clipped.
                .py(px(2.))
                .my(px(-2.))
                .pr(px(2.))
                .mr(px(-2.))
                .children(local_group)
                .children(sep)
                .children(cloud_group)
        });

        let connect = self.on_connect.map(|on_connect| {
            let connect_label = tr("onboarding.agents.connect");
            div()
                .id("home-agent-connect")
                .debug_selector(|| "home-agent-connect".into())
                .size(px(size))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(metric::CONTROL_RADIUS))
                .text_color(if busy { t.text_disabled } else { t.muted })
                .when(busy, |d| d.opacity(0.6))
                .when(!busy, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(t.hover).text_color(t.text))
                        .on_click(move |_, w, cx| on_connect(w, cx))
                })
                .tooltip(tooltip(connect_label))
                .child(Icon::new("plus").small().stroke(1.85))
        });

        h_flex()
            .debug_selector(|| "home-agent-strip".into())
            .min_w_0()
            .items_center()
            .justify_end()
            .gap(px(4.))
            .children(track)
            .children(connect)
    }
}
