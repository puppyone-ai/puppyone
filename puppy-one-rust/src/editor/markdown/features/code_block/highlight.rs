//! Code block highlighting (features/code-block/codeBlockHighlight.ts with
//! code/codeLanguageSupport.ts and code/codeHighlightStyle.ts): the product
//! highlights only its supported languages, within a source budget, mapping
//! syntax to eleven colour roles. Parsing is GPUI Kit's tree-sitter
//! highlighter; its capture names resolve to the same roles.
use super::style::SyntaxColors;
use gpui::{HighlightStyle, Rgba};
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
    Some(match language.trim().to_ascii_lowercase().as_str() {
        "js" | "javascript" => "javascript",
        "jsx" => "javascript",
        "ts" | "typescript" => "typescript",
        "tsx" => "tsx",
        "py" | "python" => "python",
        "bash" | "zsh" | "sh" | "shell" => "bash",
        "yml" | "yaml" => "yaml",
        "css" | "scss" | "less" => "css",
        "html" => "html",
        "json" => "json",
        "sql" => "sql",
        "toml" => "toml",
        // `xml` has no Kit grammar; text / unknown stay plain.
        _ => return None,
    })
}

/// `isWithinMarkdownCodeHighlightSourceBudget`.
fn within_budget(code: &str) -> bool {
    code.len() <= SOURCE_BYTE_LIMIT
        && code
            .split('\n')
            .all(|l| l.encode_utf16().count() <= LINE_UNIT_LIMIT)
}

/// `puppyCodeHighlightStyle`, keyed by tree-sitter capture names.
struct Roles(SyntaxColors);

impl Roles {
    fn color(&self, name: &str) -> Option<Rgba> {
        let c = &self.0;
        let head = name.split('.').next().unwrap_or(name);
        Some(match (head, name) {
            ("comment", _) => c.comment,
            (
                _,
                "string.escape"
                | "string.regex"
                | "string.special"
                | "string.special.regex"
                | "escape",
            ) => c.special,
            ("string" | "character", _) => c.string,
            (
                "keyword" | "conditional" | "repeat" | "include" | "exception" | "storageclass"
                | "boolean_operator",
                _,
            ) => c.keyword,
            ("number" | "float" | "boolean" | "constant", _) => c.constant,
            ("type" | "tag" | "namespace" | "module" | "constructor", _) => c.type_name,
            ("function" | "method", _) => c.function,
            ("property" | "attribute" | "field", _) => c.property,
            ("operator", _) => c.operator,
            ("preproc" | "meta" | "annotation" | "label", _) => c.meta,
            ("error" | "invalid", _) => c.invalid,
            _ => return None,
        })
    }
}

impl gpui_kit::base::input::HighlightStyleResolver for Roles {
    fn style(&self, name: &str) -> Option<HighlightStyle> {
        self.color(name).map(|c| HighlightStyle {
            color: Some(c.into()),
            ..Default::default()
        })
    }
}

thread_local! {
    static CACHE: RefCell<HashMap<(u64, &'static str), Arc<Vec<(Range<usize>, HighlightStyle)>>>> = RefCell::default();
}

/// Highlight ranges for `code` (Kit `HighlightStyle` colours), cached by
/// content; empty when the product would show plain text.
pub fn highlight(
    code: &str,
    language: &str,
    colors: &SyntaxColors,
) -> Arc<Vec<(Range<usize>, HighlightStyle)>> {
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
        let keyword: Rgba = colors.keyword;
        assert!(
            js.iter()
                .any(|(r, s)| *r == (0..5) && s.color == Some(keyword.into())),
            "{js:?}"
        );
        assert!(highlight("fn main() {}", "rust", &colors).is_empty());
        assert!(highlight("x", "", &colors).is_empty());
    }
}
