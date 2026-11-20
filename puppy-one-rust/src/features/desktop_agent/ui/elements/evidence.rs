//! The evidence tree (`AgentToolEvidenceTree/Node`, `AgentToolTextEvidence`,
//! search results), the prose branch and `AgentPlanItem`.
use super::super::activity::agent_activity_views::{
    EvidenceContent, EvidenceNode, EvidenceTone, PlanStep,
};
use super::super::agent_theme::AgentTheme;
use super::*;
use crate::features::desktop_agent::domain::agent_tool_evidence::{
    AGENT_TOOL_EVIDENCE_LIMITS, create_agent_tool_evidence_preview,
};
use crate::localization::{Arg, format_number, t, tf};
use crate::theme::{self};
use crate::ui::components::Icon;
use gpui_kit::base::{h_flex, v_flex};

const EVIDENCE_ELBOW: f32 = 14.;
const EVIDENCE_GAP: f32 = 6.;

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
                row.cursor(theme::navigation_cursor())
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
                            row.cursor(theme::navigation_cursor())
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
