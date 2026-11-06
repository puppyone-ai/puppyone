//! The Agent panel's drawing vocabulary (`styles/activities.css`,
//! `styles/transcript.css`): `AgentToolGlyph`, `AgentActivityShell`'s row and
//! status icon, `AgentToolStepText`, the evidence tree
//! (`AgentToolEvidenceTree/Node`, `AgentToolTextEvidence`, search results),
//! `AgentPlanItem`, the context divider and `AgentRunFeedback`.
use super::super::activity::agent_activity_views::{
    AgentToolGlyphKind, EvidenceContent, EvidenceNode, EvidenceTone, PlanStep, StatusIcon,
    StepIcon, StepMetadata, StepSubject,
};
use super::super::agent_theme::AgentTheme;
use crate::features::desktop_agent::domain::agent_tool_evidence::{
    AGENT_TOOL_EVIDENCE_LIMITS, create_agent_tool_evidence_preview,
};
use crate::localization::{Arg, format_number, t, tf};
use crate::theme::{self, Theme};
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

/// Opens a workspace path from a transcript row.
pub(super) type OpenFile = std::rc::Rc<dyn Fn(String, &mut Window, &mut App)>;

/// `--agent-evidence-*` geometry.
pub const EVIDENCE_ROW: f32 = 26.;
const EVIDENCE_ELBOW: f32 = 14.;
const EVIDENCE_GAP: f32 = 6.;
pub const TOOL_ICON: f32 = 18.;
pub const ROW_PADDING: f32 = 4.;
/// `--agent-evidence-rail-inline`: row padding + half the icon.
pub const EVIDENCE_RAIL_INLINE: f32 = ROW_PADDING + TOOL_ICON / 2.;
/// `AgentToolGlyph` frames are 18 units drawn at 16px.
const GLYPH: f32 = 16.;
const GLYPH_UNIT: f32 = GLYPH / 18.;

pub fn mono_size() -> f32 {
    theme::ty().right.code
}

fn ease(t: f32) -> f32 {
    if t < 0.5 {
        2. * t * t
    } else {
        1. - (-2. * t + 2.).powi(2) / 2.
    }
}

