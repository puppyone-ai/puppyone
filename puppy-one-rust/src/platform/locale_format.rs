//! Dates in the system's own regional format: `Intl.DateTimeFormat(undefined,
//! …)`, which follows the operating system's region rather than the app's
//! language. macOS asks `NSDateFormatter` for the localized pattern of the
//! same skeleton; elsewhere the en-US rendering stands in.

/// `{ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }`
/// in local time ("Jan 15, 3:55 PM", "1月15日 15:55").
pub fn month_day_time(unix_ms: i64) -> String {
    // The pixel lab compares against references rendered in en-US.
    if std::env::var_os("PUPPYONE_LAB").is_some() {
        return fallback(unix_ms);
    }
    #[cfg(target_os = "macos")]
    if let Some(text) = macos::format(unix_ms, "MMMdjmm") {
        return text;
    }
    fallback(unix_ms)
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_foundation::{NSDate, NSDateFormatter, NSLocale, NSString};

    pub fn format(unix_ms: i64, skeleton: &str) -> Option<String> {
        let locale = NSLocale::currentLocale();
        let pattern = NSDateFormatter::dateFormatFromTemplate_options_locale(
            &NSString::from_str(skeleton),
            0,
            Some(&locale),
        )?;
        let formatter = NSDateFormatter::new();
        formatter.setLocale(Some(&locale));
        formatter.setDateFormat(Some(&pattern));
        let date = NSDate::dateWithTimeIntervalSince1970(unix_ms as f64 / 1000.);
        Some(formatter.stringFromDate(&date).to_string())
    }
}

/// en-US in local time.
fn fallback(unix_ms: i64) -> String {
    use chrono::{Datelike, Local, TimeZone, Timelike};
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let Some(time) = Local.timestamp_millis_opt(unix_ms).single() else {
        return String::new();
    };
    let hour = match time.hour() % 12 {
        0 => 12,
        h => h,
    };
    format!(
        "{} {}, {}:{:02} {}",
        MONTHS[time.month0() as usize],
        time.day(),
        hour,
        time.minute(),
        if time.hour() < 12 { "AM" } else { "PM" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn dates_render_in_a_regional_short_form() {
        let text = month_day_time(1_700_000_000_000);
        assert!(!text.is_empty());
        assert!(text.chars().any(|c| c.is_ascii_digit()), "{text}");
        assert!(fallback(1_700_000_000_000).contains(':'));
    }
}
