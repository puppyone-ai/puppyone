//! Unified representation of an unavailable or unsupported platform capability.
//! Every capability adapter reports availability explicitly rather than leaving
//! silent empty stubs or leaking OS-specific error codes to views.
use std::fmt;

/// Runtime availability of a single platform capability.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Availability {
    Available,
    Unavailable(Unsupported),
}

impl Availability {
    pub fn is_available(&self) -> bool {
        matches!(self, Self::Available)
    }

    pub fn unavailable(capability: &'static str, message_key: &'static str) -> Self {
        Self::Unavailable(Unsupported::new(capability, message_key))
    }

    pub fn unavailable_with_detail(
        capability: &'static str,
        message_key: &'static str,
        detail: impl Into<String>,
    ) -> Self {
        Self::Unavailable(Unsupported::with_detail(capability, message_key, detail))
    }

    pub fn reason(&self) -> Option<&Unsupported> {
        match self {
            Self::Available => None,
            Self::Unavailable(reason) => Some(reason),
        }
    }
}

/// Structured refusal for a capability that is not available on this OS or
/// runtime environment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unsupported {
    pub capability: &'static str,
    pub message_key: &'static str,
    pub detail: Option<String>,
}

impl Unsupported {
    pub const fn new(capability: &'static str, message_key: &'static str) -> Self {
        Self {
            capability,
            message_key,
            detail: None,
        }
    }

    pub fn with_detail(
        capability: &'static str,
        message_key: &'static str,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            capability,
            message_key,
            detail: Some(detail.into()),
        }
    }

    /// Localized user-facing explanation, falling back to `detail` or the key.
    pub fn localized_message(&self) -> String {
        let translated = crate::localization::t(self.message_key);
        if translated != self.message_key {
            return translated.to_owned();
        }
        if let Some(detail) = &self.detail {
            return detail.clone();
        }
        format!("{} is not supported on this platform yet.", self.capability)
    }
}

impl fmt::Display for Unsupported {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.localized_message())
    }
}

impl std::error::Error for Unsupported {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn availability_reports_status_and_localized_fallback() {
        assert!(Availability::Available.is_available());
        assert!(Availability::Available.reason().is_none());

        let missing = Availability::unavailable_with_detail(
            "office",
            "native.office.unavailable",
            "Office conversion is not available on this platform.",
        );
        assert!(!missing.is_available());
        let reason = missing.reason().unwrap();
        assert_eq!(reason.capability, "office");
        assert!(!reason.to_string().is_empty());
    }
}
