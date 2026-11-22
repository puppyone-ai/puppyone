//! An isolated native-engine fixture process, never part of the packaged app.
fn main() {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    po_editor::web_host::run_document_pages_probe();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    panic!("The native WebView document pages probe requires macOS (WebKit) or Windows (WebView2)");
}