/// Piecewise keyframes with ease-in-out per segment: (time, x, y, opacity).
fn keyframes(delta: f32, frames: &[(f32, f32, f32, f32)]) -> (f32, f32, f32) {
    let delta = delta.clamp(0., 1.);
    for pair in frames.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if delta <= b.0 {
            let span = (b.0 - a.0).max(f32::EPSILON);
            let p = ease((delta - a.0) / span);
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
pub fn tool_glyph(
    id: impl Into<SharedString>,
    kind: AgentToolGlyphKind,
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
    let lucide = |name: &str| {
        Icon::new(name)
            .with_size(px(15.))
            .stroke(1.85)
            .color(color)
            .into_any_element()
    };
    let duration = |ms: u64| Animation::new(std::time::Duration::from_millis(ms)).repeat();
    match kind {
        AgentToolGlyphKind::Search if active => frame()
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
        AgentToolGlyphKind::Search => frame()
            .child(layer("icons/agent-glyph-search.svg"))
            .into_any_element(),
        AgentToolGlyphKind::Read => frame()
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
        kind @ (AgentToolGlyphKind::Edit | AgentToolGlyphKind::Write) => {
            let edit = kind == AgentToolGlyphKind::Edit;
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
        AgentToolGlyphKind::Command => lucide("square-terminal"),
        AgentToolGlyphKind::Fetch => lucide("globe-2"),
        AgentToolGlyphKind::List { tree: true } => lucide("list-tree"),
        AgentToolGlyphKind::List { tree: false } => lucide("folder-search"),
        AgentToolGlyphKind::Generic => lucide("wrench"),
    }
}

/// The icon slot of a step line.
pub fn step_icon(
    id: impl Into<SharedString>,
    icon: StepIcon,
    failed: bool,
    a: &AgentTheme,
    t: &Theme,
) -> AnyElement {
    match icon {
        StepIcon::Glyph { kind, active } => {
            let color = if failed {
                t.danger
            } else if active {
                a.tool_active
            } else {
                a.tool_glyph
            };
            tool_glyph(id, kind, active, color)
        }
        StepIcon::Brain => Icon::new("brain")
            .with_size(px(13.))
            .stroke(2.)
            .color(a.tool_action)
            .into_any_element(),
        StepIcon::ListTodo => Icon::new("list-todo")
            .with_size(px(13.))
            .stroke(2.)
            .color(a.tool_action)
            .into_any_element(),
    }
}

/// `StatusIcon`.
pub fn status_icon_element(icon: &StatusIcon, a: &AgentTheme, t: &Theme) -> Option<AnyElement> {
    let (name, color) = match icon {
        StatusIcon::None => return None,
        StatusIcon::Failed { .. } => ("circle-alert", t.danger),
        StatusIcon::Completed { .. } => ("check", a.text_subtle),
        StatusIcon::Stopped { .. } => ("circle-slash-2", a.text_subtle),
        StatusIcon::Pending { .. } => ("circle", a.text_subtle),
    };
    Some(
        Icon::new(name)
            .with_size(px(12.))
            .stroke(2.)
            .color(color)
            .into_any_element(),
    )
}

/// `.desktop-agent-tool-row`: the glyph, the verb, what it acted on, the
/// facts, and the status.
#[allow(clippy::too_many_arguments)]
pub fn step_line(
    id: SharedString,
    icon: AnyElement,
    title: String,
    subject: Option<AnyElement>,
    metadata: Option<AnyElement>,
    status: Option<AnyElement>,
    has_detail: bool,
    active: bool,
    a: &AgentTheme,
) -> Stateful<Div> {
    let m = theme::ty();
    let a = *a;
    let group = SharedString::from(format!("{id}-group"));
    let name = div()
        .flex_none()
        .whitespace_nowrap()
        .text_color(a.tool_action)
        .group_hover(group.clone(), move |s| s.text_color(a.text))
        .child(title);
    // Live work reads as light passing over the step, not a spinner.
    let name = if active {
        name.with_animation(
            SharedString::from(format!("{id}-shimmer")),
            Animation::new(std::time::Duration::from_millis(1800)).repeat(),
            move |d, delta| {
                let wave = (delta * std::f32::consts::TAU).cos() * 0.5 + 0.5;
                d.opacity(0.55 + 0.45 * wave)
            },
        )
        .into_any_element()
    } else {
        name.into_any_element()
    };
    h_flex()
        .id(id)
        .group(group)
        .w_full()
        .min_w_0()
        .min_h(px(theme::control_compact()))
        .px(px(ROW_PADDING))
        .gap(px(8.))
        .rounded(px(6.))
        .text_size(px(m.left.content))
        .line_height(px(m.left.line_height))
        .text_color(a.tool_action)
        .when(has_detail, |d| {
            d.cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(a.row_hover).text_color(a.text))
        })
        .child(
            div()
                .size(px(TOOL_ICON))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .child(icon),
        )
        .child(name)
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .overflow_hidden()
                .text_color(a.text_subtle)
                .children(subject),
        )
        .children(metadata)
        .children(status)
}

/// `AgentToolStepPath` / `AgentToolStepCode` / `AgentToolStepText`.
pub fn subject_element(subject: &StepSubject, a: &AgentTheme) -> AnyElement {
    let line = || {
        h_flex()
            .min_w_0()
            .items_baseline()
            .gap(px(6.))
            .overflow_hidden()
    };
    let context = |text: String| {
        div()
            .min_w_0()
            .flex_shrink(100.)
            .truncate()
            .text_color(a.text_subtle)
            .child(text)
    };
    match subject {
        StepSubject::Path { name, folder } => line()
            .child(
                div()
                    .min_w_0()
                    .flex_shrink_0()
                    .max_w_full()
                    .truncate()
                    .text_color(a.tool_subject)
                    .child(name.clone()),
            )
            .when(!folder.is_empty(), |d| d.child(context(folder.clone())))
            .into_any_element(),
        StepSubject::Code {
            text,
            context: scope,
        } => line()
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .font_family(theme::MONO)
                    .text_size(px(mono_size()))
                    .text_color(a.tool_subject)
                    .child(text.clone()),
            )
            .children(scope.clone().map(context))
            .into_any_element(),
        StepSubject::Text(text) => div()
            .min_w_0()
            .truncate()
            .text_color(a.text_subtle)
            .child(text.clone())
            .into_any_element(),
    }
}

/// `.desktop-agent-tool-facts` / `.desktop-agent-tool-diff-stats`.
pub fn metadata_element(metadata: &StepMetadata, a: &AgentTheme) -> AnyElement {
    let m = theme::ty();
    match metadata {
        StepMetadata::Facts(text) => div()
            .flex_none()
            .whitespace_nowrap()
            .text_size(px(m.left.meta))
            .text_color(a.text_subtle)
            .child(text.clone())
            .into_any_element(),
        StepMetadata::DiffStats {
            additions,
            deletions,
        } => h_flex()
            .gap(px(5.))
            .flex_shrink_0()
            .whitespace_nowrap()
            .text_size(px(m.left.meta))
            .child(div().text_color(a.diff_added_text).child(additions.clone()))
            .child(
                div()
                    .text_color(a.diff_removed_text)
                    .child(deletions.clone()),
            )
            .into_any_element(),
    }
}

