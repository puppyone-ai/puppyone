//! Shared product syntax roles, resolved over Kit tree-sitter captures.
use gpui::{HighlightStyle, Rgba};

/// The product's eleven syntax colour roles (`--po-md-syntax-*`).
#[derive(Clone, Debug, PartialEq)]
pub struct SyntaxColors {
    pub comment: Rgba,
    pub keyword: Rgba,
    pub string: Rgba,
    pub constant: Rgba,
    pub special: Rgba,
    pub type_name: Rgba,
    pub function: Rgba,
    pub property: Rgba,
    pub operator: Rgba,
    pub meta: Rgba,
    pub invalid: Rgba,
}

/// `puppyCodeHighlightStyle`, keyed by tree-sitter capture names.
pub struct Roles(pub SyntaxColors);

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
