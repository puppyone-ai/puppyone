//! What only development builds compile: the offscreen capture scenarios
//! (`dev-capture`) and the frame-cost benchmarks (tests on macOS).
#[cfg(all(test, target_os = "macos"))]
mod bench;
#[cfg(feature = "dev-capture")]
pub(super) mod capture_scenario;
