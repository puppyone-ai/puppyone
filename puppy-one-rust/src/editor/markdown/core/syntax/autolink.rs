//! GFM autolink literals (`www.`, `http(s)://`, e-mail, `mailto:` / `xmpp:`),
//! ported from @lezer/markdown's `Autolink` extension. The product only
//! colours these (`URL` → `tags.url` → `cm-md-syntax-link`); they are not
//! link elements and never hide source.
use std::ops::Range;

fn is_word(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

/// `/[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s<]*)?/y` from `from`; returns the end.
fn url_match(text: &[u8], from: usize) -> Option<usize> {
    let label = |mut i: usize| {
        let start = i;
        while i < text.len() && (is_word(text[i]) || text[i] == b'-') {
            i += 1;
        }
        (i > start).then_some(i)
    };
    let mut i = label(from)?;
    let mut dots = 0;
    while i < text.len() && text[i] == b'.' {
        match label(i + 1) {
            Some(next) => {
                i = next;
                dots += 1;
            }
            None => break,
        }
    }
    if dots == 0 {
        return None;
    }
    if i < text.len() && text[i] == b':' {
        let digits = text[i + 1..]
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count();
        if digits > 0 {
            i += 1 + digits;
        }
    }
    if i < text.len() && text[i] == b'/' {
        i += 1;
        while i < text.len() && !text[i].is_ascii_whitespace() && text[i] != b'<' {
            i += 1;
        }
    }
    // `lastTwoDomainWords` may not contain `_`.
    let matched = &text[from..i];
    let host_end = matched
        .iter()
        .position(|&c| c == b'/' || c == b':')
        .unwrap_or(matched.len());
    let host = &matched[..host_end];
    let mut parts = host.rsplitn(3, |&c| c == b'.');
    let (last, second) = (
        parts.next().unwrap_or_default(),
        parts.next().unwrap_or_default(),
    );
    if last.contains(&b'_') || second.contains(&b'_') {
        return None;
    }
    Some(i)
}

fn url_end(text: &str, from: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut end = url_match(bytes, from)?;
    loop {
        let last = bytes[end - 1];
        let count = |c: u8| bytes[from..end].iter().filter(|&&b| b == c).count();
        if b"?!.,:*_~".contains(&last) || (last == b')' && count(b')') > count(b'(')) {
            end -= 1;
        } else if last == b';' {
            // A trailing entity reference `&name;` is not part of the URL.
            let slice = &text[from..end];
            match slice.rfind('&') {
                Some(amp)
                    if slice[amp + 1..slice.len() - 1]
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'#')
                        && slice.len() - amp > 2 =>
                {
                    end = from + amp;
                }
                _ => break,
            }
        } else {
            break;
        }
        if end <= from {
            return None;
        }
    }
    Some(end)
}

/// `/[\w.+-]+@[\w-]+(\.[\w.-]+)+/y` with the trailing-character rules.
fn email_end(text: &[u8], from: usize) -> Option<usize> {
    let mut i = from;
    while i < text.len() && (is_word(text[i]) || b".+-".contains(&text[i])) {
        i += 1;
    }
    if i == from || text.get(i) != Some(&b'@') {
        return None;
    }
    i += 1;
    let domain = i;
    while i < text.len() && (is_word(text[i]) || text[i] == b'-') {
        i += 1;
    }
    if i == domain {
        return None;
    }
    let mut groups = 0;
    while i < text.len() && text[i] == b'.' {
        let start = i + 1;
        let mut j = start;
        while j < text.len() && (is_word(text[j]) || text[j] == b'.' || text[j] == b'-') {
            j += 1;
        }
        if j == start {
            break;
        }
        i = j;
        groups += 1;
    }
    if groups == 0 {
        return None;
    }
    match text[i - 1] {
        b'_' | b'-' => None,
        b'.' => Some(i - 1),
        _ => Some(i),
    }
}

/// Autolink literal ranges inside one run of inline text.
pub fn find(text: &str) -> Vec<Range<usize>> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < bytes.len() {
        if !text.is_char_boundary(pos) || (pos > 0 && is_word(bytes[pos - 1])) {
            pos += 1;
            continue;
        }
        let rest = &text[pos..];
        let end = if rest.starts_with("www.") {
            url_end(text, pos + 4)
        } else if let Some(scheme) = ["https://", "http://"]
            .iter()
            .find(|s| rest.starts_with(**s))
        {
            url_end(text, pos + scheme.len())
        } else if rest.starts_with("mailto:") {
            email_end(bytes, pos + 7)
        } else if rest.starts_with("xmpp:") {
            email_end(bytes, pos + 5).map(|end| {
                // An optional `/resource`.
                if bytes.get(end) == Some(&b'/') {
                    let n = bytes[end + 1..]
                        .iter()
                        .take_while(|c| c.is_ascii_alphanumeric() || **c == b'@' || **c == b'.')
                        .count();
                    if n > 0 { end + 1 + n } else { end }
                } else {
                    end
                }
            })
        } else if bytes[pos].is_ascii_alphanumeric() || b"_.+-".contains(&bytes[pos]) {
            email_end(bytes, pos)
        } else {
            None
        };
        match end {
            Some(end) if end > pos => {
                out.push(pos..end);
                pos = end;
            }
            _ => pos += 1,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::find;

    #[test]
    fn literals_follow_the_lezer_extension() {
        let s = "see https://example.com/a(b). and www.x.org, me@mail.co. not_a_url";
        let found: Vec<&str> = find(s).into_iter().map(|r| &s[r]).collect();
        assert_eq!(
            found,
            vec!["https://example.com/a(b)", "www.x.org", "me@mail.co"]
        );
        assert!(find("x.y").is_empty());
        assert!(find("www.a_b.com").is_empty());
    }
}
