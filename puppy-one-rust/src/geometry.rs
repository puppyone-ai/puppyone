//! Shell geometry and native hit routing in logical pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}
impl Rect {
    pub fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self {
            x,
            y,
            w: w.max(0.),
            h: h.max(0.),
        }
    }
    pub fn right(self) -> f32 {
        self.x + self.w
    }
    pub fn bottom(self) -> f32 {
        self.y + self.h
    }
    pub fn contains(self, p: (f32, f32)) -> bool {
        p.0 >= self.x && p.0 < self.right() && p.1 >= self.y && p.1 < self.bottom()
    }
}
#[derive(Default, Clone)]
pub struct HitMap {
    pub editor: Rect,
    pub overlays: Vec<Rect>,
    pub modal: bool,
    pub dragging: bool,
}
impl HitMap {
    pub fn native(&self, p: (f32, f32)) -> bool {
        self.modal
            || self.dragging
            || !self.editor.contains(p)
            || self.overlays.iter().any(|r| r.contains(p))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn popup_only_owns_its_rectangle_and_modal_owns_everything() {
        let mut hit = HitMap {
            editor: Rect::new(220., 76., 800., 700.),
            overlays: vec![Rect::new(500., 40., 280., 64.)],
            ..Default::default()
        };
        assert!(!hit.native((600., 400.)));
        assert!(hit.native((600., 80.)));
        assert!(hit.native((100., 400.)));
        hit.modal = true;
        assert!(hit.native((600., 400.)));
        hit.modal = false;
        hit.overlays.clear();
        assert!(!hit.native((600., 80.)));
        hit.dragging = true;
        assert!(hit.native((600., 400.)));
    }
}

/// GPUI renders top-down, but its AppKit NSView may use a bottom-left origin.
/// Apply this involution for both rectangles (height > 0) and input points.
pub fn native_y(flipped: bool, view_height: f64, y: f64, height: f64) -> f64 {
    if flipped { y } else { view_height - y - height }
}
#[cfg(test)]
mod coordinate_tests {
    use super::*;
    #[test]
    fn top_down_editor_and_popup_map_to_unflipped_appkit() {
        assert_eq!(native_y(false, 800., 76., 700.), 24.);
        assert_eq!(native_y(false, 800., 80., 0.), 720.);
        assert_eq!(native_y(false, 800., 720., 0.), 80.);
        assert_eq!(native_y(true, 800., 76., 700.), 76.);
    }
}
