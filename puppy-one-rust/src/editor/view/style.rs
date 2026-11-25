//! Resolved text and box styles. Values come from a theme (never chosen
//! here); this module turns them into GPUI text styles for the containers
//! GPUI Kit's text leaves inherit from, in the faces
//! `assets/typography/fonts.json` names.
use gpui::{
    FontFeatures, FontStyle, FontWeight, Rgba, SharedString, StyleRefinement, TextStyleRefinement,
    px,
};

/// The body text weight in every language. The product's reading weight
/// (`--po-content-reading-weight`: 450, 500 for Chinese) was tuned to Geist;
/// the platform faces read at their Regular.
pub const READING_WEIGHT: f32 = 400.;

/// The weight GPUI Kit's bold mark draws with: the product's strong weight
/// (`--po-md-strong-weight`, 600 in every built-in theme).
pub const STRONG_WEIGHT: f32 = 600.;

/// The proportional face text is set in, from the generic family that ends
/// a theme's CSS `font-family` list (`--po-md-content-font`): the platform's
/// sans or serif face.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Face {
    #[default]
    Sans,
    Serif,
}

impl Face {
    /// The face of a CSS `font-family` list: its first generic family
    /// (named faces are not bundled, so they fall through to it, as in a
    /// browser without them).
    pub fn of(families: &str) -> Self {
        families
            .split(',')
            .find_map(|family| match family.trim().trim_matches(['"', '\'']) {
                "serif" | "ui-serif" => Some(Self::Serif),
                "sans-serif" | "ui-sans-serif" | "system-ui" | "-apple-system" => Some(Self::Sans),
                _ => None,
            })
            .unwrap_or_default()
    }
}

/// The platform faces have static weights (Regular, Medium, Semibold, Bold,
/// …); a CSS weight between two takes the nearer, the lighter on a tie, so
/// 450 reads Regular and 650 Semibold rather than the font matcher's
/// heavier pick.
pub fn face_weight(weight: f32) -> FontWeight {
    FontWeight(((weight / 100. - 0.5).ceil() * 100.).clamp(100., 900.))
}

/// CSS `line-height`: a number is inherited as a factor of each element's
/// own font size; a length is inherited as is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LineHeight {
    Factor(f32),
    Px(f32),
}

impl LineHeight {
    pub fn resolve(self, font_size: f32) -> f32 {
        match self {
            Self::Factor(f) => f * font_size,
            Self::Px(v) => v,
        }
    }
}

/// The inherited text style of a box (what CSS gives `.cm-line`).
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    pub size: f32,
    pub weight: f32,
    pub italic: bool,
    pub mono: bool,
    pub color: Rgba,
    /// `font-variant-numeric: tabular-nums`.
    pub tabular: bool,
    pub line_height: LineHeight,
    /// The proportional face (code is always the monospaced face).
    pub face: Face,
}

