//! A PostCSS-shaped reader for Sub Theme CSS: comments, at-rules with or
//! without blocks, rules and declarations. Strings, escapes, comments and
//! `(`/`[` nesting are respected the way PostCSS does, so `;` inside
//! `url(data:…;base64,…)` does not end a declaration. Comments are removed
//! from selectors, parameters and values (PostCSS keeps them only in `raws`).
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Comment,
    AtRule(AtRule),
    Rule(Rule),
    Decl(Decl),
}

#[derive(Clone, Debug, PartialEq)]
pub struct AtRule {
    pub name: String,
    pub params: String,
    /// `None` for a statement (`@import "a.css";`).
    pub nodes: Option<Vec<Node>>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub selector: String,
    pub nodes: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Decl {
    pub prop: String,
    pub value: String,
    pub important: bool,
    /// The package-relative file the declaration was read from; assets
    /// resolve against it after imports are inlined.
    pub file: Arc<str>,
}

/// Parse `css`; errors read like PostCSS's (`file:line:column: reason`).
pub fn parse(css: &str, file: &str) -> Result<Vec<Node>, String> {
    let mut reader = Reader {
        src: css,
        i: 0,
        file: Arc::from(file),
    };
    reader.nodes(None)
}

struct Reader<'a> {
    src: &'a str,
    i: usize,
    file: Arc<str>,
}

