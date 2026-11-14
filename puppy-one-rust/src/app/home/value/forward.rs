//! Placeholder; replaced by the port of the moment's scene.
use crate::theme::Theme;
use gpui::{prelude::*, *};

pub(super) fn scene(_t: &Theme, scale: f32, _time: Option<f32>) -> AnyElement {
    div().size(px(380. * scale)).into_any_element()
}
