//! Shared LoadingMark / placeholder material, not page-owned spinners.
//! One window-independent clock, one bounded timer per App; only views that
//! actually paint a visible loading surface subscribe for the next tick.
pub mod model;
use crate::ui::appearance::{ActiveAppearance, Appearance};
use gpui::{prelude::*, *};
use model::{Layout, Shape};
pub use model::{LoaderSize, LoadingStyle};
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

struct Clock {
    start: Instant,
    pending: bool,
    fast: bool,
    want_fast: bool,
    views: HashSet<EntityId>,
}
impl Global for Clock {}
fn frame(window: &mut Window, cx: &mut App, dither: bool) -> (f64, bool) {
    let still = cx.reduce_motion();
    #[cfg(feature = "dev-capture")]
    if let Ok(time) = std::env::var("PUPPYONE_LOADING_AT")
        && let Ok(time) = time.parse::<f64>()
    {
        return (time, still);
    }
    if !cx.has_global::<Clock>() {
        cx.set_global(Clock {
            start: Instant::now(),
            pending: false,
            fast: false,
            want_fast: false,
            views: HashSet::new(),
        });
    }
    let clock = cx.global_mut::<Clock>();
    let time = clock.start.elapsed().as_secs_f64();
    if !still {
        clock.views.insert(window.current_view());
        clock.want_fast |= !dither;
        if !clock.pending {
            clock.pending = true;
            // The previous paint epoch includes every subscriber, so a
            // dither sibling painted first cannot throttle rounded to 30Hz.
            let rate = if clock.fast || clock.want_fast {
                60.
            } else {
                model::catalog().fps
            };
            let timer = cx
                .background_executor()
                .timer(Duration::from_secs_f64(1. / rate));
            cx.spawn(async move |cx| {
                timer.await;
                cx.update(|cx| {
                    let clock = cx.global_mut::<Clock>();
                    clock.pending = false;
                    clock.fast = std::mem::take(&mut clock.want_fast);
                    let views = std::mem::take(&mut clock.views);
                    for view in views {
                        cx.notify(view);
                    }
                });
            })
            .detach();
        }
    }
    (
        if dither {
            (time * model::catalog().fps).floor() / model::catalog().fps
        } else {
            // CSS animations start when an element mounts, unlike the
            // globally phased dither field. Sharing a scheduler must not
            // make a newly mounted relay start in the middle of its cycle.
            let start = window.use_keyed_state("rounded-start", cx, |_, _| Instant::now());
            start.read(cx).elapsed().as_secs_f64()
        },
        still,
    )
}
fn active_style(cx: &App) -> LoadingStyle {
    cx.try_global::<Appearance>()
        .map(|a| a.loading_style)
        .unwrap_or_default()
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
#[derive(Default)]
struct MaskCache {
    cols: usize,
    rows: usize,
    shapes: Vec<Shape>,
    mask: Vec<bool>,
}
#[expect(
    clippy::too_many_arguments,
    reason = "Paint bounds, material and GPUI context"
)]
fn paint_dither(
    bounds: Bounds<Pixels>,
    shapes: &[Shape],
    cell: f64,
    light: model::Light,
    time: Option<f64>,
    color: Rgba,
    window: &mut Window,
    cx: &mut App,
) {
    let cols = (f64::from(f32::from(bounds.size.width)) / cell)
        .ceil()
        .max(1.) as usize;
    let rows = (f64::from(f32::from(bounds.size.height)) / cell)
        .ceil()
        .max(1.) as usize;
    let shapes: Vec<_> = shapes
        .iter()
        .map(|s| {
            let (x, y) = ((s.x / cell).round(), (s.y / cell).round());
            Shape {
                x,
                y,
                width: ((s.x + s.width) / cell).round() - x,
                height: ((s.y + s.height) / cell).round() - y,
                radius: s.radius / cell,
            }
        })
        .collect();
    // State belongs to this element's keyed scope; no process-wide mask
    // cache that accumulates every size observed during pane resizing.
    let cache = window.use_keyed_state("dither-mask", cx, |_, _| MaskCache::default());
    let alpha = cache.update(cx, |cache, _| {
        if cache.cols != cols || cache.rows != rows || cache.shapes != shapes {
            cache.mask = model::mask(cols, rows, &shapes);
            cache.cols = cols;
            cache.rows = rows;
            cache.shapes = shapes;
        }
        model::dither_alpha(
            cols,
            rows,
            &cache.mask,
            light,
            time,
            (color.a.clamp(0., 1.) * 255.).round() as u8,
        )
    });
    // Coalesce same-ink cells horizontally: one quad per run, not thousands
    // of retained GPUI elements / SVGs. The lattice stays at whole CSS cells.
    for y in 0..rows {
        let mut x = 0;
        while x < cols {
            let a = alpha[y * cols + x];
            let start = x;
            x += 1;
            while x < cols && alpha[y * cols + x] == a {
                x += 1;
            }
            if a > 0 {
                paint_shape(
                    Shape {
                        x: start as f64 * cell,
                        y: y as f64 * cell,
                        width: (x - start) as f64 * cell,
                        height: cell,
                        radius: 0.,
                    },
                    1.,
                    Rgba {
                        a: a as f32 / 255.,
                        ..color
                    },
                    bounds.origin,
                    window,
                );
            }
        }
    }
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
    style: Option<LoadingStyle>,
    color: Option<Rgba>,
    tone: Tone,
}
impl LoadingMark {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: LoaderSize::Sm,
            layout: Layout::Inline,
            style: None,
            color: None,
            tone: Tone::Neutral,
        }
    }
    pub fn size(mut self, size: LoaderSize) -> Self {
        self.size = size;
        self
    }
    pub fn area(mut self) -> Self {
        self.layout = Layout::Area;
        self
    }
    pub fn loading_style(mut self, style: LoadingStyle) -> Self {
        self.style = Some(style);
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
        let style = self.style.unwrap_or_else(|| active_style(cx));
        let color = self.color.unwrap_or_else(|| self.tone.color(cx));
        let (w, h) = model::dimensions(style, self.size, self.layout);
        div()
            .id(self.id)
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
                        let (time, still) = frame(window, cx, style == LoadingStyle::Dither);
                        let shapes = model::mark_shapes(style, self.size, self.layout, time, still);
                        if style == LoadingStyle::Dither {
                            paint_dither(
                                bounds,
                                &shapes.iter().map(|d| d.shape).collect::<Vec<_>>(),
                                1.,
                                model::catalog().mark_light,
                                (!still).then_some(time),
                                color,
                                window,
                                cx,
                            );
                        } else {
                            for dot in shapes {
                                paint_shape(dot.shape, dot.opacity, color, bounds.origin, window);
                            }
                        }
                    },
                )
                .size_full(),
            )
    }
}

/// A supplied set of skeleton shapes, rendered in the same material as marks.
/// Owners supply layout only; this shared layer owns breathing / Bayer ink.
pub fn placeholder(
    id: impl Into<ElementId>,
    width: f32,
    height: f32,
    shapes: Vec<Shape>,
    style: LoadingStyle,
) -> impl IntoElement {
    div().id(id).relative().w(px(width)).h(px(height)).child(
        canvas(
            |_, _, _| {},
            move |bounds, _, window, cx| {
                if !visible(bounds, window) {
                    return;
                }
                let (time, still) = frame(window, cx, style == LoadingStyle::Dither);
                let mut color = cx.palette().skeleton;
                if style == LoadingStyle::Dither {
                    color.a = (color.a * if cx.is_dark() { 4.4 } else { 5.5 }).min(1.);
                    let light = model::Light {
                        halo: 0.,
                        ..model::catalog().placeholder_light
                    };
                    paint_dither(
                        bounds,
                        &shapes,
                        model::catalog().cell,
                        light,
                        (!still).then_some(time),
                        color,
                        window,
                        cx,
                    );
                } else {
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
                }
            },
        )
        .size_full(),
    )
}