impl Reader<'_> {
    fn bytes(&self) -> &[u8] {
        self.src.as_bytes()
    }
    fn error(&self, at: usize, reason: &str) -> String {
        let before = &self.src[..at.min(self.src.len())];
        let line = before.matches('\n').count() + 1;
        let column = before
            .rsplit_once('\n')
            .map_or(before, |(_, tail)| tail)
            .chars()
            .count()
            + 1;
        format!("{}:{line}:{column}: {reason}", self.file)
    }
    fn skip_space(&mut self) {
        while self.i < self.src.len() && self.bytes()[self.i].is_ascii_whitespace() {
            self.i += 1;
        }
    }
    /// The end of the comment opening at `start` (just past `*/`).
    fn comment_end(&self, start: usize) -> Result<usize, String> {
        self.src[start + 2..]
            .find("*/")
            .map(|end| start + 2 + end + 2)
            .ok_or_else(|| self.error(start, "Unclosed comment"))
    }
    fn nodes(&mut self, open: Option<usize>) -> Result<Vec<Node>, String> {
        let mut out = Vec::new();
        loop {
            self.skip_space();
            let Some(&c) = self.bytes().get(self.i) else {
                return match open {
                    Some(at) => Err(self.error(at, "Unclosed block")),
                    None => Ok(out),
                };
            };
            match c {
                b'/' if self.bytes().get(self.i + 1) == Some(&b'*') => {
                    self.i = self.comment_end(self.i)?;
                    out.push(Node::Comment);
                }
                b'}' => {
                    if open.is_none() {
                        return Err(self.error(self.i, "Unexpected }"));
                    }
                    self.i += 1;
                    return Ok(out);
                }
                b';' => self.i += 1,
                b'@' => out.push(self.at_rule()?),
                _ => out.push(self.rule_or_decl()?),
            }
        }
    }
    /// Text up to the next top-level `{`, `;` or `}` (not consumed), with
    /// comments removed.
    fn prelude(&mut self) -> Result<(String, Option<u8>), String> {
        let mut text = String::new();
        let mut depth = 0usize;
        let mut segment = self.i;
        loop {
            let Some(&c) = self.bytes().get(self.i) else {
                text.push_str(&self.src[segment..]);
                return Ok((text, None));
            };
            match c {
                b'"' | b'\'' => {
                    let start = self.i;
                    self.i += 1;
                    loop {
                        match self.bytes().get(self.i) {
                            None => return Err(self.error(start, "Unclosed string")),
                            Some(b'\\') => self.i += 2,
                            Some(&q) if q == c => {
                                self.i += 1;
                                break;
                            }
                            Some(_) => self.i += 1,
                        }
                    }
                }
                b'/' if self.bytes().get(self.i + 1) == Some(&b'*') => {
                    text.push_str(&self.src[segment..self.i]);
                    self.i = self.comment_end(self.i)?;
                    segment = self.i;
                }
                b'\\' => self.i = (self.i + 2).min(self.src.len()),
                b'(' | b'[' => {
                    depth += 1;
                    self.i += 1;
                }
                b')' | b']' => {
                    depth = depth.saturating_sub(1);
                    self.i += 1;
                }
                b'{' | b';' | b'}' if depth == 0 => {
                    text.push_str(&self.src[segment..self.i]);
                    return Ok((text, Some(c)));
                }
                _ => self.i += 1,
            }
        }
    }
    fn at_rule(&mut self) -> Result<Node, String> {
        let start = self.i;
        self.i += 1;
        let name_start = self.i;
        while let Some(&c) = self.bytes().get(self.i) {
            if c.is_ascii_whitespace() || b"\"#'()/;[\\]{}".contains(&c) {
                break;
            }
            self.i += 1;
        }
        let name = self.src[name_start..self.i].to_owned();
        let (params, end) = self.prelude()?;
        let nodes = match end {
            Some(b'{') => {
                self.i += 1;
                Some(self.nodes(Some(start))?)
            }
            Some(b';') => {
                self.i += 1;
                None
            }
            _ => None,
        };
        Ok(Node::AtRule(AtRule {
            name,
            params: params.trim().to_owned(),
            nodes,
        }))
    }
    fn rule_or_decl(&mut self) -> Result<Node, String> {
        let start = self.i;
        let (text, end) = self.prelude()?;
        if end == Some(b'{') {
            self.i += 1;
            return Ok(Node::Rule(Rule {
                selector: text.trim().to_owned(),
                nodes: self.nodes(Some(start))?,
            }));
        }
        if end == Some(b';') {
            self.i += 1;
        }
        let Some(colon) = top_level_colon(&text) else {
            return Err(self.error(start, "Unknown word"));
        };
        let prop = text[..colon].trim();
        if prop.is_empty() {
            return Err(self.error(start, "Unknown word"));
        }
        let mut value = text[colon + 1..].trim();
        let mut important = false;
        if let Some(bang) = value.rfind('!')
            && value[bang + 1..].trim().eq_ignore_ascii_case("important")
        {
            important = true;
            value = value[..bang].trim_end();
        }
        Ok(Node::Decl(Decl {
            prop: prop.to_owned(),
            value: value.to_owned(),
            important,
            file: self.file.clone(),
        }))
    }
}

fn top_level_colon(text: &str) -> Option<usize> {
    let mut quote = None;
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        match quote {
            Some(_) if c == b'\\' => i += 1,
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'"' || c == b'\'' => quote = Some(c),
            None if c == b':' => return Some(i),
            None => {}
        }
        i += 1;
    }
    None
}

