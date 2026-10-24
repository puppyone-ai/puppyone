//! Port of the activity renderers: `AgentActivityShell`, `AgentToolActivityGroup`
//! (the tool rail: one disclosure open at a time), `AgentToolGlyph`, the evidence
//! tree (`AgentToolEvidenceTree/Node`, `AgentToolTextEvidence`), the Command,
//! FileChange, FileQuery and Generic tool renderers, reasoning, plan, the
//! context divider and `AgentRunFeedback`, with `styles/activities.css`.
use super::super::super::domain::{
    agent_activity_presentation::{
        self as presentation, ActivityStatus, Glyph, Renderer, ToolName,
    },
    agent_timeline::{
        RAIL_GAP, RAIL_GROUP_INSET, RAIL_ITEM, RAIL_OVERFLOW, Row, rail_visible_count,
    },
    agent_tool_evidence,
};
use super::agent_theme::AgentTheme;
use super::*;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Icon, tooltip};
use crate::{
    agent::domain::agent_session_model::Message,
    localization::{t as tr, tf},
    theme,
};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

/// `--agent-evidence-*` geometry.
const EVIDENCE_ROW: f32 = 26.;
const EVIDENCE_ELBOW: f32 = 14.;
const EVIDENCE_GAP: f32 = 6.;
const TOOL_ICON: f32 = 18.;
const ROW_PADDING: f32 = 4.;
/// `--agent-evidence-rail-inline`: row padding + half the icon.
const EVIDENCE_RAIL_INLINE: f32 = ROW_PADDING + TOOL_ICON / 2.;
/// `AgentToolGlyph` frames are 18 units drawn at 16px.
const GLYPH: f32 = 16.;
const GLYPH_UNIT: f32 = GLYPH / 18.;

pub(super) fn mono_size() -> f32 {
    theme::ty().right.code
}

/// Piecewise keyframes with ease-in-out per segment: (time, x, y, opacity).
fn keyframes(delta: f32, frames: &[(f32, f32, f32, f32)]) -> (f32, f32, f32) {
    let delta = delta.clamp(0., 1.);
    for pair in frames.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if delta <= b.0 {
            let span = (b.0 - a.0).max(f32::EPSILON);
            let p = ease_in_out((delta - a.0) / span);
            return (
                a.1 + (b.1 - a.1) * p,
                a.2 + (b.2 - a.2) * p,
                a.3 + (b.3 - a.3) * p,
            );
        }
    }
    let last = frames[frames.len() - 1];
    (last.1, last.2, last.3)
}

