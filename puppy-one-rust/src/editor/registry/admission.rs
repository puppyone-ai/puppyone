//! Stat-first document admission (`RG-02`, `RG-03`, `RG-04`): decides before
//! reading full file bodies whether a document opens normally, opens in
//! read-only large-text mode (`<= 64 MiB`), or opens an in-pane oversized
//! explanation card without touching the file body.

use super::{Resolved, manifest::Source};
use crate::formats::Category;

/// Maximum byte size at which plain text and code files may open in read-only
/// mode above their editable `maxSourceBytes` budget (`RG-03`).
pub const READ_ONLY_TEXT_MAX_BYTES: u64 = 64 * 1024 * 1024;

/// Admission outcome computed from `stat_entry` metadata and the manifest's
/// `resourcePolicy.maxSourceBytes` (`RG-02`–`RG-04`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Admission {
    /// Within the viewer's source budget: proceed with normal open.
    Admit,
    /// Text/code file above editable budget (`edit_limit_bytes`) and within
    /// [`READ_ONLY_TEXT_MAX_BYTES`]: open bounded read-only (`RG-03`).
    ReadOnlyText {
        size_bytes: u64,
        edit_limit_bytes: u64,
    },
    /// Exceeds the viewer's budget (or read-only text ceiling): do NOT read the
    /// body; open an in-pane oversized explanation surface (`RG-02`).
    Oversized { size_bytes: u64, limit_bytes: u64 },
}

/// Whether `resolved` is plain text or source code eligible for read-only
/// viewing above its editable budget (`RG-03`).
///
/// Structured editors that parse full AST/DOM/tables in memory (`json`, `csv`,
/// `html`, `excalidraw`, `puppyflow`, `context-map`) stay capped at their own
/// `maxSourceBytes`.
pub fn supports_read_only_large_text(resolved: &Resolved) -> bool {
    matches!(resolved.viewer.id, "text" | "markdown")
        && matches!(
            resolved.format.category,
            Category::Text | Category::Code | Category::Markdown
        )
}

/// Decides admission from file byte size and the resolved viewer's manifest budget.
///
/// - `Source::None` viewers (`document-placeholder`, `app-preview` without content)
///   never read the file body and are always admitted.
/// - Text/code viewers (`text`, `markdown`) between `edit_limit` and
///   `read_only_ceiling` open via [`Admission::ReadOnlyText`] when
///   `can_read_large_resource` is true; otherwise they fall back to [`Admission::Oversized`].
pub fn decide(
    resolved: &Resolved,
    size_bytes: u64,
    provider_text_limit: Option<u64>,
    can_read_large_resource: bool,
) -> Admission {
    if resolved.viewer.source() == Source::None {
        return Admission::Admit;
    }
    let manifest_budget = resolved.viewer.definition.resource_policy.max_source_bytes;
    let edit_limit = match provider_text_limit {
        Some(provider_limit) if resolved.viewer.source().reads_content() => {
            manifest_budget.min(provider_limit)
        }
        _ => manifest_budget,
    };
    if size_bytes <= edit_limit {
        return Admission::Admit;
    }
    if supports_read_only_large_text(resolved) && can_read_large_resource {
        if size_bytes <= READ_ONLY_TEXT_MAX_BYTES {
            return Admission::ReadOnlyText {
                size_bytes,
                edit_limit_bytes: edit_limit,
            };
        }
        return Admission::Oversized {
            size_bytes,
            limit_bytes: READ_ONLY_TEXT_MAX_BYTES,
        };
    }
    Admission::Oversized {
        size_bytes,
        limit_bytes: edit_limit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::registry::{EditorDocument, resolve};

    #[test]
    fn admission_respects_manifest_budgets_read_only_text_window_and_placeholder_source_none() {
        // Source::None placeholder has maxSourceBytes == 0 and must never be flagged Oversized.
        let zip = resolve(&EditorDocument::local("archive.zip"));
        assert_eq!(
            decide(&zip, 10 * 1024 * 1024 * 1024, None, true),
            Admission::Admit
        );

        // Code/text within 16 MiB admits normally; 24 MiB enters ReadOnlyText; 80 MiB is Oversized.
        let rs = resolve(&EditorDocument::local("src/big.rs"));
        let edit_budget = 16 * 1024 * 1024;
        assert_eq!(decide(&rs, edit_budget, None, true), Admission::Admit);
        assert_eq!(
            decide(&rs, 24 * 1024 * 1024, None, true),
            Admission::ReadOnlyText {
                size_bytes: 24 * 1024 * 1024,
                edit_limit_bytes: edit_budget,
            }
        );
        assert_eq!(
            decide(&rs, 80 * 1024 * 1024, None, true),
            Admission::Oversized {
                size_bytes: 80 * 1024 * 1024,
                limit_bytes: READ_ONLY_TEXT_MAX_BYTES,
            }
        );

        // Structured JSON exceeds 8 MiB -> Oversized (does not use raw text read-only mode).
        let json = resolve(&EditorDocument::local("data.json"));
        assert_eq!(
            decide(&json, 12 * 1024 * 1024, None, true),
            Admission::Oversized {
                size_bytes: 12 * 1024 * 1024,
                limit_bytes: 8 * 1024 * 1024,
            }
        );
    }
}
