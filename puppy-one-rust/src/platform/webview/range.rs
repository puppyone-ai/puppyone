//! Single ranges follow the frozen desktop transport, including JS safe
//! integers and its deliberately unsupported multi-range syntax.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ByteRange {
    Whole,
    Part { start: u64, end: u64 },
    Unsatisfiable,
}

impl ByteRange {
    pub fn parse(header: Option<&str>, size: u64) -> Self {
        use ByteRange::*;
        let Some(header) = header else { return Whole };
        // ECMAScript String.trim: U+FEFF is whitespace; U+0085 is not.
        let header = header.trim_matches(|c| {
            matches!(c,
            '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
            | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
            | '\u{205f}' | '\u{3000}' | '\u{feff}')
        });
        if header.is_empty() {
            return Whole;
        }
        let Some(value) = header
            .get(..6)
            .filter(|p| p.eq_ignore_ascii_case("bytes="))
            .and_then(|_| header.get(6..))
        else {
            return Unsatisfiable;
        };
        let Some((start, end)) = value.split_once('-') else {
            return Unsatisfiable;
        };
        if size == 0 {
            return Unsatisfiable;
        }
        if start.is_empty() {
            return match integer(end) {
                Some(suffix) if suffix > 0 => Part {
                    start: size.saturating_sub(suffix),
                    end: size - 1,
                },
                _ => Unsatisfiable,
            };
        }
        let Some(start) = integer(start) else {
            return Unsatisfiable;
        };
        let end = if end.is_empty() {
            Some(size - 1).filter(|n| *n <= MAX_SAFE_INTEGER)
        } else {
            integer(end)
        };
        match end {
            Some(end) if start < size && end >= start => Part {
                start,
                end: end.min(size - 1),
            },
            _ => Unsatisfiable,
        }
    }
}
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
fn integer(value: &str) -> Option<u64> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    // Number("000…001") remains one even with arbitrarily many zeroes.
    let digits = value.trim_start_matches('0');
    if digits.is_empty() {
        return Some(0);
    }
    digits
        .parse::<u64>()
        .ok()
        .filter(|n| *n <= MAX_SAFE_INTEGER)
}