/// `AgentToolGlyph`: provider-neutral glyphs; active search/read/edit/write
/// glyphs move while the tool runs (no second spinner).
pub(super) fn tool_glyph(
    id: impl Into<SharedString>,
    tool: &str,
    active: bool,
    color: Rgba,
) -> AnyElement {
    let id: SharedString = id.into();
    let layer = |path: &'static str| {
        svg()
            .path(path)
            .absolute()
            .top_0()
            .left_0()
            .size(px(GLYPH))
            .text_color(color)
    };
    let frame = || div().relative().size(px(GLYPH)).flex_shrink_0();
    let lucide = |name: &str| Icon::new(name).stroke(1.85).color(color).into_any_element();
    let duration = |ms: u64| Animation::new(std::time::Duration::from_millis(ms)).repeat();
    match presentation::glyph(tool) {
        Glyph::Search if active => frame()
            .child(layer("icons/agent-glyph-search.svg").with_animation(
                ElementId::Name(format!("{id}-search").into()),
                duration(1_600),
                |g, delta| {
                    let (x, y, _) = keyframes(
                        delta,
                        &[
                            (0., 0., 0., 1.),
                            (0.12, 0., 0., 1.),
                            (0.3, 1., -0.8, 1.),
                            (0.48, 1.35, 0.5, 1.),
                            (0.66, 0., 1., 1.),
                            (0.8, -0.85, 0.15, 1.),
                            (0.88, 0., 0., 1.),
                            (1., 0., 0., 1.),
                        ],
                    );
                    g.with_transformation(Transformation::translate(point(
                        px(x * GLYPH_UNIT),
                        px(y * GLYPH_UNIT),
                    )))
                },
            ))
            .into_any_element(),
        Glyph::Search => frame()
            .child(layer("icons/agent-glyph-search.svg"))
            .into_any_element(),
        Glyph::Read => frame()
            .child(layer("icons/agent-glyph-read.svg"))
            .when(active, |d| {
                d.child(layer("icons/agent-glyph-read-scan.svg").with_animation(
                    ElementId::Name(format!("{id}-read").into()),
                    duration(1_550),
                    |scan, delta| {
                        let (_, y, opacity) = keyframes(
                            delta,
                            &[
                                (0., 0., 0., 0.),
                                (0.15, 0., 0., 0.),
                                (0.25, 0., 0., 0.72),
                                (0.72, 0., 4., 0.72),
                                (0.82, 0., 4., 0.),
                                (0.9, 0., 0., 0.),
                                (1., 0., 0., 0.),
                            ],
                        );
                        scan.with_transformation(Transformation::translate(point(
                            px(0.),
                            px(y * GLYPH_UNIT),
                        )))
                        .opacity(opacity)
                    },
                ))
            })
            .into_any_element(),
        glyph @ (Glyph::Edit | Glyph::Write) => {
            let edit = glyph == Glyph::Edit;
            if !active {
                return frame()
                    .child(layer(if edit {
                        "icons/agent-glyph-edit.svg"
                    } else {
                        "icons/agent-glyph-write.svg"
                    }))
                    .into_any_element();
            }
            frame()
                .child(layer(if edit {
                    "icons/agent-glyph-edit-base.svg"
                } else {
                    "icons/agent-glyph-write-base.svg"
                }))
                .child(layer("icons/agent-glyph-ink.svg").with_animation(
                    ElementId::Name(format!("{id}-ink").into()),
                    duration(1_500),
                    |ink, delta| {
                        let (_, _, opacity) = keyframes(
                            delta,
                            &[
                                (0., 0., 0., 0.35),
                                (0.15, 0., 0., 0.35),
                                (0.64, 0., 0., 0.82),
                                (0.88, 0., 0., 0.82),
                                (1., 0., 0., 0.35),
                            ],
                        );
                        ink.opacity(opacity)
                    },
                ))
                .child(layer("icons/agent-glyph-pen.svg").with_animation(
                    ElementId::Name(format!("{id}-pen").into()),
                    duration(1_500),
                    |pen, delta| {
                        let (x, y, _) = keyframes(
                            delta,
                            &[
                                (0., 0., 0., 1.),
                                (0.15, 0., 0., 1.),
                                (0.38, -1., 0.75, 1.),
                                (0.62, 0.65, -0.45, 1.),
                                (0.78, -0.3, 0.25, 1.),
                                (0.88, 0., 0., 1.),
                                (1., 0., 0., 1.),
                            ],
                        );
                        pen.with_transformation(Transformation::translate(point(
                            px(x * GLYPH_UNIT),
                            px(y * GLYPH_UNIT),
                        )))
                    },
                ))
                .into_any_element()
        }
        Glyph::Command => lucide("square-terminal"),
        Glyph::Fetch => lucide("globe-2"),
        Glyph::List { tree: true } => lucide("list-tree"),
        Glyph::List { tree: false } => lucide("folder-search"),
        Glyph::Generic => lucide("wrench"),
    }
}

/// `AgentActivityShell` `StatusIcon`: nothing while running or once completed.
fn status_icon(status: &str, a: &AgentTheme, t: &Theme) -> Option<AnyElement> {
    let (name, color) = match presentation::activity_status(status) {
        ActivityStatus::Running | ActivityStatus::Completed => return None,
        ActivityStatus::Failed => ("circle-alert", t.danger),
        ActivityStatus::Stopped => ("circle-slash-2", a.text_subtle),
        ActivityStatus::Waiting | ActivityStatus::Unknown => ("circle", a.text_subtle),
    };
    Some(
        Icon::new(name)
            .xsmall()
            .stroke(2.)
            .color(color)
            .into_any_element(),
    )
}

fn running(status: &str) -> bool {
    matches!(
        presentation::activity_status(status),
        ActivityStatus::Running
    )
}

/// `formatAgentToolName` of the tool the part presents as.
pub(super) fn tool_title(message: &Message) -> String {
    let tool = match presentation::renderer(message) {
        Renderer::Command => presentation::command_tool(&presentation::command(message)).to_owned(),
        _ => presentation::tool_id(&message.role),
    };
    match presentation::tool_name(&tool) {
        ToolName::Key(key) => tr(key).into(),
        ToolName::Literal(text) => text,
    }
}

