//! Reading-weight part of `markdownContentLanguage.ts` and the editor's
//! language latch. Han content uses the explicit Medium weight; Latin, Kana
//! and Hangul use the normal reading weight. Do not freeze the entire app to
//! the language of the sample document used to import theme tokens.
#[derive(Default)]
pub struct ReadingLanguage {
    locale: String,
    han: bool,
    awaiting_content: bool,
    initialized: bool,
}

impl ReadingLanguage {
    /// Resolve on open / locale change, or when an empty document first gets
    /// content. Subsequent edits keep its language, exactly like the product.
    pub fn resolve(&mut self, text: &str, locale: &str) -> bool {
        if !self.initialized
            || self.locale != locale
            || (self.awaiting_content && !text.trim().is_empty())
        {
            self.han = uses_han_weight(text, locale);
            self.locale = locale.into();
            self.awaiting_content = text.trim().is_empty();
            self.initialized = true;
        }
        self.han
    }
}

fn uses_han_weight(text: &str, locale: &str) -> bool {
    let (mut han, mut kana, mut hangul, mut units) = (0, 0, 0, 0);
    for ch in text.chars() {
        units += ch.len_utf16();
        if units > 12_000 {
            break;
        }
        match ch as u32 {
            0x3040..=0x30ff | 0x31f0..=0x31ff => kana += 1,
            0x1100..=0x11ff | 0x3130..=0x318f | 0xac00..=0xd7af => hangul += 1,
            0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff => han += 1,
            _ => {}
        }
    }
    if kana >= 2 || hangul >= 2 {
        return false;
    }
    if han >= 2 {
        return true;
    }
    let locale = locale.trim().replace('_', "-").to_lowercase();
    locale == "zh" || locale.starts_with("zh-")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reading_weight_follows_content_then_interface_and_stays_latched() {
        assert!(!uses_han_weight("English", "en"));
        assert!(uses_han_weight("English", "zh-Hans"));
        assert!(uses_han_weight("中文", "en"));
        assert!(uses_han_weight("漢字", "en"));
        assert!(!uses_han_weight("漢字かな", "zh-Hans"));
        assert!(!uses_han_weight("한국어", "zh-Hans"));
        assert!(!uses_han_weight(
            &format!("{}中文", "x".repeat(12_000)),
            "en"
        ));
        let mut language = ReadingLanguage::default();
        assert!(!language.resolve("", "en"));
        assert!(language.resolve("中文", "en"));
        assert!(language.resolve("English", "en"));
        assert!(!language.resolve("English", "ja"));
    }
}
