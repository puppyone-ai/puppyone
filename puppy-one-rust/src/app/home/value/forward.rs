//! Placeholder; replaced by the port of the moment's scene.
use super::{Clock, Layout};
use crate::theme::Theme;
use gpui::{prelude::*, *};

pub(super) fn scene(_t: &Theme, layout: Layout, _clock: Clock) -> AnyElement {
    div().size(px(layout.hub)).into_any_element()
}