/// `AgentToolTextEvidence`: bounded monospace text (head … marker … tail).
fn text_evidence(text: &str, a: &AgentTheme) -> AnyElement {
    let preview = agent_tool_evidence::preview(text);
    let visible = if preview.truncated {
        let marker = tf(
            "agent.activity.outputOmitted",
            &[
                ("lines", (preview.omitted_lines as i64).into()),
                ("characters", (preview.omitted_chars as i64).into()),
            ],
        );
        [
            preview.head.as_str(),
            marker.as_ref(),
            preview.tail.as_str(),
        ]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
    } else {
        preview.head
    };
    div()
        .relative()
        .min_w_0()
        .py(px(4.))
        .child(
            div()
                .id(SharedString::from(format!(
                    "evidence-{:x}",
                    blake3::hash(text.as_bytes()).as_bytes()[0..8]
                        .iter()
                        .fold(0u64, |h, b| h << 8 | *b as u64)
                )))
                .max_h(px(260.))
                .overflow_scroll()
                .font_family(theme::MONO)
                .text_size(px(mono_size()))
                .line_height(px(mono_size() * 1.5))
                .text_color(a.text_muted)
                .whitespace_nowrap()
                .child(visible),
        )
        .into_any_element()
}

/// `AgentToolEvidenceNode`: elbow rail, optional marker, content.
fn evidence_node(
    marker: Option<&'static str>,
    content: AnyElement,
    last: bool,
    a: &AgentTheme,
) -> Div {
    let center = EVIDENCE_ROW / 2.;
    div()
        .relative()
        .flex()
        .items_start()
        .min_w_0()
        .min_h(px(EVIDENCE_ROW))
        .child(
            div()
                .absolute()
                .top(px(-1.))
                .left_0()
                .w(px(EVIDENCE_ELBOW))
                .h(px(center + 1.))
                .border_l_1()
                .border_b_1()
                .border_color(a.evidence_rail)
                .rounded_bl(px(5.)),
        )
        .when(!last, |d| {
            d.child(
                div()
                    .absolute()
                    .top(px(center))
                    .bottom(px(-1.))
                    .left_0()
                    .border_l_1()
                    .border_color(a.evidence_rail),
            )
        })
        .child(div().w(px(EVIDENCE_ELBOW + EVIDENCE_GAP)).flex_shrink_0())
        .when_some(marker, |d, marker| {
            d.child(
                div()
                    .w(px(TOOL_ICON))
                    .h(px(EVIDENCE_ROW))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .font_family(theme::MONO_MEDIUM)
                    .text_size(px(mono_size()))
                    .text_color(a.text_muted)
                    .child(marker),
            )
            .child(div().w(px(EVIDENCE_GAP)).flex_shrink_0())
        })
        .child(
            div()
                .flex_1()
                .min_w_0()
                .min_h(px(EVIDENCE_ROW))
                .text_color(a.text_muted)
                .child(content),
        )
}

