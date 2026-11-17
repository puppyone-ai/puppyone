//! Inline decorations (`inlineDecorations.ts` `addInlineMarkdownDecorations`):
//! turns the inline plans of one line into hidden delimiters (or revealed
//! source), class spans, and first-class [`InlineWidget`]s (`TA-12`, `TA-30`,
//! `TA-33`, `TA-40`). Contains zero feature-specific math/KaTeX logic.
use super::builder::{Builder, ClassSpan};
use crate::editor::{
    markdown::core::{
        classes::{Class, SourceSyntax},
        feature::{self, InlineWidgetCx},
        links,
        plans::{Atom, Plan, Presentation},
        syntax::{Element, Kind},
    },
    view::decoration::{InlineWidget, Superscript, Underline},
};
use gpui::SharedString;
use std::ops::Range;

impl Builder<'_> {
    /// `addInlineMarkdownDecorations` for the plans intersecting one line.
    pub fn inline(&mut self, line: usize, plans: &[&Plan], occupied: Vec<Range<usize>>) {
        let cx = self.cx;
        let range = cx.doc.line_range(line);
        let text_cow = cx.doc.line_cow(line);
        let text = text_cow.as_ref();
        let mut entries: Vec<(&Plan, &Element)> = plans
            .iter()
            .filter_map(|p| Some((*p, cx.syntax.elements.get(p.element?)?)))
            .filter(|(_, e)| {
                e.kind.inline() && e.range.start <= range.end && e.range.end >= range.start
            })
            .collect();
        entries.sort_by(|a, b| {
            a.1.kind
                .priority()
                .cmp(&b.1.kind.priority())
                .then(a.1.range.start.cmp(&b.1.range.start))
                .then(b.1.range.end.cmp(&a.1.range.end))
        });
        let link_tokens = links::find_links(text);
        let wiki_tokens = links::find_wiki_links(text);
        let widget_cx = InlineWidgetCx {
            doc: cx.doc,
            theme: cx.theme,
            assets: cx.assets,
            references: cx.references,
            state: &cx.preview.features,
        };

        for (plan, e) in entries {
            if occupied
                .iter()
                .any(|o| e.range.start < o.end && e.range.end > o.start)
            {
                continue;
            }
            let reveal = cx.preview.reveal.as_ref() == Some(&e.range);
            match e.kind {
                Kind::WikiLink => {
                    let token = wiki_tokens.iter().find(|t| {
                        range.start + t.range.start == e.range.start
                            && range.start + t.range.end == e.range.end
                    });
                    let (Some(token), Some(content)) =
                        (token, e.content.clone().filter(|c| c.start < c.end))
                    else {
                        continue;
                    };
                    self.hide(e.range.start..content.start, SourceSyntax::WikiLink, reveal);
                    self.hide(content.end..e.range.end, SourceSyntax::WikiLink, reveal);
                    let href = Some(SharedString::from(token.target.clone()));
                    let resolved = (!token.target.starts_with('#'))
                        .then(|| cx.references.map(|r| r.resolve(&token.target)))
                        .flatten();
                    let mut classes = Class::SYNTAX_LINK | Class::WIKI_LINK_LABEL;
                    if resolved.as_ref().is_some_and(|r| !r.exists) {
                        classes |= Class::IS_MISSING;
                    }
                    self.link_state(content.clone(), resolved.as_ref());
                    self.spans.push(ClassSpan {
                        range: content,
                        classes,
                        href,
                    });
                }
                Kind::Link => {
                    let Some(content) = e.content.clone().filter(|c| c.start < c.end) else {
                        continue;
                    };
                    let token = link_tokens.iter().find(|t| {
                        range.start + t.range.start == e.range.start
                            && range.start + t.range.end == e.range.end
                    });
                    let href = e
                        .href
                        .clone()
                        .or_else(|| token.map(|t| t.href.clone()))
                        .or_else(|| {
                            let first_byte = cx
                                .doc
                                .slice_cow(e.range.start..cx.doc.len().min(e.range.start + 1));
                            (first_byte.as_bytes().first() == Some(&b'<'))
                                .then(|| cx.doc.slice_cow(content.clone()).trim().to_owned())
                                .filter(|h| !h.is_empty())
                        });
                    let Some(href) = href else { continue };
                    let mut classes = Class::SYNTAX_LINK | Class::LINK_LABEL;
                    if is_external(&href) {
                        classes |= Class::IS_EXTERNAL;
                    }
                    let resolved = cx.references.and_then(|r| r.markdown(&href));
                    if resolved.as_ref().is_some_and(|r| !r.exists) {
                        classes |= Class::IS_MISSING;
                    }
                    self.link_state(content.clone(), resolved.as_ref());
                    let href = SharedString::from(href);
                    for marker in [e.range.start..content.start, content.end..e.range.end] {
                        if reveal {
                            self.spans.push(ClassSpan {
                                range: marker.clone(),
                                classes: SourceSyntax::Link.revealed(),
                                href: Some(href.clone()),
                            });
                        }
                        self.hide(marker, SourceSyntax::Link, reveal);
                    }
                    self.spans.push(ClassSpan {
                        range: content,
                        classes,
                        href: Some(href),
                    });
                }
                Kind::Strong | Kind::Emphasis | Kind::InlineCode | Kind::Strike => {
                    let Presentation::InlineMark { content, markers } = &plan.presentation else {
                        continue;
                    };
                    for m in markers {
                        self.hide(m.clone(), SourceSyntax::Delimiter, reveal);
                    }
                    let class = match e.kind {
                        Kind::Strong => Class::SYNTAX_STRONG,
                        Kind::Emphasis => Class::SYNTAX_EMPHASIS,
                        Kind::InlineCode => Class::SYNTAX_MONOSPACE,
                        _ => Class::SYNTAX_STRIKE,
                    };
                    self.spans.push(ClassSpan {
                        range: content.clone(),
                        classes: class,
                        href: None,
                    });
                }
                Kind::Escape => {
                    for m in &e.markers {
                        self.hide(m.clone(), SourceSyntax::Escape, false);
                    }
                }
                Kind::Highlight | Kind::LinkDefinition | Kind::Comment => {
                    let Presentation::InlineMark { content, markers } = &plan.presentation else {
                        continue;
                    };
                    for m in markers {
                        self.hide(m.clone(), SourceSyntax::Delimiter, reveal);
                    }
                    self.spans.push(ClassSpan {
                        range: content.clone(),
                        classes: match e.kind {
                            Kind::Highlight => Class::SYNTAX_HIGHLIGHT,
                            Kind::LinkDefinition => Class::LINK_DEFINITION,
                            _ => Class::COMMENT,
                        },
                        href: None,
                    });
                }
                Kind::InlineHtml => self.inline_html(plan, e, reveal),
                Kind::FeatureInline(fid) => {
                    if !reveal
                        && let Some(feat) = feature::find(cx.features, fid)
                        && let Some(Some((mut widget, classes))) =
                            feature::catch_feature_panic(feat.id(), "inline_widget", || {
                                feat.inline_widget(e, plan, &widget_cx)
                            })
                    {
                        widget.range = cx.doc.clamp_range(widget.range);
                        if !widget.range.is_empty() {
                            if classes != Class::NONE {
                                self.spans.push(ClassSpan {
                                    range: widget.range.clone(),
                                    classes,
                                    href: None,
                                });
                            }
                            self.inline_widgets.push(widget);
                        }
                    }
                }
                Kind::Emoji | Kind::Entity | Kind::FootnoteReference | Kind::FootnoteDefinition => {
                    if let Presentation::InlineAtom(Atom::Text(text)) = &plan.presentation
                        && !reveal
                    {
                        let shown = if e.kind == Kind::FootnoteDefinition {
                            format!("{text}\u{2002}")
                        } else {
                            text.clone()
                        };
                        let shown = SharedString::from(shown);
                        if e.kind == Kind::FootnoteReference {
                            self.inline_widgets.push(InlineWidget::superscript(
                                e.range.clone(),
                                shown.clone(),
                                Superscript {
                                    range: e.range.clone(),
                                    text: shown,
                                    size: Some(crate::theme::ty().ui.meta),
                                    color: Some(self.cx.theme.inline.link_color),
                                    lower: false,
                                },
                            ));
                        } else {
                            self.inline_widgets
                                .push(InlineWidget::text(e.range.clone(), shown));
                        }
                        let classes = match e.kind {
                            Kind::FootnoteReference => Some(Class::FOOTNOTE_REFERENCE),
                            Kind::FootnoteDefinition => Some(Class::FOOTNOTE),
                            _ => None,
                        };
                        if let Some(classes) = classes {
                            self.spans.push(ClassSpan {
                                range: e.range.clone(),
                                classes,
                                href: None,
                            });
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn link_state(
        &mut self,
        label: Range<usize>,
        resolved: Option<&crate::editor::navigation::Resolution>,
    ) {
        let Some(resolved) = resolved else { return };
        let inline = &self.cx.theme.inline;
        let size = self.cx.theme.body.text.size;
        let (color, dash, gap) = if !resolved.exists {
            (inline.missing_underline, 1., 2.)
        } else if resolved.ambiguous {
            (inline.ambiguous_underline, 3., 2.)
        } else {
            return;
        };
        self.underlines.push(Underline {
            range: label,
            color,
            dash,
            gap,
            size,
        });
    }

    fn inline_html(&mut self, plan: &Plan, e: &Element, reveal: bool) {
        let (Presentation::InlineMark { content, markers }, Some(tag)) =
            (&plan.presentation, e.html.as_deref())
        else {
            return;
        };
        if tag.name == "q" && !reveal {
            for (marker, quote) in markers.iter().zip(["\u{201c}", "\u{201d}"]) {
                self.inline_widgets
                    .push(InlineWidget::text(marker.clone(), quote));
            }
        } else {
            for m in markers {
                self.hide(m.clone(), SourceSyntax::Delimiter, reveal);
            }
        }
        let classes = match tag.name.as_str() {
            "b" | "strong" => Class::SYNTAX_STRONG,
            "i" | "em" | "cite" | "var" | "dfn" => Class::SYNTAX_EMPHASIS,
            "s" | "del" | "strike" => Class::SYNTAX_STRIKE,
            "u" | "ins" => Class::HTML_UNDERLINE,
            "code" | "kbd" | "samp" | "tt" => Class::SYNTAX_MONOSPACE,
            "mark" => Class::HTML_MARK,
            "sup" | "sub" if !reveal => {
                let content_str =
                    SharedString::from(self.cx.doc.slice_cow(content.clone()).into_owned());
                self.inline_widgets.push(InlineWidget::superscript(
                    content.clone(),
                    content_str.clone(),
                    Superscript {
                        range: content.clone(),
                        text: content_str,
                        size: None,
                        color: None,
                        lower: tag.name == "sub",
                    },
                ));
                Class::HTML_SHIFTED
            }
            _ => Class::NONE,
        };
        if classes != Class::NONE {
            self.spans.push(ClassSpan {
                range: content.clone(),
                classes,
                href: None,
            });
        }
        let css = |value: &Option<String>| {
            value
                .as_deref()
                .and_then(crate::editor::tokens::parse_css_color)
                .map(crate::editor::view::decoration::packed)
        };
        let (color, background) = (css(&tag.color), css(&tag.background));
        if color.is_some() || background.is_some() {
            self.colors.push((content.clone(), color, background));
        }
    }
}

fn is_external(href: &str) -> bool {
    let lower = href.trim().to_ascii_lowercase();
    lower.starts_with("//")
        || lower.split_once(':').is_some_and(|(scheme, _)| {
            scheme
                .bytes()
                .next()
                .is_some_and(|b| b.is_ascii_alphabetic())
                && scheme
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'.' | b'-'))
        })
}
