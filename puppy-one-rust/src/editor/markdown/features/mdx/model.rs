//! MDX component declarative model and budget validation (`mdxComponentModel.ts`, `MA-04`: zero `gpui`).
use super::syntax::{Token, scan};
use crate::editor::markdown::core::plans::execution::{
    MDX_RICH_BYTES, MDX_RICH_DEPTH, MDX_RICH_NODES,
};
use std::ops::Range;

pub const MAX_NESTING: usize = 64;
pub const MAX_TABS: usize = 64;
pub const MAX_LABEL: usize = 200;

/// `mdx-component.malformed`: the tags do not pair, or text follows the
/// root's close.
pub const MALFORMED: &str = "mdx-component.malformed";
/// `mdx-component.unsupported`: a component, prop or child shape the
/// declarative registry does not render.
pub const UNSUPPORTED: &str = "mdx-component.unsupported";
/// `mdx-component.render-budget`: beyond the rich-render budget.
pub const RENDER_BUDGET: &str = "mdx-component.render-budget";

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct Tab {
    pub label: String,
    pub content: String,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct TabsBlock {
    /// Whole source lines.
    pub range: Range<usize>,
    pub tabs: Vec<Tab>,
}

/// `parseLiteralAttributes`: only quoted literal props, no expressions,
/// spreads or repeats.
fn literal_attributes(s: &str) -> Option<Vec<(String, String)>> {
    let b = s.as_bytes();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut i = 0;
    loop {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() {
            return Some(out);
        }
        if b[i] == b'{' || s[i..].starts_with("...") {
            return None;
        }
        let name_from = i;
        if !(b[i].is_ascii_alphabetic() || matches!(b[i], b'_' | b':')) {
            return None;
        }
        while i < b.len()
            && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'.' | b':' | b'-'))
        {
            i += 1;
        }
        let name = &s[name_from..i];
        if out.iter().any(|(n, _)| n == name) {
            return None;
        }
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if b.get(i) != Some(&b'=') {
            return None;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let quote = *b.get(i)?;
        if quote != b'"' && quote != b'\'' {
            return None;
        }
        let value_from = i + 1;
        let value_to = value_from + s[value_from..].find(quote as char)?;
        out.push((name.to_owned(), s[value_from..value_to].to_owned()));
        i = value_to + 1;
    }
}

/// `parseMarkdownMdxComponent` for a `Tabs` block: its tabs, if complete,
/// supported and within the render budget, else the diagnostic code.
pub fn tabs(source: &str) -> Result<Vec<Tab>, &'static str> {
    let tokens = scan(source, 0);
    let (Some(root), Some(last)) = (tokens.first(), tokens.last()) else {
        return Err(MALFORMED);
    };
    if root.closing || root.from != 0 {
        return Err(MALFORMED);
    }
    // `validateBalancedTokens`.
    let mut stack: Vec<&str> = Vec::new();
    let mut depth = 0;
    for (idx, t) in tokens.iter().enumerate() {
        if t.closing {
            if stack.pop() != Some(t.name.as_str()) {
                return Err(MALFORMED);
            }
            if stack.is_empty() && idx + 1 != tokens.len() {
                return Err(MALFORMED);
            }
        } else if !t.self_closing {
            stack.push(&t.name);
            depth = depth.max(stack.len());
            if stack.len() > MAX_NESTING {
                return Err(MALFORMED);
            }
        }
    }
    if !stack.is_empty() {
        return Err(MALFORMED);
    }
    if root.name != "Tabs" || root.self_closing || tokens.len() < 2 {
        return Err(UNSUPPORTED);
    }
    if !source[last.to..].trim().is_empty() {
        return Err(MALFORMED);
    }
    if literal_attributes(&root.attributes).is_none_or(|a| !a.is_empty()) {
        return Err(UNSUPPORTED);
    }
    let mut tabs = Vec::new();
    let mut stack: Vec<&Token> = vec![root];
    let mut direct = root.to;
    let mut active: Option<(&Token, String)> = None;
    for t in &tokens[1..tokens.len() - 1] {
        if t.closing {
            let opening = stack.pop().ok_or(MALFORMED)?;
            if opening.name != t.name {
                return Err(MALFORMED);
            }
            if opening.name == "Tab"
                && stack.len() == 1
                && let Some((open, label)) = active.take()
            {
                tabs.push(Tab {
                    label,
                    content: source[open.to..t.from].to_owned(),
                });
                direct = t.to;
            }
            continue;
        }
        if stack.len() == 1 {
            if !source[direct..t.from].trim().is_empty()
                || t.name != "Tab"
                || t.self_closing
                || tabs.len() >= MAX_TABS
            {
                return Err(UNSUPPORTED);
            }
            let attributes = literal_attributes(&t.attributes).ok_or(UNSUPPORTED)?;
            let label = match attributes.as_slice() {
                [(name, label)] if name == "label" && !label.is_empty() => label.clone(),
                _ => return Err(UNSUPPORTED),
            };
            if label.chars().count() > MAX_LABEL {
                return Err(UNSUPPORTED);
            }
            active = Some((t, label));
        }
        if !t.self_closing {
            stack.push(t);
        }
    }
    if !source[direct..last.from].trim().is_empty() || tabs.is_empty() {
        return Err(UNSUPPORTED);
    }
    // `decideMarkdownBlockExecution("mdxComponent")`.
    let nodes = tokens.len() * 2 + tabs.len() * 3;
    if source.len() <= MDX_RICH_BYTES && nodes <= MDX_RICH_NODES && depth <= MDX_RICH_DEPTH {
        Ok(tabs)
    } else {
        Err(RENDER_BUDGET)
    }
}