fn evidence_tree(nodes: Vec<(Option<&'static str>, AnyElement)>, a: &AgentTheme) -> AnyElement {
    let count = nodes.len();
    v_flex()
        .min_w_0()
        .py(px(2.))
        .pl(px(EVIDENCE_RAIL_INLINE))
        .font_family(theme::MONO)
        .text_size(px(mono_size()))
        .line_height(px(mono_size() * 1.5))
        .children(
            nodes
                .into_iter()
                .enumerate()
                .map(|(i, (marker, content))| evidence_node(marker, content, i + 1 == count, a)),
        )
        .into_any_element()
}

/// `SearchResults` (FileQuery for grep/glob/search/list).
fn search_results(output: &str, a: &AgentTheme) -> AnyElement {
    let (lines, omitted) = agent_tool_evidence::result_lines(output, 80);
    let line_height = mono_size() * 1.45;
    let mut list = v_flex()
        .id(SharedString::from(format!("results-{}", output.len())))
        .min_w_0()
        .max_h(px(260.))
        .overflow_y_scroll()
        .font_family(theme::MONO)
        .text_size(px(mono_size()))
        .line_height(px(line_height));
    if lines.is_empty() {
        list = list.child(
            div()
                .text_size(px(theme::ty().left.meta))
                .italic()
                .text_color(a.text_subtle)
                .child(tr("agent.activity.noResults")),
        );
    }
    for line in lines {
        list = list.child(
            div()
                .px(px(5.))
                .py(px(2.))
                .rounded(px(4.))
                .text_color(a.text_muted)
                .truncate()
                .child(line),
        );
    }
    if omitted > 0 {
        list = list.child(
            div()
                .p(px(5.))
                .font_family("Geist")
                .text_size(px(theme::ty().left.meta))
                .text_color(a.text_subtle)
                .child(tf(
                    "agent.activity.moreResults",
                    &[
                        ("count", (omitted as i64).into()),
                        ("value", (omitted as i64).into()),
                    ],
                )),
        );
    }
    list.into_any_element()
}

/// The evidence a tool renderer shows once disclosed; `None` → nothing to disclose.
pub(super) fn tool_evidence(message: &Message, a: &AgentTheme) -> Option<AnyElement> {
    let output = message.text.trim();
    match presentation::renderer(message) {
        Renderer::Command => {
            let command = presentation::command(message);
            let mut nodes = vec![];
            if !command.is_empty() {
                nodes.push((Some("$"), text_evidence(&command, a)));
            }
            if !output.is_empty() {
                nodes.push((None, text_evidence(output, a)));
            }
            (!nodes.is_empty()).then(|| evidence_tree(nodes, a))
        }
        Renderer::FileChange => {
            let changes = presentation::file_changes(message);
            let mut nodes: Vec<(Option<&'static str>, AnyElement)> = vec![];
            for change in &changes {
                nodes.push((
                    None,
                    div()
                        .min_h(px(EVIDENCE_ROW))
                        .flex()
                        .items_center()
                        .truncate()
                        .child(change.path.clone())
                        .into_any_element(),
                ));
                for (removed, added) in &change.blocks {
                    if let Some(removed) = removed {
                        nodes.push((Some("−"), text_evidence(removed, a)));
                    }
                    if let Some(added) = added {
                        nodes.push((Some("+"), text_evidence(added, a)));
                    }
                }
                if change.blocks.is_empty() && !change.diff.is_empty() {
                    nodes.push((None, text_evidence(&change.diff, a)));
                }
            }
            let summary_only = message.role == "File changes";
            if !output.is_empty() && !summary_only {
                nodes.push((None, text_evidence(output, a)));
            }
            (!nodes.is_empty()).then(|| evidence_tree(nodes, a))
        }
        Renderer::FileQuery => {
            if output.is_empty() {
                return None;
            }
            let tool = presentation::tool_id(&message.role);
            let content = if matches!(tool.as_str(), "grep" | "glob" | "search" | "list") {
                search_results(output, a)
            } else {
                text_evidence(output, a)
            };
            Some(evidence_tree(vec![(None, content)], a))
        }
        Renderer::Generic => {
            let input = presentation::structured_input(message);
            let mut nodes = vec![];
            if let Some(input) = &input {
                nodes.push((None, text_evidence(input, a)));
            }
            if !output.is_empty() {
                nodes.push((None, text_evidence(output, a)));
            }
            (!nodes.is_empty()).then(|| evidence_tree(nodes, a))
        }
    }
}

/// `desktop-agent-tool-diff-stats`: `+12 −3` beside a file-change title.
fn diff_stats(message: &Message, a: &AgentTheme) -> Option<AnyElement> {
    if presentation::renderer(message) != Renderer::FileChange {
        return None;
    }
    let (added, removed) = presentation::file_change_totals(&presentation::file_changes(message))?;
    Some(
        h_flex()
            .gap(px(5.))
            .flex_shrink_0()
            .text_size(px(theme::ty().left.content))
            .child(
                div()
                    .text_color(a.diff_added_text)
                    .child(format!("+{added}")),
            )
            .child(
                div()
                    .text_color(a.diff_removed_text)
                    .child(format!("−{removed}")),
            )
            .into_any_element(),
    )
}

/// `.desktop-agent-tool-branch` holding an evidence tree: no rail of its own.
fn evidence_branch(content: AnyElement) -> Div {
    div()
        .mt(px(1.))
        .mb(px(2.))
        .mr(px(4.))
        .min_w_0()
        .child(content)
}

/// `.desktop-agent-tool-branch` for prose (reasoning, plan): a 2px rail.
fn prose_branch(content: AnyElement, a: &AgentTheme) -> Div {
    div()
        .mt(px(1.))
        .mb(px(4.))
        .ml(px(11.))
        .mr(px(4.))
        .py(px(4.))
        .pl(px(17.))
        .border_l_2()
        .border_color(a.border_subtle)
        .min_w_0()
        .child(content)
}

impl AgentChat {
    /// `AgentToolActivityGroup`: a one-line rail of 28px tool items, a `+N`
    /// overflow slot, and a single shared detail host (one item open at a time).
    pub(super) fn render_tool_group(
        &mut self,
        timeline_row: &Row,
        width: f32,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let row_id = timeline_row.id.clone();
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let messages = &self.session.snapshot().messages;
        let parts: Vec<Message> = timeline_row
            .parts
            .iter()
            .filter_map(|&i| messages.get(i).cloned())
            .collect();
        let visible_count = rail_visible_count(parts.len(), width);
        let selected = self.rail_selected.get(&row_id).cloned();
        let overflow_open = self.rail_overflow.contains(&row_id);
        let mut rail = h_flex()
            .w_full()
            .min_w_0()
            .gap(px(RAIL_GAP))
            .overflow_hidden();
        for (index, part) in parts.iter().take(visible_count).enumerate() {
            let is_selected = selected.as_deref() == Some(part.id.as_str());
            let has_detail = tool_evidence(part, &a).is_some();
            let title = tool_title(part);
            let active = running(&part.status);
            let click_row = row_id.clone();
            let part_id = part.id.clone();
            let group = SharedString::from(format!("rail-{}-{index}", row_id));
            let color = if active { a.tool_active } else { a.tool_action };
            let item = div()
                .id(SharedString::from(format!(
                    "rail-item-{}-{}",
                    row_id, part.id
                )))
                .group(group.clone())
                .relative()
                .size(px(RAIL_ITEM))
                .flex_shrink_0()
                .rounded(px(6.))
                .when(is_selected, |d| d.bg(a.row_hover))
                .when(has_detail, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(move |s| s.bg(a.row_hover))
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.rail_overflow.remove(&click_row);
                            if s.rail_selected.get(&click_row) == Some(&part_id) {
                                s.rail_selected.remove(&click_row);
                            } else {
                                s.rail_selected.insert(click_row.clone(), part_id.clone());
                            }
                            s.splice_row(&click_row);
                            cx.notify();
                        }))
                })
                .tooltip(tooltip(title))
                .child(
                    div()
                        .absolute()
                        .left(px(ROW_PADDING))
                        .top(px((RAIL_ITEM - TOOL_ICON) / 2.))
                        .size(px(TOOL_ICON))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(color)
                        .child(tool_glyph(
                            format!("{}-{}", row_id, part.id),
                            &presentation::presented_tool(part),
                            active,
                            color,
                        )),
                )
                .children(
                    status_icon(&part.status, &a, &t)
                        .map(|icon| div().absolute().right_0().bottom_0().child(icon)),
                );
            rail = rail.child(item);
        }
        let hidden: Vec<Message> = parts.iter().skip(visible_count).cloned().collect();
        if !hidden.is_empty() {
            let row_id = row_id.clone();
            let label: SharedString = tf(
                "agent.activity.moreTools",
                &[
                    ("count", (hidden.len() as i64).into()),
                    ("value", (hidden.len() as i64).into()),
                ],
            )
            .into();
            rail = rail.child(
                gpui_kit::base::Button::new(SharedString::from(format!(
                    "rail-overflow-{}",
                    row_id
                )))
                .accessibility_label(label)
                .w(px(RAIL_OVERFLOW))
                .h(px(RAIL_ITEM))
                .flex_shrink_0()
                .rounded(px(6.))
                .text_size(px(theme::ty().left.meta))
                .text_color(if overflow_open { a.text } else { a.text_subtle })
                .when(overflow_open, |b| b.bg(a.row_hover))
                .cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(a.row_hover).text_color(a.text))
                .child(format!("+{}", hidden.len()))
                .on_click(cx.listener(move |s, _, _, cx| {
                    s.rail_selected.remove(&row_id);
                    if !s.rail_overflow.remove(&row_id) {
                        s.rail_overflow.insert(row_id.clone());
                    }
                    s.splice_row(&row_id);
                    cx.notify();
                })),
            );
        }
        let mut group = v_flex()
            .w_full()
            .min_w_0()
            .mx(px(RAIL_GROUP_INSET / 2.))
            .mb(px(8.))
            .child(rail);
        if overflow_open && !hidden.is_empty() {
            let mut panel = v_flex()
                .mt(px(2.))
                .mr(px(4.))
                .mb(px(4.))
                .ml(px(11.))
                .py(px(3.))
                .pl(px(10.))
                .border_l_1()
                .border_color(a.border_subtle);
            for part in &hidden {
                panel = panel.child(self.render_tool_shell(part, &row_id, cx));
            }
            group = group.child(panel);
        }
        if let Some(part) =
            selected.and_then(|id| parts.iter().take(visible_count).find(|p| p.id == id))
            && let Some(evidence) = tool_evidence(part, &a)
        {
            group = group.child(evidence_branch(evidence));
        }
        group.into_any_element()
    }

    /// Standalone `AgentActivityShell` row for a tool (the overflow panel).
    fn render_tool_shell(
        &mut self,
        part: &Message,
        row_id: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let key = format!("{row_id}:{}", part.id);
        let expanded = self.expanded.contains(&key);
        let evidence = tool_evidence(part, &a);
        let active = running(&part.status);
        let color = if active { a.tool_active } else { a.tool_action };
        let shell = self.shell_header(
            SharedString::from(format!("shell-{key}")),
            Some(tool_glyph(
                format!("shell-{key}"),
                &presentation::presented_tool(part),
                active,
                color,
            )),
            tool_title(part),
            FontWeight::NORMAL,
            diff_stats(part, &a),
            status_icon(&part.status, &a, &t),
            evidence.is_some(),
            key.clone(),
            row_id.to_owned(),
            false,
            cx,
        );
        v_flex()
            .min_w_0()
            .child(shell)
            .when_some(evidence.filter(|_| expanded), |d, e| {
                d.child(evidence_branch(e))
            })
            .into_any_element()
    }

    /// `.desktop-agent-tool-row`: icon, name, metadata, status; a disclosure
    /// when the activity has detail.
    #[allow(clippy::too_many_arguments)]
    fn shell_header(
        &mut self,
        id: SharedString,
        icon: Option<AnyElement>,
        title: String,
        weight: FontWeight,
        metadata: Option<AnyElement>,
        status: Option<AnyElement>,
        has_detail: bool,
        key: String,
        splice: String,
        fit: bool,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let m = theme::ty();
        let group = SharedString::from(format!("{id}-group"));
        h_flex()
            .id(id)
            .group(group.clone())
            .when(!fit, |d| d.w_full())
            .min_w_0()
            .min_h(px(theme::control()))
            .px(px(ROW_PADDING))
            .gap(px(6.))
            .rounded(px(6.))
            .text_size(px(m.left.content))
            .line_height(px(m.left.line_height))
            .text_color(a.tool_action)
            .when(has_detail, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(a.row_hover).text_color(a.text))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if !s.expanded.remove(&key) {
                            s.expanded.insert(key.clone());
                        }
                        s.splice_row(&splice);
                        cx.notify();
                    }))
            })
            .children(icon.map(|icon| {
                div()
                    .size(px(TOOL_ICON))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon)
            }))
            .child(
                div()
                    .flex_shrink_0()
                    .font_weight(weight)
                    .whitespace_nowrap()
                    .child(title),
            )
            .children(metadata)
            .child(div().flex_1().min_w_0())
            .children(status)
    }

    /// `AgentReasoningActivity`: "Thought briefly"/"Thought for …", no icon,
    /// italic summary disclosed on demand.
    pub(super) fn render_reasoning(
        &mut self,
        message: &Message,
        row_id: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let key = format!("{row_id}:{}", message.id);
        let expanded = self.expanded.contains(&key);
        let header = self
            .shell_header(
                SharedString::from(format!("reasoning-{}", message.id)),
                None,
                tr("agent.activity.thoughtBriefly").into(),
                FontWeight::MEDIUM,
                None,
                status_icon(&message.status, &a, &t),
                true,
                key,
                row_id.to_owned(),
                true,
                cx,
            )
            .text_color(a.text_muted);
        v_flex()
            .mx(px(4.))
            .mt(px(1.))
            .mb(px(4.))
            .min_w_0()
            .opacity(0.92)
            .child(h_flex().child(header))
            .when(expanded, |d| {
                d.child(prose_branch(
                    div()
                        .id(SharedString::from(format!("reasoning-copy-{}", message.id)))
                        .max_h(px(220.))
                        .overflow_y_scroll()
                        .text_size(px(theme::ty().left.content))
                        .line_height(px(theme::ty().left.content * 1.55))
                        .italic()
                        .text_color(a.text_muted)
                        .whitespace_normal()
                        .child(message.text.trim().to_owned())
                        .into_any_element(),
                    &a,
                ))
            })
            .into_any_element()
    }

    /// `AgentPlanActivity`: "Plan" with the plan text, open while it runs.
    pub(super) fn render_plan(
        &mut self,
        message: &Message,
        row_id: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let a = AgentTheme::new(&t);
        let key = format!("{row_id}:{}", message.id);
        let expanded = self.expanded.contains(&key) != running(&message.status);
        let header = self.shell_header(
            SharedString::from(format!("plan-{}", message.id)),
            Some(
                Icon::new("list-todo")
                    .with_size(px(13.))
                    .stroke(2.)
                    .color(a.tool_action)
                    .into_any_element(),
            ),
            tr("agent.tool.plan").into(),
            FontWeight::NORMAL,
            None,
            status_icon(&message.status, &a, &t),
            !message.text.trim().is_empty(),
            key,
            row_id.to_owned(),
            false,
            cx,
        );
        v_flex()
            .mx(px(4.))
            .mb(px(8.))
            .min_w_0()
            .child(header)
            .when(expanded && !message.text.trim().is_empty(), |d| {
                d.child(prose_branch(
                    div()
                        .text_size(px(theme::ty().left.content))
                        .text_color(a.text_muted)
                        .whitespace_normal()
                        .child(message.text.trim().to_owned())
                        .into_any_element(),
                    &a,
                ))
            })
            .into_any_element()
    }
}