impl TextStyle {
    /// The platform family of the text's face.
    pub fn family(&self) -> SharedString {
        if self.mono {
            crate::theme::mono().into()
        } else {
            match self.face {
                Face::Sans => crate::theme::sans().into(),
                Face::Serif => crate::theme::serif().into(),
            }
        }
    }
    /// The weight the face draws with ([`face_weight`]).
    pub fn font_weight(&self) -> FontWeight {
        face_weight(self.weight)
    }
    pub fn line_height_px(&self) -> f32 {
        self.line_height.resolve(self.size)
    }
    /// CSS `ch`: the advance of "0" in the text's face, measured from the
    /// running font (`ui::fonts::zero_advance`).
    pub fn ch(&self) -> f32 {
        crate::ui::fonts::zero_advance(self.category(), self.font_weight().0) * self.size
    }
    /// The font category of the text's face (its script fallbacks).
    fn category(&self) -> crate::typography::fonts::Category {
        use crate::typography::fonts::Category;
        match (self.mono, self.face) {
            (true, _) => Category::Monospace,
            (false, Face::Serif) => Category::Serif,
            (false, Face::Sans) => Category::Sans,
        }
    }
    /// The text refinement a container applies so Kit leaves inherit it.
    pub fn refinement(&self) -> TextStyleRefinement {
        TextStyleRefinement {
            color: Some(self.color.into()),
            font_family: Some(self.family()),
            font_features: Some(if self.tabular {
                FontFeatures(std::sync::Arc::new(vec![("tnum".into(), 1)]))
            } else {
                FontFeatures::default()
            }),
            // The locale's script faces after the face (`--po-md-content-font`,
            // `--po-font-code`).
            font_fallbacks: Some(crate::ui::fonts::fallbacks(self.category())),
            font_size: Some(px(self.size).into()),
            line_height: Some(px(self.line_height_px()).into()),
            // The weight also steers the script fallback faces (PingFang SC).
            font_weight: Some(self.font_weight()),
            font_style: Some(if self.italic {
                FontStyle::Italic
            } else {
                FontStyle::Normal
            }),
            ..Default::default()
        }
    }
    /// Apply as an element's inherited text style.
    pub fn apply(&self, style: &mut StyleRefinement) {
        style.text = self.refinement();
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Edges {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

impl Edges {
    pub fn new(top: f32, right: f32, bottom: f32, left: f32) -> Self {
        Self {
            top,
            right,
            bottom,
            left,
        }
    }
    #[cfg(test)]
    pub fn all(v: f32) -> Self {
        Self::new(v, v, v, v)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    pub fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Align {
    Start,
    Center,
    End,
}

/// Absolutely positioned decoration inside a box (CSS backgrounds, borders
/// and pseudo-elements), relative to the box's border-box origin.
#[derive(Clone, Debug, PartialEq)]
pub enum Paint {
    /// A box: background, per-corner radii and a uniform border.
    Quad {
        rect: Rect,
        background: Option<Rgba>,
        radii: [f32; 4],
        border: f32,
        border_color: Option<Rgba>,
    },
    /// Text that is not document source (`::before` list markers), laid out
    /// on one row inside `rect`, centred vertically, aligned horizontally.
    Label {
        rect: Rect,
        text: SharedString,
        style: TextStyle,
        align: Align,
    },
    /// A filled polygon (e.g. the rotated check of a task box).
    Polygon {
        points: Vec<(f32, f32)>,
        color: Rgba,
    },
    /// A monochrome SVG asset tinted `color` (a callout's glyph).
    Icon {
        rect: Rect,
        path: SharedString,
        color: Rgba,
    },
}

impl Paint {
    pub fn fill(rect: Rect, color: Rgba) -> Self {
        Self::Quad {
            rect,
            background: Some(color),
            radii: [0.; 4],
            border: 0.,
            border_color: None,
        }
    }
}

/// The complete style of one `.cm-line` box.
#[derive(Clone, Debug, PartialEq)]
pub struct LineStyle {
    /// Inherited text style (font, size, colour, line height).
    pub text: TextStyle,
    pub padding: Edges,
    /// Border widths, outside the padding (`border-left` of quotes).
    pub border: Edges,
    pub border_color: Option<Rgba>,
    pub background: Option<Rgba>,
    /// The background's corner radii: top left, top right, bottom right,
    /// bottom left.
    pub background_radii: [f32; 4],
    /// `box-shadow: inset 0 -Npx color`: a rule along the bottom edge.
    pub inset_bottom: Option<(f32, Rgba)>,
    /// A line-through over the whole line's text (`.cm-md-task-checked`).
    pub strike: bool,
    /// `white-space: pre` (no wrapping), as in code panels.
    pub nowrap: bool,
    /// Optional tab stop width override (e.g. `2` or `4` in code surfaces).
    pub tab_size: Option<usize>,
    /// Painted above the text (markers, checkboxes).
    pub overlays: Vec<Paint>,
    /// Interactive areas (task checkboxes): rect and the format command.
    pub hotspots: Vec<(Rect, super::command::Command)>,
    /// A control just after the text (a callout's fold toggle).
    pub trailing: Option<Trailing>,
    /// Content standing in for the line's (hidden) text.
    pub embed: Option<Embed>,
}

/// Content that stands in for a line's text inside its line box (an image
/// alone on its line): the line keeps its padding, borders and rhythm, and
/// the embed's height replaces the text's.
#[derive(Clone)]
pub struct Embed {
    /// Identity of what it shows (equal keys draw the same).
    pub key: u64,
    pub content: std::rc::Rc<dyn super::widget::LineEmbed>,
}
impl PartialEq for Embed {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key
    }
}
impl std::fmt::Debug for Embed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Embed").field("key", &self.key).finish()
    }
}

/// An icon button `gap` past the end of a line's text, centred on its last
/// row, rotated `rotation` degrees.
#[derive(Clone, Debug, PartialEq)]
pub struct Trailing {
    pub gap: f32,
    pub size: f32,
    pub icon: SharedString,
    pub color: Rgba,
    pub rotation: f32,
    pub command: super::command::Command,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            size: 14.,
            weight: 450.,
            italic: false,
            mono: false,
            color: crate::theme::Theme::new(true).text,
            tabular: false,
            line_height: LineHeight::Factor(1.5),
            face: Face::Sans,
        }
    }
}

impl Default for LineStyle {
    fn default() -> Self {
        Self::new(TextStyle::default())
    }
}

impl LineStyle {
    pub fn new(text: TextStyle) -> Self {
        Self {
            text,
            padding: Edges::default(),
            border: Edges::default(),
            border_color: None,
            background: None,
            background_radii: [0.; 4],
            inset_bottom: None,
            strike: false,
            nowrap: false,
            tab_size: None,
            overlays: Vec::new(),
            hotspots: Vec::new(),
            trailing: None,
            embed: None,
        }
    }
}
