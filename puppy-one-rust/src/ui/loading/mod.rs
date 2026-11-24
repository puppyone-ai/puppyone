//! Shared LoadingMark / placeholder material, not page-owned spinners.
//! One window-independent clock, one bounded timer per App; only views that
//! actually paint a visible loading surface subscribe for the next tick.
//!
//! A mark is announced once, as a status: by the name it is given, else by
//! the words it stands beside (`InlineLoading`, `PageLoading`), else by its
//! localized name. A mark whose host already announces the loading is
//! silent (`ariaHidden`).
pub mod model;
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
pub use model::LoaderSize;
use model::{Layout, Shape};
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

struct Clock {
    pending: bool,
    views: HashSet<EntityId>,
}
impl Global for Clock {}
fn frame(window: &mut Window, cx: &mut App) -> (f64, bool) {
    let still = cx.reduce_motion();
    #[cfg(feature = "dev-capture")]
    if let Ok(time) = std::env::var("PUPPYONE_LOADING_AT")
        && let Ok(time) = time.parse::<f64>()
    {
        return (time, still);
    }
    if !cx.has_global::<Clock>() {
        cx.set_global(Clock {
            pending: false,
            views: HashSet::new(),
        });
    }
    let clock = cx.global_mut::<Clock>();
    if !still {
        clock.views.insert(window.current_view());
        if !clock.pending {
            clock.pending = true;
            let timer = cx
                .background_executor()
                .timer(Duration::from_secs_f64(1. / 60.));
            cx.spawn(async move |cx| {
                timer.await;
                cx.update(|cx| {
                    let clock = cx.global_mut::<Clock>();
                    clock.pending = false;
                    let views = std::mem::take(&mut clock.views);
                    for view in views {
                        cx.notify(view);
                    }
                });
            })
            .detach();
        }
    }
    // CSS animations start when an element mounts; sharing a scheduler must
    // not make a newly mounted relay start in the middle of its cycle.
    let start = window.use_keyed_state("rounded-start", cx, |_, _| Instant::now());
    (start.read(cx).elapsed().as_secs_f64(), still)
}
fn visible(bounds: Bounds<Pixels>, window: &Window) -> bool {
    let clip = bounds.intersect(&window.content_mask().bounds);
    clip.size.width > px(0.) && clip.size.height > px(0.)
}
fn paint_shape(
    shape: Shape,
    opacity: f64,
    color: Rgba,
    origin: Point<Pixels>,
    window: &mut Window,
) {
    let bounds = Bounds::new(
        origin + point(px(shape.x as f32), px(shape.y as f32)),
        size(px(shape.width as f32), px(shape.height as f32)),
    );
    window.paint_quad(
        fill(
            bounds,
            Rgba {
                a: color.a * opacity as f32,
                ..color
            },
        )
        .corner_radii(px(shape.radius as f32)),
    );
}

#[derive(Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    #[default]
    Neutral,
    Info,
    Success,
    Warning,
    Danger,
}
impl Tone {
    fn color(self, cx: &App) -> Rgba {
        let t = cx.palette();
        match self {
            Self::Neutral => t.muted,
            Self::Info => t.info,
            Self::Success => t.success,
            Self::Warning => t.warning,
            Self::Danger => t.danger,
        }
    }
}
#[derive(IntoElement)]
pub struct LoadingMark {
    id: ElementId,
    size: LoaderSize,
    layout: Layout,
    color: Option<Rgba>,
    tone: Tone,
    /// `ariaLabel`.
    label: Option<SharedString>,
    /// The words it stands beside.
    words: Option<SharedString>,
    /// `ariaHidden`.
    silent: bool,
}
impl LoadingMark {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: LoaderSize::Sm,
            layout: Layout::Inline,
            color: None,
            tone: Tone::Neutral,
            label: None,
            words: None,
            silent: false,
        }
    }
    /// What it is announced as (`ariaLabel`), whatever words it stands beside.
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }
    /// The words shown beside it: what it is announced as unless it is given
    /// a name.
    pub fn beside(mut self, words: impl Into<SharedString>) -> Self {
        self.words = Some(words.into());
        self
    }
    /// Its host already announces the loading (`ariaHidden`).
    pub fn silent(mut self) -> Self {
        self.silent = true;
        self
    }
    /// The one announcement, if it makes it.
    fn announced(&self) -> Option<SharedString> {
        (!self.silent).then(|| {
            self.label
                .clone()
                .or_else(|| self.words.clone())
                .unwrap_or_else(|| crate::localization::t("shared-ui.loading").into())
        })
    }
    pub fn size(mut self, size: LoaderSize) -> Self {
        self.size = size;
        self
    }
    pub fn area(mut self) -> Self {
        self.layout = Layout::Area;
        self
    }
    pub fn color(mut self, color: impl Into<Rgba>) -> Self {
        self.color = Some(color.into());
        self
    }
    pub fn tone(mut self, tone: Tone) -> Self {
        self.tone = tone;
        self
    }
}
impl RenderOnce for LoadingMark {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or_else(|| self.tone.color(cx));
        let (w, h) = model::dimensions(self.size, self.layout);
        let announced = self.announced();
        div()
            .id(self.id)
            .when_some(announced, |d, name| d.role(Role::Status).aria_label(name))
            .test_support()
            .flex_shrink_0()
            .w(px(w as f32))
            .h(px(h as f32))
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, cx| {
                        if !visible(bounds, window) {
                            return;
                        }
                        let (time, still) = frame(window, cx);
                        for dot in model::mark_shapes(self.size, self.layout, time, still) {
                            paint_shape(dot.shape, dot.opacity, color, bounds.origin, window);
                        }
                    },
                )
                .size_full(),
            )
    }
}

