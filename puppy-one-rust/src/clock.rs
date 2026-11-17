//! Time as the product writes it: milliseconds since the epoch
//! (`Date.now()`), ISO 8601 strings (`toISOString()`) and `Date.parse`.
use crate::text::trim;

/// `Date.now()`.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// `Date.parse(value)` in milliseconds: the ECMAScript date-time string
/// format (date-only forms are UTC), the forms V8 also reads (a space for
/// `T`, RFC 2822). Times without an offset are read as UTC.
pub fn date_parse(value: &str) -> Option<i64> {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime};
    use std::sync::LazyLock;
    static ISO: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$",
        )
        .expect("ISO date pattern")
    });
    let text = trim(value);
    if let Some(captures) = ISO.captures(text) {
        let year: i32 = captures[1].parse().ok()?;
        if &captures[1] == "-000000" {
            return None;
        }
        let part = |index: usize, default: u32| -> Option<u32> {
            captures
                .get(index)
                .map_or(Some(default), |m| m.as_str().parse().ok())
        };
        let date = NaiveDate::from_ymd_opt(year, part(2, 1)?, part(3, 1)?)?;
        let (hour, minute, second) = (part(4, 0)?, part(5, 0)?, part(6, 0)?);
        let millis = captures.get(7).map_or(Some(0), |m| {
            let digits = format!("{:0<3}", m.as_str());
            digits[..3].parse::<u32>().ok()
        })?;
        // `24:00` is the end of the day.
        let (time, carry) = if hour == 24 && minute == 0 && second == 0 && millis == 0 {
            (NaiveTime::from_hms_opt(0, 0, 0)?, 86_400_000)
        } else {
            (
                NaiveTime::from_hms_milli_opt(hour, minute, second, millis)?,
                0,
            )
        };
        let utc = NaiveDateTime::new(date, time).and_utc().timestamp_millis() + carry;
        let offset = match captures.get(8).map(|m| m.as_str()) {
            None | Some("Z") => 0,
            Some(zone) => {
                let sign = if zone.starts_with('-') { -1 } else { 1 };
                let digits: String = zone[1..].chars().filter(char::is_ascii_digit).collect();
                let hours: i64 = digits[..2].parse().ok()?;
                let minutes: i64 = digits[2..].parse().ok()?;
                if hours > 23 || minutes > 59 {
                    return None;
                }
                sign * (hours * 60 + minutes) * 60_000
            }
        };
        return Some(utc - offset);
    }
    DateTime::parse_from_rfc2822(text)
        .ok()
        .map(|date| date.timestamp_millis())
}

/// `new Date(milliseconds).toISOString()`.
pub fn iso_string(milliseconds: i64) -> String {
    let Some(date) = chrono::DateTime::from_timestamp_millis(milliseconds) else {
        return String::new();
    };
    use chrono::Datelike;
    let year = date.year();
    let rest = date.format("-%m-%dT%H:%M:%S%.3fZ");
    if (0..=9999).contains(&year) {
        format!("{year:04}{rest}")
    } else {
        format!(
            "{}{:06}{rest}",
            if year < 0 { '-' } else { '+' },
            year.abs()
        )
    }
}

/// `new Date().toISOString()`.
pub fn now_iso() -> String {
    iso_string(now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn dates_parse_like_date_parse() {
        assert_eq!(date_parse("1970-01-01T00:00:01.5Z"), Some(1_500));
        assert_eq!(date_parse("1970-01-02"), Some(86_400_000));
        assert_eq!(date_parse("1970-01-01T01:00:00+01:00"), Some(0));
        assert_eq!(date_parse("not-a-date"), None);
        assert_eq!(date_parse("2026-13-01"), None);
        assert_eq!(iso_string(1_500), "1970-01-01T00:00:01.500Z");
        assert_eq!(
            iso_string(date_parse("2026-08-30T00:00:00Z").unwrap()),
            "2026-08-30T00:00:00.000Z"
        );
    }
}
