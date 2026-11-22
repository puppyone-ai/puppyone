//! Cheap, cached runtime capability summary (`Capabilities::probe()`).
//! Views inspect these flags to disable or substitute unsupported controls
//! without querying `cfg(target_os)` directly.
use super::{
    os::Os,
    unsupported::{Availability, Unsupported},
};
use std::sync::OnceLock;

/// Runtime capabilities probed once per process.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Capabilities {
    pub os: Os,
    pub credentials: Availability,
    pub embedded_web: Availability,
    pub pdf: Availability,
    pub file_reveal: Availability,
    pub file_open: Availability,
    pub file_clipboard: Availability,
    pub drag_out: Availability,
    pub office_conversion: Availability,
    pub native_image_codec: Availability,
    pub quick_look_thumbnails: Availability,
    pub auto_update: Availability,
    pub single_instance: Availability,
    pub url_scheme: Availability,
    pub host_sharing: Availability,
}

impl Capabilities {
    /// Returns the cached runtime capability summary for this host.
    pub fn probe() -> &'static Self {
        static PROBED: OnceLock<Capabilities> = OnceLock::new();
        PROBED.get_or_init(Self::detect)
    }

    /// Computes capabilities for a specific OS (used by tests and `detect`).
    pub fn for_os(os: Os) -> Self {
        let unavail = |cap: &'static str, key: &'static str, detail: &'static str| {
            Availability::Unavailable(Unsupported::with_detail(cap, key, detail))
        };
        match os {
            Os::Macos => Self {
                os,
                credentials: Availability::Available,
                embedded_web: Availability::Available,
                pdf: Availability::Available,
                file_reveal: Availability::Available,
                file_open: Availability::Available,
                file_clipboard: Availability::Available,
                drag_out: Availability::Available,
                office_conversion: Availability::Available,
                native_image_codec: Availability::Available,
                quick_look_thumbnails: Availability::Available,
                auto_update: Availability::Available,
                single_instance: Availability::Available,
                url_scheme: Availability::Available,
                host_sharing: Availability::Available,
            },
            Os::Windows => Self {
                os,
                credentials: Availability::Available,
                embedded_web: Availability::Available,
                pdf: Availability::Available,
                file_reveal: Availability::Available,
                file_open: Availability::Available,
                file_clipboard: Availability::Available,
                drag_out: unavail(
                    "drag_out",
                    "native.clipboard.dragOutUnsupported",
                    "Dragging files out of the window is not supported on this platform yet.",
                ),
                office_conversion: unavail(
                    "office_conversion",
                    "native.office.unavailable",
                    "Built-in .doc/.rtf conversion is available on macOS only.",
                ),
                native_image_codec: unavail(
                    "native_image_codec",
                    "native.image.codecUnavailable",
                    "System HEIC/AVIF codec is available on macOS only.",
                ),
                quick_look_thumbnails: unavail(
                    "quick_look_thumbnails",
                    "native.preview.thumbnailUnavailable",
                    "System file thumbnails are available on macOS only.",
                ),
                auto_update: Availability::Available,
                single_instance: Availability::Available,
                url_scheme: Availability::Available,
                host_sharing: unavail(
                    "host_sharing",
                    "native.hosts.unavailable",
                    "Computer folder sharing is available on macOS only.",
                ),
            },
            Os::Linux => Self {
                os,
                credentials: Availability::Available,
                embedded_web: unavail(
                    "embedded_web",
                    "native.web.embeddedUnavailable",
                    "Embedded web views are not enabled on Linux; open in your browser instead.",
                ),
                pdf: Availability::Available,
                file_reveal: Availability::Available,
                file_open: Availability::Available,
                file_clipboard: Availability::Available,
                drag_out: unavail(
                    "drag_out",
                    "native.clipboard.dragOutUnsupported",
                    "Dragging files out of the window is not supported on Linux yet.",
                ),
                office_conversion: unavail(
                    "office_conversion",
                    "native.office.unavailable",
                    "Built-in .doc/.rtf conversion is available on macOS only.",
                ),
                native_image_codec: unavail(
                    "native_image_codec",
                    "native.image.codecUnavailable",
                    "System HEIC/AVIF codec is available on macOS only.",
                ),
                quick_look_thumbnails: unavail(
                    "quick_look_thumbnails",
                    "native.preview.thumbnailUnavailable",
                    "System file thumbnails are available on macOS only.",
                ),
                auto_update: Availability::Available,
                single_instance: Availability::Available,
                url_scheme: Availability::Available,
                host_sharing: unavail(
                    "host_sharing",
                    "native.hosts.unavailable",
                    "Computer folder sharing is available on macOS only.",
                ),
            },
            Os::Other => Self {
                os,
                credentials: unavail(
                    "credentials",
                    "native.credentials.unavailable",
                    "Secure credential storage is not available on this platform.",
                ),
                embedded_web: unavail(
                    "embedded_web",
                    "native.web.embeddedUnavailable",
                    "Embedded web views are not available on this platform.",
                ),
                pdf: unavail(
                    "pdf",
                    "native.pdf.unavailable",
                    "PDF rendering engine is not available on this platform.",
                ),
                file_reveal: unavail(
                    "file_reveal",
                    "native.desktop.openUnsupported",
                    "Opening the file manager is not supported on this platform.",
                ),
                file_open: unavail(
                    "file_open",
                    "native.desktop.openUnsupported",
                    "Opening files in external apps is not supported on this platform.",
                ),
                file_clipboard: unavail(
                    "file_clipboard",
                    "native.clipboard.fileUnsupported",
                    "File clipboard is not supported on this platform.",
                ),
                drag_out: unavail(
                    "drag_out",
                    "native.clipboard.dragOutUnsupported",
                    "Dragging files out of the window is not supported on this platform.",
                ),
                office_conversion: unavail(
                    "office_conversion",
                    "native.office.unavailable",
                    "Office conversion is not supported on this platform.",
                ),
                native_image_codec: unavail(
                    "native_image_codec",
                    "native.image.codecUnavailable",
                    "Native image codec is not supported on this platform.",
                ),
                quick_look_thumbnails: unavail(
                    "quick_look_thumbnails",
                    "native.preview.thumbnailUnavailable",
                    "System thumbnails are not supported on this platform.",
                ),
                auto_update: unavail(
                    "auto_update",
                    "native.updates.unavailable",
                    "Automatic updates are not supported on this platform.",
                ),
                single_instance: unavail(
                    "single_instance",
                    "native.appLink.singleInstanceUnavailable",
                    "Single-instance handoff is not supported on this platform.",
                ),
                url_scheme: unavail(
                    "url_scheme",
                    "native.appLink.urlSchemeUnavailable",
                    "Custom URL scheme registration is not supported on this platform.",
                ),
                host_sharing: unavail(
                    "host_sharing",
                    "native.hosts.unavailable",
                    "Computer folder sharing is not supported on this platform.",
                ),
            },
        }
    }

    fn detect() -> Self {
        let mut caps = Self::for_os(Os::current());
        if super::pdf::library_path().is_none() {
            caps.pdf = Availability::unavailable_with_detail(
                "pdf",
                "native.pdf.unavailable",
                "PDFium library is not installed on this machine.",
            );
        }
        caps
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_matrix_distinguishes_platforms() {
        let mac = Capabilities::for_os(Os::Macos);
        assert!(mac.embedded_web.is_available());
        assert!(mac.office_conversion.is_available());
        assert!(mac.quick_look_thumbnails.is_available());

        let win = Capabilities::for_os(Os::Windows);
        assert!(win.embedded_web.is_available());
        assert!(!win.office_conversion.is_available());
        assert!(!win.quick_look_thumbnails.is_available());

        let linux = Capabilities::for_os(Os::Linux);
        assert!(!linux.embedded_web.is_available());
        assert!(linux.file_open.is_available());
        assert!(!linux.office_conversion.is_available());

        assert_eq!(Capabilities::probe().os, Os::current());
    }
}
