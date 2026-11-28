//! `markdownContentLanguage.ts` and the editor's language latch: the
//! language a document is written in, which names the editing surface's
//! `lang`. That picks the script fallback faces (Simplified versus
//! Traditional Chinese, Japanese, Korean); every language reads at the one
//! body weight. Do not freeze the entire app to the language of the sample
//! document used to import theme tokens.

/// `DOCUMENT_LANGUAGE_SAMPLE_LIMIT`, in UTF-16 units.
const SAMPLE_LIMIT: usize = 12_000;
/// `MIN_SCRIPT_SIGNAL`.
const MIN_SIGNAL: usize = 2;
// These are high-signal pairs, not a language dictionary. Explicit document
// metadata remains authoritative; this heuristic only chooses the CJK
// fallback when a Markdown file has no language metadata.
const SIMPLIFIED_HAN: &str = "体国学会发为个们后里台湾与点来说开关问题实际应该还让从么过齐户谈";
const TRADITIONAL_HAN: &str = "體國學會發為個們後裡臺灣與點來說開關問題實際應該還讓從麼過齊戶談";

/// Where a document's language came from (`MarkdownContentLanguageSource`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Explicit,
    Document,
    Interface,
}

/// `MarkdownContentLanguageResolution`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolution {
    pub language: String,
    pub source: Source,
}

impl Resolution {
    /// Chinese content (the Han script cascades).
    #[cfg(test)]
    pub fn han(&self) -> bool {
        self.language.starts_with("zh-")
    }
}

/// `resolveMarkdownContentLanguage`: explicit metadata wins; then Kana,
/// Hangul and Han in the document's opening, Han telling its variant by
/// high-signal characters; then the interface language.
pub fn resolve(content: &str, interface: &str, explicit: Option<&str>) -> Resolution {
    if let Some(explicit) = explicit.filter(|e| !e.trim().is_empty()) {
        return Resolution {
            language: normalize(explicit),
            source: Source::Explicit,
        };
    }
    let (mut han, mut kana, mut hangul, mut units) = (0, 0, 0, 0);
    let (mut simplified, mut traditional) = (0, 0);
    for ch in content.chars() {
        units += ch.len_utf16();
        if units > SAMPLE_LIMIT {
            break;
        }
        match ch as u32 {
            0x3040..=0x30ff | 0x31f0..=0x31ff => kana += 1,
            0x1100..=0x11ff | 0x3130..=0x318f | 0xac00..=0xd7af => hangul += 1,
            0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff => han += 1,
            _ => {}
        }
        simplified += usize::from(SIMPLIFIED_HAN.contains(ch));
        traditional += usize::from(TRADITIONAL_HAN.contains(ch));
    }
    let document = |language: &str| Resolution {
        language: language.into(),
        source: Source::Document,
    };
    if kana >= MIN_SIGNAL {
        return document("ja");
    }
    if hangul >= MIN_SIGNAL {
        return document("ko");
    }
    if han >= MIN_SIGNAL {
        // `inferHanVariant`: a tie follows the interface's variant.
        return document(if traditional > simplified {
            "zh-Hant"
        } else if simplified > traditional || normalize(interface) != "zh-Hant" {
            "zh-Hans"
        } else {
            "zh-Hant"
        });
    }
    Resolution {
        language: normalize(interface),
        source: Source::Interface,
    }
}

/// `normalizeContentLanguage`: Chinese as its script (Traditional for
/// `Hant`, Taiwan, Hong Kong and Macau), Japanese and Korean bare, any
/// other locale as written with hyphens.
pub fn normalize(locale: &str) -> String {
    let normalized = locale.trim().replace('_', "-");
    let lower = normalized.to_lowercase();
    if lower == "zh" || lower.starts_with("zh-") {
        let regional = lower
            .split('-')
            .skip(1)
            .any(|part| matches!(part, "tw" | "hk" | "mo"));
        return if lower.contains("hant") || regional {
            "zh-Hant"
        } else {
            "zh-Hans"
        }
        .into();
    }
    if lower == "ja" || lower.starts_with("ja-") {
        return "ja".into();
    }
    if lower == "ko" || lower.starts_with("ko-") {
        return "ko".into();
    }
    if normalized.is_empty() {
        "en".into()
    } else {
        normalized
    }
}

/// The editor's latch: resolved on open or locale change, or when an empty
/// document first gets content. Subsequent edits keep its language, exactly
/// like the product.
#[derive(Default)]
pub struct ReadingLanguage {
    locale: String,
    resolution: Option<Resolution>,
    awaiting_content: bool,
}

