//! `runtimes/workbuddy/workbuddy-environment.mjs`.

/// `WORKBUDDY_HOST_ENVIRONMENT`.
pub const WORKBUDDY_HOST_ENVIRONMENT: &[(&str, &str)] = &[
    ("DISABLE_AUTOUPDATER", "1"),
    ("DISABLE_ERROR_REPORTING", "1"),
    ("DISABLE_TELEMETRY", "1"),
];
