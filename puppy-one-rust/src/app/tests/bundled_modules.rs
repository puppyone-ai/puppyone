//! The product modules the web bundles ship: each bundle receipt still
//! names exactly the reviewed reference sources the TS suite exercises
//! (`fixtures/bundled-product-modules.json`), and the shipped assets are the
//! outputs those receipts recorded.
use core::prelude::v1::test;
use serde_json::Value;
use sha2::{Digest, Sha256};

fn read(path: &str) -> Vec<u8> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    std::fs::read(root.join(path)).unwrap_or_else(|_| panic!("missing {path}"))
}

#[test]
fn bundles_ship_the_reviewed_product_modules() {
    let pinned: Value =
        serde_json::from_slice(&read("fixtures/bundled-product-modules.json")).unwrap();
    let reference: Value =
        serde_json::from_slice(&read("fixtures/test-parity-reference.json")).unwrap();
    assert_eq!(
        pinned["reference"], reference["commit"],
        "pinned to the reviewed reference"
    );
    for (bundle, modules) in pinned["bundles"].as_object().unwrap() {
        let receipt: Value =
            serde_json::from_slice(&read(&format!("assets/web/{bundle}.json"))).unwrap();
        for (module, hash) in modules.as_object().unwrap() {
            assert_eq!(
                &receipt["sourceHashes"][module], hash,
                "{bundle} no longer ships the reviewed {module}"
            );
        }
        // The pack-installed whiteboard is verified by the viewer packs.
        if bundle == "excalidraw" {
            continue;
        }
        for (output, hash) in receipt["outputs"].as_object().unwrap() {
            let actual = format!(
                "{:x}",
                Sha256::digest(read(&format!("assets/web/{output}")))
            );
            assert_eq!(Some(actual.as_str()), hash.as_str(), "{bundle}: {output}");
        }
    }
}
