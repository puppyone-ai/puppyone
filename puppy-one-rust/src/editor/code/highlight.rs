//! Shared product syntax roles (`--po-md-syntax-*`), evaluated through
//! [`Tokens::get`] so active Sub Theme overrides take effect at runtime (`CE-11`).
use crate::{editor::tokens::Tokens, typography::Scale};
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

impl SyntaxColors {
    /// Evaluate all eleven syntax colour roles through [`Tokens::get`], picking
    /// up any active Sub Theme overrides on `--po-md-syntax-*` (`CE-11`).
    pub fn resolve(dark: bool, scale: Scale) -> Self {
        let t = Tokens::get(dark, scale);
        Self {
            comment: t.color("--po-md-syntax-comment"),
            keyword: t.color("--po-md-syntax-keyword"),
            string: t.color("--po-md-syntax-string"),
            constant: t.color("--po-md-syntax-constant"),
            special: t.color("--po-md-syntax-special"),
            type_name: t.color("--po-md-syntax-type"),
            function: t.color("--po-md-syntax-function"),
            property: t.color("--po-md-syntax-property"),
            operator: t.color("--po-md-syntax-operator"),
            meta: t.color("--po-md-syntax-meta"),
            invalid: t.color("--po-md-error-color"),
        }
    }
}

/// `puppyCodeHighlightStyle`, keyed by tree-sitter capture names.
pub struct Roles(pub SyntaxColors);

impl Roles {
    /// Returns `(color, bold)` for a tree-sitter capture name.
    pub fn role_style(&self, name: &str) -> Option<(Rgba, bool)> {
        let c = &self.0;
        let head = name.split('.').next().unwrap_or(name);
        let bold = matches!(
            head,
            "keyword"
                | "conditional"
                | "repeat"
                | "include"
                | "exception"
                | "storageclass"
                | "boolean_operator"
        );
        let color = match (head, name) {
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
        };
        Some((color, bold))
    }
}

impl gpui_kit::base::input::HighlightStyleResolver for Roles {
    fn style(&self, name: &str) -> Option<HighlightStyle> {
        self.role_style(name).map(|(c, _)| HighlightStyle {
            color: Some(c.into()),
            ..Default::default()
        })
    }
}
