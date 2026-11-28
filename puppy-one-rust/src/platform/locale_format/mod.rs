//! Regional date/time formatting matching the operating system's locale settings:
//! macOS uses `NSDateFormatter`, Windows uses `GetDateFormatEx` / `GetTimeFormatEx`,
//! and Linux/fallback uses local `chrono` short form.

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod imp;
#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod imp;

/// `{ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }`
/// in local time ("Jan 15, 3:55 PM", "1月15日 15:55").
pub fn month_day_time(unix_ms: i64) -> String {
    // The pixel lab compares against references rendered in en-US.
    if std::env::var_os("PUPPYONE_LAB").is_some() {
        return fallback(unix_ms);
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    if let Some(text) = imp::format_month_day_time(unix_ms) {
        return text;
    }
    fallback(unix_ms)
}

/// en-US short form in local time.
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
