//! GPUI presentation primitives and text input; no document or service ownership.
pub mod agent_brands;
pub mod agent_creature;
pub mod appearance;
#[cfg(feature = "dev-capture")]
pub mod asset_gallery;
pub mod components;
pub mod fonts;
pub mod form_input;
mod fractional_text;
#[cfg(feature = "dev-capture")]
pub mod gallery;
pub mod ime;
pub mod input;
pub mod loading;
pub mod motion;
pub mod resource_drag;
pub mod scrollbar;
pub use fractional_text::fractional_text;

use gpui::{App, Context, WeakEntity, Window};
/// [`Context::listener`] for an element built outside the entity's own
/// update: an entity draws a part of another's tree from a read
/// (`entity.read(cx).part(cx)`), and its handlers still reach it.
pub fn listener<T: 'static, E: ?Sized>(
    entity: &WeakEntity<T>,
    f: impl Fn(&mut T, &E, &mut Window, &mut Context<T>) + 'static,
) -> impl Fn(&E, &mut Window, &mut App) + 'static {
    let entity = entity.clone();
    move |event, window, cx| {
        let _ = entity.update(cx, |this, cx| f(this, event, window, cx));
    }
}
