//! `AgentActivityShell` and `AgentToolActivityGroup` in the transcript: a
//! step line whose detail opens beneath it, and a tool run's steps with
//! long runs of settled exploration folded into one "Explored" line.
use super::super::activity::agent_activity_views::{
    ActivityShell, ActivityView, ShellDetail, StatusIcon, activity_view, status_icon,
};
use super::super::activity::agent_tool_steps::{AgentToolStepSegment, agent_tool_step_segments};
use super::super::agent_theme::AgentTheme;
use super::super::panel::elements::{
    EVIDENCE_RAIL_INLINE, OpenFile, context_divider, evidence_branch, evidence_tree,
    metadata_element, plan_list, prose_branch, status_icon_element, step_icon, step_line,
    subject_element,
};
use super::view::{TranscriptEvent, TranscriptView};
use crate::agent::contract::dto::Part;
use crate::localization::{Arg, format_number, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use std::rc::Rc;
use std::sync::Arc;

impl TranscriptView {
    /// An activity part standalone, or as one step of a tool group.
    pub(super) fn render_activity(
        &mut self,
        row_id: &str,
        part: &Part,
        in_group: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        match activity_view(part) {
            ActivityView::Hidden => div().into_any_element(),
            ActivityView::ContextDivider(label) => context_divider(label.into(), &a),
            ActivityView::Notice { error, label } => h_flex()
                .mx(px(4.))
                .mb(px(6.))
                .gap(px(6.))
                .text_size(px(theme::ty().left.meta))
                .text_color(if error {
                    palette.danger
                } else {
                    palette.warning
                })
                .child(
                    Icon::new("circle-alert")
                        .with_size(px(12.))
                        .color(if error {
                            palette.danger
                        } else {
                            palette.warning
                        }),
                )
                .child(div().min_w_0().whitespace_normal().child(label))
                .into_any_element(),
            ActivityView::Shell(shell) => self.render_shell(row_id, part, &shell, in_group, cx),
        }
    }

    /// `AgentActivityShell`: a step line whose detail opens beneath it.
    fn render_shell(
        &mut self,
        row_id: &str,
        part: &Part,
        shell: &ActivityShell,
        in_group: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let part_id = part.id.clone();
        let key = format!("{row_id}:{part_id}");
        let has_detail = shell.has_detail();
        let expanded = if in_group {
            self.group_selected.get(row_id) == Some(&part_id)
        } else {
            self.expanded.contains(&key) != shell.default_expanded
        };
        let failed = matches!(status_icon(&shell.status), StatusIcon::Failed { .. });
        let line = step_line(
            SharedString::from(format!("tool-step-{key}")),
            step_icon(format!("step-{key}"), shell.icon, failed, &a, &palette),
            shell.title.clone(),
            shell
                .subject
                .as_ref()
                .map(|subject| subject_element(subject, &a)),
            shell
                .metadata
                .as_ref()
                .map(|metadata| metadata_element(metadata, &a)),
            status_icon_element(&status_icon(&shell.status), &a, &palette),
            has_detail,
            shell.active(),
            &a,
        );
        let line = if has_detail {
            let (row, id) = (row_id.to_string(), part_id.clone());
            line.on_click(cx.listener(move |s, _, _, cx| {
                if in_group {
                    if s.group_selected.get(&row) == Some(&id) {
                        s.group_selected.remove(&row);
                    } else {
                        s.group_selected.insert(row.clone(), id.clone());
                    }
                } else {
                    let key = format!("{row}:{id}");
                    if !s.expanded.remove(&key) {
                        s.expanded.insert(key);
                    }
                }
                s.splice_row(&row);
                cx.notify();
            }))
        } else {
            line
        };
        let weak = cx.weak_entity();
        let open_file: OpenFile = Rc::new(move |path, _, cx| {
            let _ = weak.update(cx, |_, cx| cx.emit(TranscriptEvent::OpenFile(path)));
        });
        let detail = (expanded && has_detail).then(|| match &shell.detail {
            ShellDetail::Evidence(nodes) => {
                evidence_branch(evidence_tree(&key, nodes, Some(open_file), &a)).into_any_element()
            }
            ShellDetail::Prose { text, plan } => prose_branch(
                v_flex()
                    .gap(px(6.))
                    .children(text.clone().map(|text| {
                        div()
                            .id(SharedString::from(format!("{key}-prose")))
                            .max_h(px(220.))
                            .overflow_y_scroll()
                            .text_size(px(theme::ty().left.content))
                            .line_height(px(theme::ty().left.content * 1.55))
                            .text_color(a.text_muted)
                            .whitespace_normal()
                            .child(text)
                    }))
                    .when(!plan.is_empty(), |d| d.child(plan_list(plan, &a)))
                    .into_any_element(),
                &a,
            )
            .into_any_element(),
        });
        v_flex()
            .min_w_0()
            .when(!in_group, |d| d.mx(px(4.)).mb(px(2.)))
            .child(line)
            .children(detail)
            .into_any_element()
    }

    /// `AgentToolActivityGroup`: one line per step; long runs of settled
    /// exploration fold into one "Explored" line.
    pub(super) fn render_tool_group(
        &mut self,
        row_id: &str,
        parts: &[Arc<Part>],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        // Drop a selection whose step left the group.
        if let Some(selected) = self.group_selected.get(row_id)
            && !parts.iter().any(|part| part.id == *selected)
        {
            self.group_selected.remove(row_id);
        }
        let mut group = v_flex().min_w_0().mx(px(4.)).mb(px(8.));
        for segment in agent_tool_step_segments(parts) {
            match segment {
                AgentToolStepSegment::Step { part, .. } => {
                    group = group.child(self.render_activity(row_id, &part, true, cx));
                }
                AgentToolStepSegment::Explored {
                    id,
                    parts: folded,
                    files,
                    searches,
                } => {
                    let key = format!("{row_id}:{id}");
                    let open = self.open_folds.contains(&key);
                    let summary = crate::localization::and_list(
                        &[
                            (files > 0).then(|| {
                                tf(
                                    "agent.toolStep.files",
                                    &[
                                        ("count", Arg::Number(files as i64)),
                                        ("value", Arg::Text(format_number(files as i64))),
                                    ],
                                )
                            }),
                            (searches > 0).then(|| {
                                tf(
                                    "agent.toolStep.searches",
                                    &[
                                        ("count", Arg::Number(searches as i64)),
                                        ("value", Arg::Text(format_number(searches as i64))),
                                    ],
                                )
                            }),
                        ]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>(),
                    );
                    let chevron = Icon::new("chevron-right")
                        .with_size(px(13.))
                        .stroke(2.)
                        .color(a.tool_glyph)
                        .when(open, |icon| icon.rotate(std::f32::consts::FRAC_PI_2));
                    let (toggle, splice) = (key.clone(), row_id.to_string());
                    let line = step_line(
                        SharedString::from(format!("tool-fold-{key}")),
                        chevron.into_any_element(),
                        t("agent.toolStep.explored").into(),
                        Some(subject_element(
                            &super::super::activity::agent_activity_views::StepSubject::Text(
                                summary,
                            ),
                            &a,
                        )),
                        None,
                        None,
                        true,
                        false,
                        &a,
                    )
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if !s.open_folds.remove(&toggle) {
                            s.open_folds.insert(toggle.clone());
                        }
                        s.splice_row(&splice);
                        cx.notify();
                    }));
                    let mut fold = v_flex().min_w_0().child(line);
                    if open {
                        let mut body = v_flex()
                            .min_w_0()
                            .ml(px(EVIDENCE_RAIL_INLINE))
                            .pl(px(6.))
                            .border_l_1()
                            .border_color(a.border_subtle);
                        for part in &folded {
                            body = body.child(self.render_activity(row_id, part, true, cx));
                        }
                        fold = fold.child(body);
                    }
                    group = group.child(fold);
                }
            }
        }
        group.into_any_element()
    }
}