/// `.desktop-agent-context-divider`: a rule on both sides of a small label.
pub(super) fn context_divider(label: SharedString, a: &AgentTheme) -> AnyElement {
    let rule = || div().flex_1().min_w(px(18.)).h(px(1.)).bg(a.border_subtle);
    h_flex()
        .mt(px(5.))
        .mx(px(4.))
        .mb(px(8.))
        .gap(px(10.))
        .text_color(a.text_subtle)
        .child(rule())
        .child(
            div()
                .text_size(px(theme::ty().left.meta))
                .line_height(px(theme::ty().right.meta_line_height))
                .font_weight(FontWeight(450.))
                .child(label),
        )
        .child(rule())
        .into_any_element()
}

/// `DotsLoader size="xs"`: three 3px dots bouncing 2px, staggered 160ms.
pub(super) fn dots(id: impl Into<SharedString>, color: Rgba) -> AnyElement {
    let id: SharedString = id.into();
    let mut row = h_flex().gap(px(3.)).flex_shrink_0();
    for index in 0..3u32 {
        row = row.child(div().size(px(3.)).rounded_full().bg(color).with_animation(
            ElementId::Name(format!("{id}-dot-{index}").into()),
            Animation::new(std::time::Duration::from_millis(1_200)).repeat(),
            move |dot, delta| {
                // `puppy-dot-bounce`: 0/80/100% rest at 35%, 40% peak, offset by the stagger.
                let phase = (delta - index as f32 * 0.16 / 1.2).rem_euclid(1.);
                let (_, y, opacity) = keyframes(
                    phase,
                    &[
                        (0., 0., 0., 0.35),
                        (0.4, 0., -2., 1.),
                        (0.8, 0., 0., 0.35),
                        (1., 0., 0., 0.35),
                    ],
                );
                dot.opacity(opacity).mt(px(y)).mb(px(-y))
            },
        ));
    }
    row.into_any_element()
}

/// `AgentRunFeedback`: meta label (and dots while busy) at the content inset.
pub(super) fn run_feedback(label: SharedString, busy: Option<SharedString>, a: &AgentTheme) -> Div {
    h_flex()
        .min_h(px(theme::ty().right.meta_line_height))
        .gap(px(7.))
        .px(px(12.))
        .text_size(px(theme::ty().left.meta))
        .line_height(px(theme::ty().right.meta_line_height))
        .text_color(a.text_subtle)
        .whitespace_nowrap()
        .child(div().min_w_0().truncate().child(label))
        .children(busy.map(|id| dots(id, a.loader)))
}
