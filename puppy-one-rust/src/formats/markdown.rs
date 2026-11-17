//! Host metadata takes precedence over an explicit MDX filename signal.
//! Document contents never participate in dialect selection.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum MarkdownDialect {
    #[default]
    PuppyGfm,
    OpenKnowledgeMdx,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DialectSource {
    Explicit,
    Extension,
    Fallback,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DialectResolution {
    pub dialect: MarkdownDialect,
    pub source: DialectSource,
}
impl MarkdownDialect {
    pub fn from_host(value: &str) -> Option<Self> {
        match value {
            "puppy-gfm" => Some(Self::PuppyGfm),
            "openknowledge-mdx" => Some(Self::OpenKnowledgeMdx),
            _ => None,
        }
    }
    pub fn resolve(path: &str, explicit: Option<Self>) -> DialectResolution {
        if let Some(dialect) = explicit {
            return DialectResolution {
                dialect,
                source: DialectSource::Explicit,
            };
        }
        let name = path.trim().split(['?', '#']).next().unwrap_or_default();
        if name.to_ascii_lowercase().ends_with(".mdx") {
            DialectResolution {
                dialect: Self::OpenKnowledgeMdx,
                source: DialectSource::Extension,
            }
        } else {
            DialectResolution {
                dialect: Self::PuppyGfm,
                source: DialectSource::Fallback,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_metadata_precedes_extensions_and_invalid_metadata_has_no_authority() {
        for (name, explicit, dialect, source) in [
            (
                "notes/example.md",
                Some("openknowledge-mdx"),
                MarkdownDialect::OpenKnowledgeMdx,
                DialectSource::Explicit,
            ),
            (
                "notes/example.mdx",
                Some("puppy-gfm"),
                MarkdownDialect::PuppyGfm,
                DialectSource::Explicit,
            ),
            (
                "notes/example.mdx#section",
                Some("unknown-dialect"),
                MarkdownDialect::OpenKnowledgeMdx,
                DialectSource::Extension,
            ),
            (
                "notes/example.md",
                Some("unknown-dialect"),
                MarkdownDialect::PuppyGfm,
                DialectSource::Fallback,
            ),
            (
                " notes/example.MDX?revision=2 ",
                None,
                MarkdownDialect::OpenKnowledgeMdx,
                DialectSource::Extension,
            ),
            (
                "notes/<Tabs><Tab label='x'>.md",
                None,
                MarkdownDialect::PuppyGfm,
                DialectSource::Fallback,
            ),
        ] {
            assert_eq!(
                MarkdownDialect::resolve(name, explicit.and_then(MarkdownDialect::from_host)),
                DialectResolution { dialect, source }
            );
        }
        for invalid in ["", "OPENKNOWLEDGE-MDX", " puppy-gfm", "null"] {
            assert_eq!(MarkdownDialect::from_host(invalid), None);
        }
    }
}