impl ReadingLanguage {
    pub fn resolve(&mut self, text: &str, locale: &str) -> &Resolution {
        if self.resolution.is_none()
            || self.locale != locale
            || (self.awaiting_content && !text.trim().is_empty())
        {
            // No caller names a document language yet (as in the product).
            self.resolution = Some(resolve(text, locale, None));
            self.locale = locale.into();
            self.awaiting_content = text.trim().is_empty();
        }
        self.resolution.as_ref().expect("resolved above")
    }

    /// Resolve over the leading prefix of `doc` without materialising the
    /// full contiguous buffer (`TA-01`).
    pub fn resolve_buffer(
        &mut self,
        doc: &crate::editor::text::buffer::Buffer,
        locale: &str,
    ) -> &Resolution {
        if self.resolution.is_none() || self.locale != locale || self.awaiting_content {
            let sample = doc.slice_cow(0..doc.len().min(48 * 1024));
            self.resolve(&sample, locale);
        }
        self.resolution.as_ref().expect("resolved above")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn han(text: &str, locale: &str) -> bool {
        resolve(text, locale, None).han()
    }

    /// `markdownContentLanguage.test.ts`: `prefers kana and hangul signals
    /// before the shared Han script`; `falls back to the interface language
    /// when the document has no script signal`.
    #[test]
    fn the_language_follows_content_then_interface_and_stays_latched() {
        assert!(!han("設計資料を更新する", "zh-CN"));
        assert_eq!(resolve("設計資料を更新する", "zh-CN", None).language, "ja");
        assert!(!han("문서 설계를 업데이트합니다", "en"));
        assert_eq!(
            resolve("문서 설계를 업데이트합니다", "en", None).language,
            "ko"
        );
        assert_eq!(
            resolve("# Release notes", "en-US", None),
            Resolution {
                language: "en-US".into(),
                source: Source::Interface
            }
        );
        assert!(!han("# Release notes", "en-US"));
        assert!(!han("English", "en"));
        assert!(han("English", "zh-Hans"));
        assert!(han("中文", "en"));
        assert!(han("漢字", "en"));
        assert!(!han("漢字かな", "zh-Hans"));
        assert!(!han("한국어", "zh-Hans"));
        assert!(!han(&format!("{}中文", "x".repeat(12_000)), "en"));
        let mut language = ReadingLanguage::default();
        assert!(!language.resolve("", "en").han());
        assert!(language.resolve("中文", "en").han());
        assert!(language.resolve("English", "en").han());
        assert!(!language.resolve("English", "ja").han());
    }

    /// `detects a Chinese document independently from the interface locale`.
    #[test]
    fn a_chinese_document_names_its_script_whatever_the_interface() {
        assert_eq!(
            resolve(
                "# 计划\n\n- 用户访谈集齐十个\n- 修复编辑器问题",
                "en-US",
                None
            ),
            Resolution {
                language: "zh-Hans".into(),
                source: Source::Document
            }
        );
        assert_eq!(
            resolve(
                "# 計畫\n\n- 使用者訪談集齊十個\n- 修復編輯器問題",
                "en-US",
                None
            ),
            Resolution {
                language: "zh-Hant".into(),
                source: Source::Document
            }
        );
        // No telling character: the interface's variant.
        assert_eq!(resolve("漢字", "zh-TW", None).language, "zh-Hant");
        assert_eq!(resolve("漢字", "en", None).language, "zh-Hans");
    }

    /// `keeps explicit metadata authoritative and normalizes locale variants`.
    #[test]
    fn explicit_metadata_wins_and_locales_normalize() {
        assert_eq!(
            resolve("简体内容", "en", Some("zh_TW")),
            Resolution {
                language: "zh-Hant".into(),
                source: Source::Explicit
            }
        );
        assert_eq!(
            resolve("简体内容", "en", Some("  ")).source,
            Source::Document
        );
        assert_eq!(normalize("zh-CN"), "zh-Hans");
        assert_eq!(normalize("en-US"), "en-US");
        assert_eq!(normalize("zh-Hant-HK"), "zh-Hant");
        assert_eq!(normalize("zh-hk"), "zh-Hant");
        assert_eq!(normalize("zh"), "zh-Hans");
        assert_eq!(normalize("ja_JP"), "ja");
        assert_eq!(normalize("ko-KR"), "ko");
        assert_eq!(normalize(" "), "en");
    }
}
