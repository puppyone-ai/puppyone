//! Text rasterization that matches the product.
//!
//! Delegates to [`crate::platform::window::match_product_font_smoothing`].
pub fn match_product_font_smoothing() {
    super::window::match_product_font_smoothing();
}
