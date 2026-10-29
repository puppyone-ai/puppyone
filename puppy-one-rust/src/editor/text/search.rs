//! CodeMirror SearchQuery({caseSensitive:false, literal:true}). Query NFKD
//! normalization is whole-string; the cursor normalizes each source scalar.
use std::ops::Range;

pub fn find_all(text: &str, query: &str) -> Vec<Range<usize>> {
    let normalizer = icu_normalizer::DecomposingNormalizer::new_nfkd();
    let needle: Vec<char> = normalizer.normalize(query).to_lowercase().chars().collect();
    if needle.is_empty() {
        return Vec::new();
    }
    // KMP keeps literal searching linear even for long repetitive code files.
    let mut prefix = vec![0; needle.len()];
    for i in 1..needle.len() {
        let mut j = prefix[i - 1];
        while j > 0 && needle[i] != needle[j] {
            j = prefix[j - 1];
        }
        if needle[i] == needle[j] {
            j += 1;
        }
        prefix[i] = j;
    }
    let mut starts = vec![0; needle.len()];
    let (mut matched, mut position) = (0, 0);
    let mut out = Vec::new();
    for (start, ch) in text.char_indices() {
        let mut utf8 = [0; 4];
        let norm = normalizer
            .normalize(ch.encode_utf8(&mut utf8))
            .to_lowercase();
        for c in norm.chars() {
            starts[position % needle.len()] = start;
            position += 1;
            while matched > 0 && c != needle[matched] {
                matched = prefix[matched - 1];
            }
            if c == needle[matched] {
                matched += 1;
            }
            if matched == needle.len() {
                out.push(starts[(position - needle.len()) % needle.len()]..start + ch.len_utf8());
                matched = 0;
                // SearchCursor.next() advances past this source scalar even
                // when a match ends inside its normalized expansion (e.g. ﬃ).
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn literal_unicode_search_matches_current_ts() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/editor/code.json")).unwrap();
        for case in fixture["searches"].as_array().unwrap() {
            let actual: Vec<_> = super::find_all(
                case["source"].as_str().unwrap(),
                case["query"].as_str().unwrap(),
            )
            .into_iter()
            .map(|r| [r.start, r.end])
            .collect();
            assert_eq!(serde_json::json!(actual), case["expected"], "{case}");
        }
    }
}