/// `AgentToolTextEvidence`: bounded monospace text (head … marker … tail).
fn text_evidence(id: &str, text: &str, a: &AgentTheme) -> AnyElement {
    let preview = create_agent_tool_evidence_preview(text, AGENT_TOOL_EVIDENCE_LIMITS);
    let visible = if preview.truncated {
        let marker = tf(
            "agent.activity.outputOmitted",
            &[
                (
                    "lines",
                    Arg::Text(format_number(preview.omitted_lines as i64)),
                ),
                (
                    "characters",
                    Arg::Text(format_number(preview.omitted_chars as i64)),
                ),
            ],
        );
        [
            preview.head.as_str(),
            marker.as_str(),
            preview.tail.as_str(),
        ]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
    } else {
        preview.head
    };
    let full = text.to_string();
    div()
        .relative()
        .min_w_0()
        .py(px(4.))
        .child(
            div()
                .id(SharedString::from(format!("{id}-text")))
                .max_h(px(260.))
                .overflow_scroll()
                .font_family(theme::MONO)
                .text_size(px(mono_size()))
                .line_height(px(mono_size() * 1.5))
                .text_color(a.text_muted)
                .whitespace_nowrap()
                .child(visible),
        )
        .when(preview.truncated, |d| {
            // `.desktop-agent-tool-copy`: the full output stays copyable.
            d.child(
                div()
                    .id(SharedString::from(format!("{id}-copy")))
                    .absolute()
                    .top(px(4.))
                    .right(px(4.))
                    .size(px(22.))
                    .rounded(px(5.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor(theme::clickable_cursor())
                    .tooltip(crate::ui::components::tooltip(t(
                        "agent.activity.copyFullOutput",
                    )))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(full.clone()))
                    })
                    .child(Icon::new("copy").with_size(px(12.)).color(a.text_subtle)),
            )
        })
        .into_any_element()
}

/// `SearchResults`: each line may open the file it names.
fn search_results(
    id: &str,
    results: &crate::features::desktop_agent::domain::agent_tool_evidence::AgentToolResultLines,
    open_file: Option<OpenFile>,
    a: &AgentTheme,
) -> AnyElement {
    let line_height = mono_size() * 1.45;
    let mut list = v_flex()
        .id(SharedString::from(format!("{id}-results")))
        .min_w_0()
        .max_h(px(260.))
        .overflow_y_scroll()
        .font_family(theme::MONO)
        .text_size(px(mono_size()))
        .line_height(px(line_height));
    if results.lines.is_empty() {
        list = list.child(
            div()
                .text_size(px(theme::ty().left.meta))
                .italic()
                .text_color(a.text_subtle)
                .child(t("agent.activity.noResults")),
        );
    }
    for (index, line) in results.lines.iter().enumerate() {
        let path = super::super::activity::agent_activity_views::result_path(line);
        let row = div()
            .id(SharedString::from(format!("{id}-result-{index}")))
            .px(px(5.))
            .py(px(2.))
            .rounded(px(4.))
            .text_color(a.text_muted)
            .truncate()
            .child(line.clone());
        let row = match (path, open_file.clone()) {
            (Some(path), Some(open)) => {
                let hover = a.row_hover;
                row.cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(hover))
                    .on_click(move |_, window, cx| open(path.clone(), window, cx))
            }
            _ => row,
        };
        list = list.child(row);
    }
    if results.omitted_lines > 0 {
        list = list.child(
            div()
                .p(px(5.))
                .font_family("Geist")
                .text_size(px(theme::ty().left.meta))
                .text_color(a.text_subtle)
                .child(tf(
                    "agent.activity.moreResults",
                    &[
                        ("count", Arg::Number(results.omitted_lines as i64)),
                        (
                            "value",
                            Arg::Text(format_number(results.omitted_lines as i64)),
                        ),
                    ],
                )),
        );
    }
    list.into_any_element()
}

