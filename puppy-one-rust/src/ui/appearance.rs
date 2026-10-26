//! The active appearance — colour mode, Sub Theme palette, text-size preset
//! and pointer style — as a GPUI global.
//!
//! Components read it through [`ActiveAppearance`] (`cx.palette()`,
//! `cx.is_dark()`) instead of receiving a palette from their caller. There is
//! one writer, [`Appearance::apply`], which also projects the palette onto
//! GPUI Kit's theme and the process-wide type tables (`theme::ty()`), so the
//! three can never disagree.
use crate::{
    theme::{self, Theme},
    typography::Scale,
};
use gpui::{App, Global, SharedString, Window};

#[derive(Clone)]
pub struct Appearance {
    pub dark: bool,
    /// Sub Theme pack id (`default.neutral`, …).
    pub pack: SharedString,
    pub scale: Scale,
    pub pointer_cursors: bool,
    pub loading_style: crate::ui::loading::LoadingStyle,
    /// The pack's palette in this colour mode.
    pub palette: Theme,
}
impl Global for Appearance {}
impl Default for Appearance {
    fn default() -> Self {
        Self::new(true, theme::DEFAULT_PACK, Scale::Medium, false)
    }
}
impl Appearance {
    pub fn new(dark: bool, pack: &str, scale: Scale, pointer_cursors: bool) -> Self {
        Self {
            dark,
            pack: SharedString::from(pack.to_owned()),
            scale,
            pointer_cursors,
            loading_style: Default::default(),
            palette: theme::pack_theme(pack, dark),
        }
    }
    pub fn with_loading(mut self, style: crate::ui::loading::LoadingStyle) -> Self {
        self.loading_style = style;
        self
    }
    /// The same appearance in another colour mode.
    pub fn with_dark(&self, dark: bool) -> Self {
        Self::new(dark, &self.pack, self.scale, self.pointer_cursors)
            .with_loading(self.loading_style)
    }
    /// Install as the active appearance. Returns whether anything changed;
    /// windows refresh on their next frame.
    pub fn apply(self, window: Option<&mut Window>, cx: &mut App) -> bool {
        let changed = cx.try_global::<Self>().is_none_or(|current| {
            (
                current.dark,
                &current.pack,
                current.scale,
                current.pointer_cursors,
                current.loading_style,
            ) != (
                self.dark,
                &self.pack,
                self.scale,
                self.pointer_cursors,
                self.loading_style,
            )
        });
        theme::set_scale(self.scale);
        theme::set_pack(&self.pack);
        theme::set_pointer_cursors(self.pointer_cursors);
        theme::sync_kit(self.dark, window, cx);
        cx.set_global(self);
        changed
    }
}

/// Read access to the active [`Appearance`] from any context.
pub trait ActiveAppearance {
    /// The active palette (`Theme` is `Copy`; read it once per render).
    fn palette(&self) -> Theme;
    fn is_dark(&self) -> bool;
}
impl ActiveAppearance for App {
    fn palette(&self) -> Theme {
        self.try_global::<Appearance>()
            .map(|a| a.palette)
            .unwrap_or_else(|| theme::pack_theme(theme::DEFAULT_PACK, true))
    }
    fn is_dark(&self) -> bool {
        self.try_global::<Appearance>().is_none_or(|a| a.dark)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn one_writer_installs_the_palette_and_the_type_scale(cx: &mut gpui::TestAppContext) {
        cx.update(|cx| {
            assert!(cx.is_dark(), "dark until preferences say otherwise");
            let light = Appearance::new(false, theme::DEFAULT_PACK, Scale::Large, false);
            assert!(light.clone().apply(None, cx));
            assert!(!cx.is_dark());
            assert_eq!(
                cx.palette().text,
                theme::pack_theme(theme::DEFAULT_PACK, false).text
            );
            assert_eq!(theme::scale(), Scale::Large);
            assert!(
                !light.apply(None, cx),
                "re-applying the same appearance is a no-op"
            );
            Appearance::default().apply(None, cx);
            assert_eq!(theme::scale(), Scale::Medium);
        });
    }
}