/// A supplied set of skeleton shapes, rendered in the shared rounded breathing
/// material. Owners supply layout only; this shared layer owns breathing ink.
pub fn placeholder(
    id: impl Into<ElementId>,
    width: f32,
    height: f32,
    shapes: Vec<Shape>,
) -> impl IntoElement {
    div().id(id).relative().w(px(width)).h(px(height)).child(
        canvas(
            |_, _, _| {},
            move |bounds, _, window, cx| {
                if !visible(bounds, window) {
                    return;
                }
                let (time, still) = frame(window, cx);
                let color = cx.palette().skeleton;
                let phase = time.rem_euclid(2.8) / 2.8;
                let amount = model::ease(
                    if phase < 0.5 {
                        phase * 2.
                    } else {
                        (1. - phase) * 2.
                    },
                    0.42,
                    0.58,
                );
                let opacity = if still { 1. } else { 1. - 0.45 * amount };
                for shape in &shapes {
                    paint_shape(*shape, opacity, color, bounds.origin, window);
                }
            },
        )
        .size_full(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// `CloudWorkspaceLoadingState`: a loader is neutral — the muted ink,
    /// never the accent — unless its owner gives it another tone.
    #[gpui::test]
    fn a_loader_is_neutral_unless_given_a_tone(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            let t = cx.palette();
            assert!(matches!(LoadingMark::new("loading").tone, Tone::Neutral));
            assert_eq!(Tone::default().color(cx), t.muted);
            assert_ne!(Tone::Neutral.color(cx), t.accent);
            assert_eq!(Tone::Danger.color(cx), t.danger);
        });
    }

    struct Marks(fn() -> Vec<LoadingMark>);
    impl Render for Marks {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().flex().children((self.0)())
        }
    }
    /// What the window announces as loading: every status, by name.
    fn statuses(cx: &mut gpui::TestAppContext, marks: fn() -> Vec<LoadingMark>) -> Vec<String> {
        use gpui_kit::test::TestQueryExt as _;
        cx.update(gpui_kit::init);
        let (_, cx) = cx.add_window_view(|_, _| Marks(marks));
        cx.update(|window, cx| {
            window.draw(cx).clear(cx);
            window
                .find_all_by_role(Role::Status)
                .iter()
                .map(|status| status.label().unwrap_or_default().to_owned())
                .collect()
        })
    }

    /// `LoadingMark`: `announces loading unless the host already does`.
    #[gpui::test]
    fn a_mark_announces_loading_unless_its_host_does(cx: &mut gpui::TestAppContext) {
        let names = statuses(cx, || {
            vec![
                LoadingMark::new("announced").label("Opening project"),
                LoadingMark::new("hidden").silent(),
            ]
        });
        assert_eq!(names, ["Opening project"]);
    }

    /// `what a loading mark is called`: once, by what its caller says.
    #[gpui::test]
    fn a_mark_is_announced_once_by_the_words_beside_it(cx: &mut gpui::TestAppContext) {
        assert_eq!(
            statuses(cx, || vec![LoadingMark::new("saving").beside("Saving")]),
            ["Saving"]
        );
    }

    /// `prefers the name it is given over its words`.
    #[gpui::test]
    fn a_given_name_wins_over_the_words(cx: &mut gpui::TestAppContext) {
        let names = statuses(cx, || {
            vec![
                LoadingMark::new("saving")
                    .beside("Saving")
                    .label("Saving the project"),
            ]
        });
        assert_eq!(names, ["Saving the project"]);
    }

    /// `falls back to the mark's localized name when an inline mark has no
    /// words`.
    #[gpui::test]
    fn an_inline_mark_without_words_is_called_loading(cx: &mut gpui::TestAppContext) {
        assert_eq!(
            statuses(cx, || vec![LoadingMark::new("inline")]),
            ["Loading…"]
        );
    }

    /// `falls back to the mark's localized name when a page mark has no
    /// words`.
    #[gpui::test]
    fn a_page_mark_without_words_is_called_loading(cx: &mut gpui::TestAppContext) {
        let names = statuses(cx, || {
            vec![LoadingMark::new("page").area().size(LoaderSize::Md)]
        });
        assert_eq!(names, ["Loading…"]);
    }
}
