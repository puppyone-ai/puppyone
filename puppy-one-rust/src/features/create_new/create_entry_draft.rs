//! Pure translation of normalizeCreateEntryName and the creation draft.
use super::create_entry_menu_registry::Entry;
/// Errors are product catalog keys (`workspace.node.error.*`); the dialog
/// owns presentation.
pub fn normalize_name(kind: Entry, input: &str) -> Result<String, &'static str> {
    let name = input.trim();
    if name.is_empty() {
        return Err("workspace.node.error.nameRequired");
    }
    if name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err("workspace.node.error.nameInvalid");
    }
    let lower = name.to_lowercase();
    let ext = lower.rsplit_once('.').map(|(_, e)| e);
    let valid = match kind {
        Entry::Folder => true,
        Entry::Markdown => matches!(ext, Some("md" | "markdown" | "mdx")),
        Entry::Csv => matches!(ext, Some("csv" | "tsv")),
        Entry::Html => matches!(ext, Some("htm" | "html" | "xhtml")),
        Entry::Json => matches!(ext, Some("json" | "jsonl")),
        Entry::Text => ext.is_some(),
        _ => lower.ends_with(kind.extension()),
    };
    Ok(if valid {
        name.into()
    } else {
        format!("{name}{}", kind.extension())
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_match_product_extensions_and_reject_path_escape() {
        assert_eq!(
            normalize_name(Entry::Markdown, " Readme.MDX ").unwrap(),
            "Readme.MDX"
        );
        assert_eq!(normalize_name(Entry::Csv, "Table").unwrap(), "Table.csv");
        for name in ["", "..", "a/b", "a\\b", "a\0b"] {
            assert!(normalize_name(Entry::Text, name).is_err())
        }
    }
}
