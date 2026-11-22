//! macOS regional date/time formatting via `NSDateFormatter`.
use objc2_foundation::{NSDate, NSDateFormatter, NSLocale, NSString};

pub(super) fn format_month_day_time(unix_ms: i64) -> Option<String> {
    let locale = NSLocale::currentLocale();
    let pattern = NSDateFormatter::dateFormatFromTemplate_options_locale(
        &NSString::from_str("MMMdjmm"),
        0,
        Some(&locale),
    )?;
    let formatter = NSDateFormatter::new();
    formatter.setLocale(Some(&locale));
    formatter.setDateFormat(Some(&pattern));
    let date = NSDate::dateWithTimeIntervalSince1970(unix_ms as f64 / 1000.);
    Some(formatter.stringFromDate(&date).to_string())
}
