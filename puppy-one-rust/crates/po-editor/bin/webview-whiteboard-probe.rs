//! An isolated native-engine fixture process, never part of the packaged app.
fn main() {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    po_editor::web_host::run_whiteboard_probe(std::path::Path::new(
        &std::env::args_os().nth(1).expect("installed pack root"),
    ));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    panic!("The native WebView whiteboard probe requires macOS (WebKit) or Windows (WebView2)");
}
