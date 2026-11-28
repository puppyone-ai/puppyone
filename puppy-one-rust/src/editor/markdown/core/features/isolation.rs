//! Feature panic isolation (`TA-33`): any feature callback panic discards its
//! partial output and logs one diagnostic per feature ID per process session.

/// Diagnostic event emitted when a feature panics at a pipeline boundary.
pub const FEATURE_PANIC_EVENT: &str = "[markdown-editor] feature panicked";

/// Isolates a `MarkdownFeature` callback (`recognize_inline`, `recognize_blocks`,
/// `compile_element`, `compile_blocks`, `block_widget`, `inline_widget`,
/// `decorate_block`, `decorate_line`, `decorate_inline_content`, `view_command`,
/// `command`, `TA-33`). On panic, discards partial output and logs one
/// diagnostic per feature ID per process session.
pub fn catch_feature_panic<T>(
    feature: &'static str,
    stage: &'static str,
    work: impl FnOnce() -> T,
) -> Option<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)) {
        Ok(value) => Some(value),
        Err(payload) => {
            let message = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_owned())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "feature panicked".to_owned());
            report_feature_panic_once(feature, stage, &message);
            None
        }
    }
}

fn report_feature_panic_once(feature: &'static str, stage: &'static str, message: &str) {
    use std::{
        collections::HashSet,
        sync::{Mutex, OnceLock},
    };
    static REPORTED: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    let reported = REPORTED.get_or_init(|| Mutex::new(HashSet::new()));
    let first = reported
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(feature);
    if first {
        crate::platform::diagnostics::warn(
            FEATURE_PANIC_EVENT,
            serde_json::json!({
                "feature": feature,
                "stage": stage,
                "message": message,
            }),
        );
    }
}