/// Every rule, depth first in document order (`root.walkRules`), with
/// whether its parent is the root.
pub fn rules(nodes: &[Node]) -> Vec<(&Rule, bool)> {
    fn walk<'a>(nodes: &'a [Node], top: bool, out: &mut Vec<(&'a Rule, bool)>) {
        for node in nodes {
            match node {
                Node::Rule(rule) => {
                    out.push((rule, top));
                    walk(&rule.nodes, false, out);
                }
                Node::AtRule(AtRule {
                    nodes: Some(children),
                    ..
                }) => walk(children, false, out),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(nodes, true, &mut out);
    out
}

/// Every declaration in document order (`root.walkDecls`).
pub fn decls(nodes: &[Node]) -> Vec<&Decl> {
    fn walk<'a>(nodes: &'a [Node], out: &mut Vec<&'a Decl>) {
        for node in nodes {
            match node {
                Node::Decl(decl) => out.push(decl),
                Node::Rule(rule) => walk(&rule.nodes, out),
                Node::AtRule(AtRule {
                    nodes: Some(children),
                    ..
                }) => walk(children, out),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(nodes, &mut out);
    out
}

/// Visit every node mutably, depth first (`walk*` with mutation).
pub fn for_each_mut(nodes: &mut [Node], f: &mut dyn FnMut(&mut Node)) {
    for node in nodes {
        f(node);
        match node {
            Node::Rule(rule) => for_each_mut(&mut rule.nodes, f),
            Node::AtRule(AtRule {
                nodes: Some(children),
                ..
            }) => for_each_mut(children, f),
            _ => {}
        }
    }
}

/// Every at-rule with whether it sits at the root (`root.walkAtRules`).
pub fn at_rules(nodes: &[Node]) -> Vec<(&AtRule, bool)> {
    fn walk<'a>(nodes: &'a [Node], top: bool, out: &mut Vec<(&'a AtRule, bool)>) {
        for node in nodes {
            match node {
                Node::AtRule(rule) => {
                    out.push((rule, top));
                    if let Some(children) = &rule.nodes {
                        walk(children, false, out);
                    }
                }
                Node::Rule(rule) => walk(&rule.nodes, false, out),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    walk(nodes, true, &mut out);
    out
}

/// Split a selector list at top-level commas (`splitSelectors`).
pub fn split_selectors(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let (mut start, mut depth, mut quote) = (0, 0i32, None);
    let bytes = value.as_bytes();
    for (i, &c) in bytes.iter().enumerate() {
        if let Some(q) = quote {
            if c == q && (i == 0 || bytes[i - 1] != b'\\') {
                quote = None;
            }
            continue;
        }
        match c {
            b'"' | b'\'' => quote = Some(c),
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth -= 1,
            b',' if depth == 0 => {
                out.push(value[start..i].trim().to_owned());
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(value[start..].trim().to_owned());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn reads_blocks_statements_and_declarations() {
        let nodes = parse(
            "@charset \"utf-8\";\n/* c */\n@puppyone application {\n  :root /* x */ { --po-a: url(data:font/woff2;base64,AA==); --po-b: red !important }\n}\n",
            "theme.css",
        )
        .unwrap();
        assert_eq!(nodes.len(), 3);
        let Node::AtRule(block) = &nodes[2] else {
            panic!()
        };
        assert_eq!(
            (block.name.as_str(), block.params.as_str()),
            ("puppyone", "application")
        );
        let Node::Rule(rule) = &block.nodes.as_ref().unwrap()[0] else {
            panic!()
        };
        assert_eq!(rule.selector, ":root");
        let decls = decls(&nodes);
        assert_eq!(decls[0].value, "url(data:font/woff2;base64,AA==)");
        assert!(!decls[0].important);
        assert_eq!((decls[1].value.as_str(), decls[1].important), ("red", true));
        assert_eq!(&*decls[1].file, "theme.css");
    }

    #[test]
    fn errors_name_the_position_like_postcss() {
        assert_eq!(
            parse("@puppyone-theme { id: x;\n", "bad.css").unwrap_err(),
            "bad.css:1:1: Unclosed block"
        );
        assert_eq!(
            parse("a {}\n}", "x.css").unwrap_err(),
            "x.css:2:1: Unexpected }"
        );
        assert_eq!(
            parse("a { b: \"c }", "x.css").unwrap_err(),
            "x.css:1:8: Unclosed string"
        );
        assert_eq!(
            parse("/* open", "x.css").unwrap_err(),
            "x.css:1:1: Unclosed comment"
        );
        assert_eq!(
            parse("a { word }", "x.css").unwrap_err(),
            "x.css:1:5: Unknown word"
        );
        assert_eq!(
            split_selectors(":root, .dark :is(a, b), [x=\",\"]"),
            [":root", ".dark :is(a, b)", "[x=\",\"]"]
        );
    }
}