/// `AgentToolEvidenceNode`: elbow rail, optional marker, content.
fn evidence_node(
    marker: Option<&'static str>,
    tone: Option<EvidenceTone>,
    content: AnyElement,
    last: bool,
    a: &AgentTheme,
) -> Div {
    let center = EVIDENCE_ROW / 2.;
    let marker_color = match tone {
        Some(EvidenceTone::Addition) => a.diff_added_text,
        Some(EvidenceTone::Deletion) => a.diff_removed_text,
        None => a.text_muted,
    };
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
                    .text_color(marker_color)
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

/// `AgentToolEvidenceTree`.
pub fn evidence_tree(
    id: &str,
    nodes: &[EvidenceNode],
    open_file: Option<OpenFile>,
    a: &AgentTheme,
) -> AnyElement {
    let count = nodes.len();
    v_flex()
        .min_w_0()
        .py(px(2.))
        .pl(px(EVIDENCE_RAIL_INLINE))
        .font_family(theme::MONO)
        .text_size(px(mono_size()))
        .line_height(px(mono_size() * 1.5))
        .children(nodes.iter().enumerate().map(|(index, node)| {
            let node_id = format!("{id}-{index}");
            let content = match &node.content {
                EvidenceContent::Text(text) => text_evidence(&node_id, text, a),
                EvidenceContent::FilePath(path) => {
                    let row = div()
                        .id(SharedString::from(format!("{node_id}-path")))
                        .min_h(px(EVIDENCE_ROW))
                        .flex()
                        .items_center()
                        .truncate()
                        .child(path.clone());
                    match open_file.clone() {
                        Some(open) => {
                            let path = path.clone();
                            row.cursor(theme::clickable_cursor())
                                .hover(|s| s.underline())
                                .on_click(move |_, window, cx| open(path.clone(), window, cx))
                                .into_any_element()
                        }
                        None => row.into_any_element(),
                    }
                }
                EvidenceContent::SearchResults(results) => {
                    search_results(&node_id, results, open_file.clone(), a)
                }
                EvidenceContent::Empty(text) => div()
                    .min_h(px(EVIDENCE_ROW))
                    .flex()
                    .items_center()
                    .italic()
                    .text_color(a.text_subtle)
                    .child(text.clone())
                    .into_any_element(),
            };
            evidence_node(node.marker, node.tone, content, index + 1 == count, a)
        }))
        .into_any_element()
}

/// `.desktop-agent-tool-branch` holding an evidence tree.
pub fn evidence_branch(content: AnyElement) -> Div {
    div()
        .mt(px(1.))
        .mb(px(2.))
        .mr(px(4.))
        .min_w_0()
        .child(content)
}

/// `.desktop-agent-tool-branch` for prose (reasoning, plan): a 2px rail.
pub fn prose_branch(content: AnyElement, a: &AgentTheme) -> Div {
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

/// `AgentPlanItem`.
pub fn plan_list(steps: &[PlanStep], a: &AgentTheme) -> AnyElement {
    let m = theme::ty();
    v_flex()
        .gap(px(4.))
        .children(steps.iter().enumerate().map(|(index, step)| {
            h_flex()
                .gap(px(8.))
                .items_baseline()
                .text_size(px(m.left.content))
                .child(
                    div()
                        .text_color(a.text_subtle)
                        .child(format!("{}.", index + 1)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .whitespace_normal()
                        .text_color(if step.status == "completed" {
                            a.text_subtle
                        } else {
                            a.text_muted
                        })
                        .when(step.status == "completed", |d| d.line_through())
                        .child(step.step.clone()),
                )
                .child(
                    div()
                        .flex_none()
                        .text_size(px(m.left.meta))
                        .text_color(a.text_subtle)
                        .child(step.status_label.clone()),
                )
        }))
        .into_any_element()
}

/// `.desktop-agent-context-divider`: a rule on both sides of a small label.
pub fn context_divider(label: SharedString, a: &AgentTheme) -> AnyElement {
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

/// The same `LoadingMark size="xs"` as `AgentRunFeedback` in the product.
pub fn dots(id: impl Into<SharedString>, color: Rgba) -> AnyElement {
    crate::ui::loading::LoadingMark::new(ElementId::Name(id.into()))
        .size(crate::ui::loading::LoaderSize::Xs)
        .color(color)
        .into_any_element()
}

/// `AgentRunFeedback`: meta label (and dots while busy) at the content inset.
pub fn run_feedback(label: SharedString, busy: Option<SharedString>, a: &AgentTheme) -> Div {
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

/// `.desktop-agent-prompt-mention` (and the resolving placeholder).
pub fn mention_chip(a: &AgentTheme, label: String, resolving: bool) -> Div {
    div()
        .flex_shrink_0()
        .mt(px(0.5))
        .px(px(4.))
        .rounded(px(4.))
        .border_1()
        .border_color(theme::mix(a.accent, a.border_subtle, 0.36))
        .bg(theme::alpha(a.accent, 0.16 * 0.58))
        .text_color(theme::mix(a.accent, a.text, 0.78))
        .text_size(px(14.))
        .line_height(px(18.))
        .font_weight(FontWeight(450.))
        .whitespace_nowrap()
        .when(resolving, |d| d.opacity(0.68))
        .child(label)
}

/// `agent.effort.*` label for a reasoning effort id.
pub fn effort_label(id: &str) -> String {
    let key = match id {
        "low" | "minimal" => "agent.effort.low",
        "medium" => "agent.effort.medium",
        "high" => "agent.effort.high",
        "xhigh" => "agent.effort.xhigh",
        "max" => "agent.effort.max",
        _ => return id.to_owned(),
    };
    t(key).to_owned()
}
