//! Windows regional date/time formatting via `GetDateFormatEx` + `GetTimeFormatEx`.
use chrono::{Datelike, Local, TimeZone, Timelike};
use windows::{
    Win32::{
        Foundation::SYSTEMTIME,
        Globalization::{DATE_SHORTDATE, GetDateFormatEx, GetTimeFormatEx, TIME_NOSECONDS},
    },
    core::PCWSTR,
};

pub(super) fn format_month_day_time(unix_ms: i64) -> Option<String> {
    let dt = Local.timestamp_millis_opt(unix_ms).single()?;
    let st = SYSTEMTIME {
        wYear: dt.year().try_into().ok()?,
        wMonth: dt.month().try_into().ok()?,
        wDayOfWeek: dt.weekday().num_days_from_sunday().try_into().ok()?,
        wDay: dt.day().try_into().ok()?,
        wHour: dt.hour().try_into().ok()?,
        wMinute: dt.minute().try_into().ok()?,
        wSecond: dt.second().try_into().ok()?,
        wMilliseconds: 0,
    };

    let mut date_buf = [0u16; 64];
    let mut time_buf = [0u16; 64];
    // SAFETY: `st` is valid and buffers are mutable fixed-size slices.
    let date_len = unsafe {
        GetDateFormatEx(
            PCWSTR::null(),
            DATE_SHORTDATE,
            Some(&st),
            PCWSTR::null(),
            Some(&mut date_buf),
            PCWSTR::null(),
        )
    };
    let time_len = unsafe {
        GetTimeFormatEx(
            PCWSTR::null(),
            TIME_NOSECONDS,
            Some(&st),
            PCWSTR::null(),
            Some(&mut time_buf),
        )
    };
    if date_len <= 1 || time_len <= 1 {
        return None;
    }
    let date = String::from_utf16(&date_buf[..(date_len as usize - 1)]).ok()?;
    let time = String::from_utf16(&time_buf[..(time_len as usize - 1)]).ok()?;
    Some(format!("{date} {time}"))
}
