//! Text as the product measures it: lengths, limits and offsets count
//! UTF-16 code units (`string.length`, `slice`), white space is
//! ECMAScript's (`trim`), and strings collate as ICU's root order
//! (`localeCompare` without a locale).

/// `value.length` of a JS string.
pub fn len16(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// The byte offset of UTF-16 offset `units`, clamped to the string. A cut
/// inside a surrogate pair keeps the pair out (Rust cannot hold half of it).
fn byte_at(value: &str, units: usize) -> usize {
    let mut count = 0;
    for (index, ch) in value.char_indices() {
        if count + ch.len_utf16() > units {
            return index;
        }
        count += ch.len_utf16();
    }
    value.len()
}

/// `value.slice(0, limit)`.
pub fn head16(value: &str, limit: usize) -> &str {
    &value[..byte_at(value, limit)]
}

/// `value.slice(start, end)` with non-negative bounds.
pub fn slice16(value: &str, start: usize, end: usize) -> &str {
    let from = byte_at(value, start);
    let to = byte_at(value, end).max(from);
    &value[from..to]
}

/// `value.slice(start)`.
pub fn tail16(value: &str, start: usize) -> &str {
    &value[byte_at(value, start)..]
}

/// `String.prototype.trim` (Unicode white space, line terminators and BOM).
pub fn trim(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// `String.prototype.trimStart`.
pub fn trim_start(value: &str) -> &str {
    value.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// `String.prototype.trimEnd`.
pub fn trim_end(value: &str) -> &str {
    value.trim_end_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// `left.localeCompare(right)`: ICU root collation, as V8 compares
/// strings without a locale.
pub fn locale_compare(left: &str, right: &str) -> std::cmp::Ordering {
    thread_local! {
        static COLLATOR: icu_collator::CollatorBorrowed<'static> =
            icu_collator::Collator::try_new(Default::default(), Default::default())
                .expect("compiled ICU collation data");
    }
    COLLATOR.with(|collator| collator.compare(left, right))
}
