//! `runtimes/opencode-protocol/opencode-security-policy.mjs`.

/// `OPEN_CODE_HOST_SAFETY_ENVIRONMENT`.
pub const OPEN_CODE_HOST_SAFETY_ENVIRONMENT: &[(&str, &str)] = &[
    ("OPENCODE_AUTO_SHARE", "false"),
    ("OPENCODE_DISABLE_AUTOUPDATE", "1"),
    ("OPENCODE_DISABLE_PROJECT_CONFIG", "1"),
    ("OPENCODE_DISABLE_SHARE", "1"),
    ("OPENCODE_ENABLE_QUESTION_TOOL", "true"),
];
