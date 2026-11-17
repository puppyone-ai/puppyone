//! Code block highlighting (features/code-block/codeBlockHighlight.ts with
//! code/codeLanguageSupport.ts and code/codeHighlightStyle.ts): the product
//! highlights only its supported languages, within a source budget, mapping
//! syntax to eleven colour roles. Parsing is GPUI Kit's tree-sitter
//! highlighter; its capture names resolve to the same roles.
use super::style::SyntaxColors;
use crate::editor::code::highlight::Roles;
use gpui::HighlightStyle;
use gpui_kit::component::{Rope, highlighter::SyntaxHighlighter};
use std::{cell::RefCell, collections::HashMap, ops::Range, sync::Arc};

/// `MARKDOWN_CODE_HIGHLIGHT_SOURCE_BYTE_LIMIT` / `_LINE_UNIT_LIMIT`.
const SOURCE_BYTE_LIMIT: usize = 16 * 1024;
const LINE_UNIT_LIMIT: usize = 4 * 1024;
/// `MARKDOWN_CODE_HIGHLIGHT_DOM_NODE_LIMIT`: segments (≈ two nodes each).
const SEGMENT_LIMIT: usize = 2048 / 2;

/// `resolveCodeLanguageKey(language, "")` → the Kit grammar for it, or
/// `None` for plain text (including languages the product does not support).
pub fn grammar(language: &str) -> Option<&'static str> {
    crate::editor::code::language::Language::resolve(Some(language), "").grammar()
}

/// `isWithinMarkdownCodeHighlightSourceBudget`.
fn within_budget(code: &str) -> bool {
    code.len() <= SOURCE_BYTE_LIMIT
        && code
            .split('\n')
            .all(|l| l.encode_utf16().count() <= LINE_UNIT_LIMIT)
}

/// Highlight ranges over a code block's text.
pub type Highlights = Arc<Vec<(Range<usize>, HighlightStyle)>>;

thread_local! {
    static CACHE: RefCell<HashMap<(u64, &'static str), Highlights>> = RefCell::default();
}

/// Highlight ranges for `code` (Kit `HighlightStyle` colours), cached by
/// content; empty when the product would show plain text.
pub fn highlight(code: &str, language: &str, colors: &SyntaxColors) -> Highlights {
    let Some(grammar) = grammar(language).filter(|_| within_budget(code)) else {
        return Arc::default();
    };
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (code, format!("{colors:?}")).hash(&mut h);
    let key = (h.finish(), grammar);
    if let Some(found) = CACHE.with(|c| c.borrow().get(&key).cloned()) {
        return found;
    }
    let mut highlighter = SyntaxHighlighter::new(grammar);
    highlighter.update(None, &Rope::from(code), None);
    let roles = Roles(colors.clone());
    let mut styles = highlighter.styles(&(0..code.len()), &roles);
    // Over the DOM budget the product shows the plain textarea.
    if styles.len() > SEGMENT_LIMIT {
        styles.clear();
    }
    let styles = Arc::new(styles);
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() > 256 {
            c.clear();
        }
        c.insert(key, styles.clone());
    });
    styles
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{editor::markdown::style::MarkdownTheme, typography::Scale};

    #[test]
    fn supported_languages_highlight_and_others_stay_plain() {
        let colors = MarkdownTheme::resolve(true, Scale::Medium)
            .code_block
            .syntax;
        let js = highlight("const x = \"a\"; // c", "js", &colors);
        assert!(!js.is_empty());
        let keyword = colors.keyword;
        assert!(
            js.iter()
                .any(|(r, s)| *r == (0..5) && s.color == Some(keyword.into())),
            "{js:?}"
        );
        assert!(highlight("fn main() {}", "rust", &colors).is_empty());
        assert!(highlight("x", "", &colors).is_empty());
    }
}
