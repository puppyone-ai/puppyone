//! The CSS classes the product's Markdown pipeline puts on `.cm-line` boxes
//! and inline spans. Decorations produce class sets; the stylesheet
//! (`markdown::stylesheet`) resolves them with the product's CSS cascade.
use super::syntax::Hl;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Class(pub u64);

macro_rules! classes {
    ($($(#[$doc:meta])* $name:ident = $bit:expr;)*) => {
        impl Class {
            pub const NONE: Class = Class(0);
            $($(#[$doc])* pub const $name: Class = Class(1 << $bit);)*
        }
    };
}

classes! {
    // Line classes (blockDecorations.ts getMarkdownLineClasses / rhythm).
    /// `cm-md-heading`
    HEADING = 0;
    /// `cm-md-blockquote`
    BLOCKQUOTE = 1;
    /// `cm-md-code-fence`
    CODE_FENCE = 2;
    /// `cm-md-code-block-line`
    CODE_BLOCK_LINE = 3;
    /// `cm-md-hr`
    HR = 4;
    /// `cm-md-table-line`
    TABLE_LINE = 5;
    /// `cm-md-source-line`
    SOURCE_LINE = 6;
    /// `cm-md-list-source-line`
    LIST_SOURCE_LINE = 7;
    /// `cm-md-list-line`
    LIST_LINE = 8;
    /// `cm-md-ordered-list-line`
    ORDERED_LIST_LINE = 9;
    /// `cm-md-nested-list-line`
    NESTED_LIST_LINE = 10;
    /// `cm-md-list-continuation`
    LIST_CONTINUATION = 11;
    /// `cm-md-task-line`
    TASK_LINE = 12;
    /// `cm-md-task-checked`
    TASK_CHECKED = 13;
    /// `cm-md-paragraph-start`
    PARAGRAPH_START = 14;
    /// `cm-md-paragraph-end`
    PARAGRAPH_END = 15;
    /// `cm-md-list-item-start`
    LIST_ITEM_START = 16;
    /// `cm-md-list-item-end`
    LIST_ITEM_END = 17;
    /// `cm-md-list-start`
    LIST_START = 18;
    /// `cm-md-list-end`
    LIST_END = 19;
    // Highlight classes (`puppyMarkdownHighlightStyle`).
    /// `cm-md-syntax-heading`
    SYNTAX_HEADING = 20;
    /// `cm-md-syntax-strong`
    SYNTAX_STRONG = 21;
    /// `cm-md-syntax-emphasis`
    SYNTAX_EMPHASIS = 22;
    /// `cm-md-syntax-strikethrough`
    SYNTAX_STRIKE = 23;
    /// `cm-md-syntax-link`
    SYNTAX_LINK = 24;
    /// `cm-md-syntax-monospace`
    SYNTAX_MONOSPACE = 25;
    /// `cm-md-syntax-markup`
    SYNTAX_MARKUP = 26;
    /// `cm-md-syntax-quote`
    SYNTAX_QUOTE = 27;
    /// `cm-md-syntax-list`
    SYNTAX_LIST = 28;
    // Link label decorations (inlineDecorations.ts).
    /// `cm-md-link-label`
    LINK_LABEL = 29;
    /// `cm-md-wiki-link-label`
    WIKI_LINK_LABEL = 30;
    /// `is-external`
    IS_EXTERNAL = 31;
    /// `is-missing`
    #[expect(
        dead_code,
        reason = "product class for unresolved wiki links; no workspace resolver yet"
    )]
    IS_MISSING = 32;
    // Revealed source (decorationPrimitives.ts addSourceSyntaxDecoration).
    /// `cm-md-source-syntax`
    SOURCE_SYNTAX = 33;
    /// `cm-md-source-syntax-heading`
    SOURCE_SYNTAX_HEADING = 34;
    /// `cm-md-source-syntax-list`
    SOURCE_SYNTAX_LIST = 35;
    /// `cm-md-source-syntax-task`
    SOURCE_SYNTAX_TASK = 36;
}

impl Class {
    pub fn has(self, other: Class) -> bool {
        self.0 & other.0 == other.0
    }
    pub fn any(self, other: Class) -> bool {
        self.0 & other.0 != 0
    }
    /// The classes `highlightTree` writes for a highlight span.
    pub fn from_hl(hl: Hl) -> Class {
        let mut c = Class::NONE;
        for (h, class) in [
            (Hl::HEADING, Class::SYNTAX_HEADING),
            (Hl::STRONG, Class::SYNTAX_STRONG),
            (Hl::EMPHASIS, Class::SYNTAX_EMPHASIS),
            (Hl::STRIKE, Class::SYNTAX_STRIKE),
            (Hl::LINK, Class::SYNTAX_LINK),
            (Hl::MONOSPACE, Class::SYNTAX_MONOSPACE),
            (Hl::MARKUP, Class::SYNTAX_MARKUP),
            (Hl::QUOTE, Class::SYNTAX_QUOTE),
            (Hl::LIST, Class::SYNTAX_LIST),
        ] {
            if hl.has(h) {
                c |= class;
            }
        }
        c
    }
}

impl std::ops::BitOr for Class {
    type Output = Class;
    fn bitor(self, rhs: Class) -> Class {
        Class(self.0 | rhs.0)
    }
}

impl std::ops::BitOrAssign for Class {
    fn bitor_assign(&mut self, rhs: Class) {
        self.0 |= rhs.0;
    }
}

impl std::ops::Sub for Class {
    type Output = Class;
    fn sub(self, rhs: Class) -> Class {
        Class(self.0 & !rhs.0)
    }
}

/// The source-syntax kind of a hidden or revealed marker
/// (`MarkdownSourceSyntaxKind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceSyntax {
    Blockquote,
    Delimiter,
    Escape,
    Heading,
    Link,
    List,
    Task,
    WikiLink,
}

impl SourceSyntax {
    /// Classes of a revealed marker (`cm-md-source-syntax cm-md-source-syntax-<kind>`).
    pub fn revealed(self) -> Class {
        Class::SOURCE_SYNTAX
            | match self {
                Self::Heading => Class::SOURCE_SYNTAX_HEADING,
                Self::List => Class::SOURCE_SYNTAX_LIST,
                Self::Task => Class::SOURCE_SYNTAX_TASK,
                _ => Class::NONE,
            }
    }
}
