//! `AgentToolGlyph`, `AgentActivityShell`'s step line and status icon, and
//! `AgentToolStepText` (the step's subject and facts).
use super::super::activity::agent_activity_views::{
    AgentToolGlyphKind, StatusIcon, StepIcon, StepMetadata, StepSubject,
};
use super::super::agent_theme::AgentTheme;
use super::*;
use crate::theme::{self, Theme};
use crate::ui::components::Icon;
use gpui_kit::base::h_flex;

/// `AgentToolGlyph` frames are 18 units drawn at 16px; `@1.2` gives ~1.07px
/// on-screen stroke matching the settled 14.5px Lucide icons (`1.75 * 14.5 / 24 = 1.06px`).
const GLYPH: f32 = 16.;
const GLYPH_UNIT: f32 = GLYPH / 18.;
const LUCIDE_TOOL_SIZE: f32 = 14.5;
const LUCIDE_TOOL_STROKE: f32 = 1.75;

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
            .with_size(px(LUCIDE_TOOL_SIZE))
            .stroke(LUCIDE_TOOL_STROKE)
            .color(color)
            .into_any_element()
    };
    let duration = |ms: u64| Animation::new(std::time::Duration::from_millis(ms)).repeat();
    match kind {
        AgentToolGlyphKind::Search if active => frame()
            .child(layer("icons/agent-glyph-search@1.2.svg").with_animation(
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
        AgentToolGlyphKind::Search => lucide("search"),
        AgentToolGlyphKind::Read if active => frame()
            .child(layer("icons/agent-glyph-read@1.2.svg"))
            .child(layer("icons/agent-glyph-read-scan@1.2.svg").with_animation(
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
            .into_any_element(),
        AgentToolGlyphKind::Read => lucide("file-text"),
        kind @ (AgentToolGlyphKind::Edit | AgentToolGlyphKind::Write) => {
            let edit = kind == AgentToolGlyphKind::Edit;
            if !active {
                return lucide(if edit { "file-pen-line" } else { "file-plus-2" });
            }
            frame()
                .child(layer(if edit {
                    "icons/agent-glyph-edit-base@1.2.svg"
                } else {
                    "icons/agent-glyph-write-base@1.2.svg"
                }))
                .child(layer("icons/agent-glyph-ink@1.2.svg").with_animation(
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
                .child(layer("icons/agent-glyph-pen@1.2.svg").with_animation(
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
            .with_size(px(LUCIDE_TOOL_SIZE))
            .stroke(LUCIDE_TOOL_STROKE)
            .color(a.tool_glyph)
            .into_any_element(),
        StepIcon::ListTodo => Icon::new("list-todo")
            .with_size(px(LUCIDE_TOOL_SIZE))
            .stroke(LUCIDE_TOOL_STROKE)
            .color(a.tool_glyph)
            .into_any_element(),
    }
}

/// `StatusIcon`: completed steps stay quiet without a trailing checkmark
/// (matching Option E and `.desktop-agent-tool-status.is-completed`); failed,
/// stopped, and pending steps keep their status mark.
pub fn status_icon_element(icon: &StatusIcon, a: &AgentTheme, t: &Theme) -> Option<AnyElement> {
    let (name, color) = match icon {
        StatusIcon::None | StatusIcon::Completed { .. } => return None,
        StatusIcon::Failed { .. } => ("circle-alert", t.danger),
        StatusIcon::Stopped { .. } => ("circle-slash-2", a.text_subtle),
        StatusIcon::Pending { .. } => ("circle", a.text_subtle),
    };
    Some(
        Icon::new(name)
            .with_size(px(12.))
            .stroke(1.75)
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
        .group(group.clone())
        .w_full()
        .min_w_0()
        .min_h(px(26.))
        .px(px(ROW_PADDING))
        .gap(px(8.))
        .rounded(px(6.))
        .text_size(px(m.right.meta))
        .line_height(px(m.right.meta_line_height))
        .text_color(a.tool_action)
        .when(has_detail, |d| {
            d.cursor(theme::clickable_cursor())
                .hover(move |s| s.bg(a.row_hover).text_color(a.text))
        })
        .child(
            div()
                .w(px(TOOL_ICON))
                .h(px(16.))
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
                .text_color(a.tool_subject)
                .group_hover(group, move |s| s.text_color(a.text_muted))
                .children(subject),
        )
        .children(metadata)
        .children(status)
}

/// `AgentToolStepPath` / `AgentToolStepCode` / `AgentToolStepText`.
pub fn subject_element(subject: &StepSubject, a: &AgentTheme) -> AnyElement {
    let m = theme::ty();
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
            .text_color(theme::alpha(a.text_subtle, 0.75))
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
                    .font_family(theme::mono())
                    .text_size(px(m.right.caption))
                    .child(text.clone()),
            )
            .children(scope.clone().map(context))
            .into_any_element(),
        StepSubject::Text(text) => div()
            .min_w_0()
            .truncate()
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
