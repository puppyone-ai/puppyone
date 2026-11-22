use super::*;
use core::prelude::v1::test;
use serde_json::{Value, json};
use std::str::FromStr;

fn sha(ch: char) -> String {
    std::iter::repeat_n(ch, 64).collect()
}

fn sample_manifest_json() -> Value {
    json!({
        "schemaVersion": 2,
        "id": "puppyone.libreoffice",
        "version": "1.2.0",
        "publisher": "puppyone",
        "hostApi": 1,
        "minAppVersion": "0.4.4",
        "platforms": ["macos-arm64", "macos-x64", "windows-x64"],
        "handlers": [
            {
                "id": "pptx-preview",
                "label": "LibreOffice PDF Preview",
                "handles": {
                    "formatIds": ["pptx"],
                    "extensions": [".pptx"],
                    "mimeTypes": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"]
                },
                "kind": "converter",
                "runtime": "process",
                "loading": "lazy",
                "entry": "bin/soffice",
                "sources": ["local"],
                "permissions": {
                    "currentDocument": ["metadata", "read"],
                    "relatedFiles": "none",
                    "network": []
                },
                "output": "pdf",
                "capability": "preview",
                "source": "resource",
                "computeIsolation": "native-process",
                "surfaceFamily": "document"
            }
        ],
        "files": [
            { "path": "bin/soffice", "size": 1024, "sha256": sha('a') },
            { "path": "LICENSE", "size": 512, "sha256": sha('b') }
        ],
        "permissions": {
            "currentDocument": ["metadata", "read"],
            "relatedFiles": "none",
            "network": []
        },
        "licenses": [
            { "spdx": "MPL-2.0", "path": "LICENSE" }
        ],
        "limits": {
            "maxArchiveBytes": 536870912,
            "maxExtractedBytes": 1073741824
        }
    })
}

fn sample_web_editor_manifest_json() -> Value {
    json!({
        "schemaVersion": 2,
        "id": "puppyone.excalidraw",
        "version": "0.18.0",
        "publisher": "puppyone",
        "hostApi": 1,
        "minAppVersion": "0.4.4",
        "platforms": ["any"],
        "handlers": [
            {
                "id": "board",
                "label": "Whiteboard",
                "handles": {
                    "formatIds": ["excalidraw"],
                    "extensions": [".excalidraw", ".excalidraw.json"],
                    "mimeTypes": ["application/vnd.excalidraw+json"]
                },
                "kind": "editor",
                "runtime": "web",
                "loading": "lazy",
                "entry": "excalidraw.js",
                "sources": ["local", "cloud"],
                "permissions": {
                    "currentDocument": ["metadata", "read", "commit"],
                    "relatedFiles": "none",
                    "network": []
                },
                "capability": "edit",
                "source": "content",
                "contentSandbox": "sandboxed-frame",
                "surfaceFamily": "canvas",
                "surfaceTraits": ["zoomable", "sandboxed"]
            }
        ],
        "files": [
            { "path": "excalidraw.js", "size": 2048, "sha256": sha('1') },
            { "path": "LICENSE", "size": 256, "sha256": sha('2') }
        ],
        "permissions": {
            "currentDocument": ["metadata", "read", "commit"],
            "relatedFiles": "none",
            "network": []
        },
        "licenses": [
            { "spdx": "MIT", "path": "LICENSE" }
        ],
        "limits": {
            "maxArchiveBytes": 33554432,
            "maxExtractedBytes": 50331648
        }
    })
}

fn sample_catalog_json() -> Value {
    json!({
        "schemaVersion": 1,
        "generatedAt": "2026-11-20T00:00:00Z",
        "plugins": [
            {
                "id": "puppyone.libreoffice",
                "publisher": "puppyone",
                "name": "LibreOffice",
                "description": "High-fidelity Office preview via PDF conversion",
                "versions": [
                    {
                        "version": "1.0.0",
                        "hostApi": 1,
                        "minAppVersion": "0.4.0",
                        "platforms": ["macos-arm64", "macos-x64"],
                        "archiveUrl": "https://downloads.puppyone.ai/desktop/viewer-packs/puppyone.libreoffice/1.0.0/pack.tar.gz",
                        "archiveSha256": sha('a'),
                        "archiveSizeBytes": 100000,
                        "extractedSizeBytes": 200000,
                        "handlers": [
                            {
                                "id": "pptx-preview",
                                "label": "LibreOffice PDF Preview",
                                "kind": "converter",
                                "runtime": "process",
                                "handles": { "formatIds": ["pptx"], "extensions": [".pptx"], "mimeTypes": [] },
                                "sources": ["local"],
                                "output": "pdf"
                            }
                        ]
                    },
                    {
                        "version": "1.2.0",
                        "hostApi": 1,
                        "minAppVersion": "0.4.4",
                        "platforms": ["macos-arm64", "macos-x64"],
                        "archiveUrl": "https://downloads.puppyone.ai/desktop/viewer-packs/puppyone.libreoffice/1.2.0/pack.tar.gz",
                        "archiveSha256": sha('b'),
                        "archiveSizeBytes": 110000,
                        "extractedSizeBytes": 220000,
                        "handlers": [
                            {
                                "id": "pptx-preview",
                                "label": "LibreOffice PDF Preview",
                                "kind": "converter",
                                "runtime": "process",
                                "handles": { "formatIds": ["pptx"], "extensions": [".pptx"], "mimeTypes": [] },
                                "sources": ["local"],
                                "output": "pdf"
                            }
                        ]
                    },
                    {
                        "version": "2.0.0",
                        "hostApi": 3,
                        "minAppVersion": "0.5.0",
                        "platforms": ["macos-arm64"],
                        "archiveUrl": "https://downloads.puppyone.ai/desktop/viewer-packs/puppyone.libreoffice/2.0.0/pack.tar.gz",
                        "archiveSha256": sha('c'),
                        "archiveSizeBytes": 120000,
                        "extractedSizeBytes": 240000,
                        "handlers": [
                            {
                                "id": "pptx-preview",
                                "label": "LibreOffice PDF Preview",
                                "kind": "converter",
                                "runtime": "process",
                                "handles": { "formatIds": ["pptx"], "extensions": [".pptx"], "mimeTypes": [] },
                                "sources": ["local"],
                                "output": "pdf"
                            }
                        ]
                    }
                ]
            }
        ]
    })
}

#[test]
fn handler_id_round_trips_and_rejects_malformed_strings() {
    let valid = [
        (
            "builtin:office-preview",
            HandlerId::builtin("office-preview"),
        ),
        (
            "plugin:puppyone.libreoffice/pptx-preview",
            HandlerId::plugin("puppyone.libreoffice", "pptx-preview"),
        ),
        (
            "app:com.microsoft.Powerpoint",
            HandlerId::app("com.microsoft.Powerpoint"),
        ),
        ("app:default", HandlerId::system_default_app()),
    ];
    for (raw, expected) in valid {
        let parsed = HandlerId::from_str(raw).unwrap();
        assert_eq!(parsed, expected);
        assert_eq!(parsed.to_string(), raw);
        let serialized = serde_json::to_string(&parsed).unwrap();
        assert_eq!(serialized, format!("\"{raw}\""));
        let decoded: HandlerId = serde_json::from_str(&serialized).unwrap();
        assert_eq!(decoded, parsed);
    }

    assert_eq!(
        HandlerId::builtin("markdown").builtin_id(),
        Some("markdown")
    );
    assert_eq!(
        HandlerId::plugin("puppyone.excalidraw", "board").plugin_parts(),
        Some(("puppyone.excalidraw", "board"))
    );
    assert_eq!(
        HandlerId::system_default_app().app_id(),
        Some(handler::SYSTEM_DEFAULT_APP_ID)
    );
    assert!(HandlerId::system_default_app().is_system_default_app());
    assert!(!HandlerId::builtin("markdown").is_system_default_app());
    assert!(HandlerId::builtin("markdown").plugin_parts().is_none());
    assert!(HandlerId::builtin("markdown").app_id().is_none());
    assert!(HandlerId::system_default_app().builtin_id().is_none());

    let invalid = [
        ("unknown:foo", HandlerIdError::UnknownPrefix),
        ("builtin:", HandlerIdError::InvalidBuiltinId),
        ("builtin:UPPER", HandlerIdError::InvalidBuiltinId),
        ("builtin:a/b", HandlerIdError::InvalidBuiltinId),
        (
            "plugin:puppyone.libreoffice",
            HandlerIdError::InvalidPluginFormat,
        ),
        (
            "plugin:puppyone.libreoffice/a/b",
            HandlerIdError::InvalidPluginFormat,
        ),
        ("plugin:single/handler", HandlerIdError::InvalidPluginId),
        (
            "plugin:puppyone.libreoffice/BAD",
            HandlerIdError::InvalidContributionId,
        ),
        ("app:", HandlerIdError::InvalidAppId),
        ("app:bad/slash", HandlerIdError::InvalidAppId),
        ("app:has space", HandlerIdError::InvalidAppId),
    ];
    for (raw, err) in invalid {
        let actual = HandlerId::from_str(raw).unwrap_err();
        assert_eq!(actual, err, "for `{raw}`");
        assert!(!actual.to_string().is_empty());
        assert!(serde_json::from_str::<HandlerId>(&format!("\"{raw}\"")).is_err());
    }
}

#[test]
fn valid_manifests_parse_validate_and_project_handler_definitions() {
    let process_manifest = PluginManifest::parse(&sample_manifest_json().to_string()).unwrap();
    assert!(process_manifest.is_official());
    assert_eq!(process_manifest.total_file_bytes(), 1536);
    assert_eq!(
        process_manifest.check_compatibility("0.4.4", 1, Platform::MacosArm64),
        Ok(())
    );
    assert_eq!(
        process_manifest.check_compatibility("0.4.4", 1, Platform::LinuxX64),
        Err(UnavailableReason::PlatformUnsupported)
    );
    assert_eq!(
        process_manifest.check_compatibility("0.4.3", 1, Platform::MacosArm64),
        Err(UnavailableReason::AppVersionIncompatible)
    );
    assert_eq!(
        process_manifest.check_compatibility("0.4.4", 3, Platform::MacosArm64),
        Err(UnavailableReason::HostApiIncompatible)
    );

    let defs = process_manifest.handler_definitions();
    assert_eq!(defs.len(), 1);
    assert_eq!(
        defs[0].id,
        HandlerId::plugin("puppyone.libreoffice", "pptx-preview")
    );
    assert_eq!(defs[0].kind, HandlerKind::Converter);
    assert_eq!(defs[0].runtime, RuntimeKind::Process);
    assert_eq!(defs[0].distribution, Distribution::OnDemand);
    assert_eq!(defs[0].output.as_deref(), Some("pdf"));
    assert_eq!(defs[0].size_bytes, 1536);

    let web_manifest =
        PluginManifest::parse(&sample_web_editor_manifest_json().to_string()).unwrap();
    assert_eq!(
        web_manifest.check_compatibility("0.4.4", 1, Platform::LinuxX64),
        Ok(())
    );
    let web_defs = web_manifest.handler_definitions();
    assert_eq!(web_defs[0].kind, HandlerKind::Editor);
    assert_eq!(web_defs[0].capability, HandlerCapability::Edit);
    assert!(web_defs[0].source.reads_content());
    assert!(!web_defs[0].source.requires_local_only());
}

#[test]
fn manifest_rejects_unknown_fields() {
    let mut raw = sample_manifest_json();
    raw["unexpected"] = json!(true);
    let errs = PluginManifest::parse(&raw.to_string()).unwrap_err();
    assert!(errs.iter().any(|e| e.code == "manifest-parse-error"));

    let mut nested = sample_manifest_json();
    nested["handlers"][0]["surprise"] = json!(1);
    assert!(PluginManifest::parse(&nested.to_string()).is_err());

    let mut perms = sample_manifest_json();
    perms["permissions"]["extra"] = json!(true);
    assert!(PluginManifest::parse(&perms.to_string()).is_err());
}

#[test]
fn manifest_rejects_bad_ids_versions_core_ids_paths_and_limits() {
    let assert_rejected = |edit: fn(&mut Value), expected_code: &str| {
        let mut raw = sample_manifest_json();
        edit(&mut raw);
        let errors = PluginManifest::parse(&raw.to_string()).unwrap_err();
        assert!(
            errors.iter().any(|e| e.code == expected_code),
            "expected `{expected_code}`, got {errors:?}"
        );
    };

    assert_rejected(
        |m| m["schemaVersion"] = json!(1),
        "schemaVersion-unsupported",
    );
    assert_rejected(|m| m["id"] = json!("single"), "id-invalid");
    assert_rejected(|m| m["id"] = json!("PuppyOne.Bad"), "id-invalid");
    assert_rejected(|m| m["version"] = json!("v1.2.0"), "version-invalid");
    assert_rejected(
        |m| m["minAppVersion"] = json!("0.4"),
        "minAppVersion-invalid",
    );
    assert_rejected(|m| m["publisher"] = json!("X"), "publisher-invalid");
    assert_rejected(|m| m["hostApi"] = json!(0), "hostApi-invalid");
    assert_rejected(|m| m["platforms"] = json!([]), "platforms-empty");
    assert_rejected(
        |m| m["platforms"] = json!(["macos-arm64", "macos-arm64"]),
        "platforms-duplicate",
    );
    assert_rejected(
        |m| m["handlers"][0]["id"] = json!("office-preview"),
        "handlers[0].id-reserved-core",
    );
    assert_rejected(
        |m| m["handlers"][0]["id"] = json!("BadId"),
        "handlers[0].id-invalid",
    );
    assert_rejected(
        |m| m["handlers"][0]["sources"] = json!(["local", "cloud"]),
        "handlers[0].sources-must-be-local-only",
    );
    assert_rejected(
        |m| m["handlers"][0]["entry"] = json!("../escape"),
        "handlers[0].entry-traversal-or-control",
    );
    assert_rejected(
        |m| m["handlers"][0]["entry"] = json!("/abs/soffice"),
        "handlers[0].entry-absolute-or-empty-segment",
    );
    assert_rejected(
        |m| m["handlers"][0]["entry"] = json!("bin/missing"),
        "handlers[0].entry-missing-from-files",
    );
    assert_rejected(
        |m| m["handlers"][0]["output"] = json!(null),
        "handlers[0].output-required",
    );
    assert_rejected(
        |m| m["files"][0]["sha256"] = json!("not-a-hash"),
        "files[0].sha256-invalid",
    );
    assert_rejected(
        |m| m["limits"]["maxExtractedBytes"] = json!(100),
        "files-exceed-extracted-limit",
    );
    assert_rejected(|m| m["licenses"] = json!([]), "licenses-empty");
}

#[test]
fn manifest_enforces_undeclared_network_and_origin_validation() {
    // Handler requests a network origin not declared at top-level permissions.
    let mut undeclared = sample_web_editor_manifest_json();
    undeclared["handlers"][0]["permissions"]["network"] = json!(["https://api.example.com"]);
    let errors = PluginManifest::parse(&undeclared.to_string()).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|e| e.code == "handlers[0].permissions.network-undeclared"),
        "got {errors:?}"
    );

    // Declaring the same valid HTTPS origin at both levels passes.
    let mut declared = undeclared.clone();
    declared["permissions"]["network"] = json!(["https://api.example.com"]);
    let parsed = PluginManifest::parse(&declared.to_string()).unwrap();
    assert!(parsed.permissions.has_network());

    // Invalid network origins (HTTP, wildcard, path, credentials) are rejected.
    for bad in [
        "http://api.example.com",
        "https://*.example.com",
        "https://api.example.com/path",
        "https://user:pass@api.example.com",
        "",
    ] {
        assert!(
            !Permissions::is_valid_network_origin(bad),
            "expected reject `{bad}`"
        );
        let mut raw = sample_web_editor_manifest_json();
        raw["permissions"]["network"] = json!([bad]);
        let errs = PluginManifest::parse(&raw.to_string()).unwrap_err();
        assert!(errs.iter().any(|e| e.code == "permissions.network-invalid"));
    }

    // Related files requested by handler without top-level declaration is rejected.
    let mut related = sample_web_editor_manifest_json();
    related["handlers"][0]["permissions"]["relatedFiles"] = json!("same-directory");
    let errs = PluginManifest::parse(&related.to_string()).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.code == "handlers[0].permissions.relatedFiles-undeclared")
    );
}

#[test]
fn manifest_enforces_editor_and_non_editor_commit_rules() {
    let mut editor_without_commit = sample_web_editor_manifest_json();
    editor_without_commit["handlers"][0]["permissions"]["currentDocument"] =
        json!(["metadata", "read"]);
    let errs = PluginManifest::parse(&editor_without_commit.to_string()).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.code == "handlers[0].permissions-commit-required")
    );

    let mut viewer_with_commit = sample_manifest_json();
    viewer_with_commit["handlers"][0]["permissions"]["currentDocument"] =
        json!(["metadata", "read", "commit"]);
    let errs = PluginManifest::parse(&viewer_with_commit.to_string()).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.code == "handlers[0].permissions-commit-forbidden")
    );
}

#[test]
fn catalog_parses_validates_and_selects_newest_compatible_version() {
    let catalog = Catalog::parse(&sample_catalog_json().to_string()).unwrap();
    assert_eq!(catalog.plugins.len(), 1);
    let plugin = &catalog.plugins[0];

    // App 0.4.4 + host API 1 -> selects 1.2.0 (skips 2.0.0 requiring hostApi 3 & app 0.5.0).
    let chosen = plugin
        .newest_compatible("0.4.4", 1, Platform::MacosArm64)
        .unwrap();
    assert_eq!(chosen.version, "1.2.0");

    // Older app 0.4.2 -> selects 1.0.0 (1.2.0 needs 0.4.4).
    let older = plugin
        .newest_compatible("0.4.2", 1, Platform::MacosArm64)
        .unwrap();
    assert_eq!(older.version, "1.0.0");

    // Unsupported platform -> None.
    assert!(
        plugin
            .newest_compatible("0.4.4", 1, Platform::LinuxX64)
            .is_none()
    );

    // Unknown field rejected.
    let mut bad = sample_catalog_json();
    bad["extra"] = json!(1);
    assert!(Catalog::parse(&bad.to_string()).is_err());

    // Non-HTTPS non-loopback archive URL rejected.
    let mut insecure = sample_catalog_json();
    insecure["plugins"][0]["versions"][0]["archiveUrl"] =
        json!("http://downloads.puppyone.ai/pack.tar.gz");
    let errs = Catalog::parse(&insecure.to_string()).unwrap_err();
    assert!(
        errs.iter()
            .any(|e| e.code == "plugins[0].versions[0].archiveUrl-invalid")
    );

    // Loopback HTTP allowed for local staging/tests.
    let mut loopback = sample_catalog_json();
    loopback["plugins"][0]["versions"][0]["archiveUrl"] =
        json!("http://127.0.0.1:8080/pack.tar.gz");
    assert!(Catalog::parse(&loopback.to_string()).is_ok());
}

#[test]
fn host_api_versioning_and_wire_messages_round_trip() {
    assert!(is_host_api_supported(1, 1));
    assert!(!is_host_api_supported(0, 1));
    assert!(!is_host_api_supported(2, 1));
    assert!(is_host_api_supported(1, 2));
    assert!(is_host_api_supported(2, 2));
    assert!(!is_host_api_supported(1, 3));

    let host_msgs = [
        HostToPluginMessage::Open {
            api_version: HOST_API_VERSION,
            document_id: "doc-1".into(),
            name: "diagram.excalidraw".into(),
            format_id: "excalidraw".into(),
            theme: "dark".into(),
            locale: "en".into(),
            read_only: false,
            content: Some("{}".into()),
            revision: 3,
        },
        HostToPluginMessage::ExternalChange {
            document_id: "doc-1".into(),
            content: "{\"v\":2}".into(),
            revision: 4,
        },
        HostToPluginMessage::ThemeChanged {
            theme: "light".into(),
        },
        HostToPluginMessage::LocaleChanged {
            locale: "zh-Hans".into(),
        },
        HostToPluginMessage::ReadOnlyChanged { read_only: true },
        HostToPluginMessage::Find {
            query: "node".into(),
            case_sensitive: false,
            direction: FindDirection::Next,
        },
        HostToPluginMessage::ClearFind,
        HostToPluginMessage::Undo,
        HostToPluginMessage::Redo,
    ];
    for msg in host_msgs {
        let json = serde_json::to_string(&msg).unwrap();
        let decoded: HostToPluginMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, msg);
    }

    let plugin_msgs = [
        PluginToHostMessage::Ready {
            api_version: HOST_API_VERSION,
        },
        PluginToHostMessage::Dirty {
            document_id: "doc-1".into(),
            dirty: true,
        },
        PluginToHostMessage::Commit {
            document_id: "doc-1".into(),
            base_revision: 3,
            content: "{\"v\":3}".into(),
        },
        PluginToHostMessage::OpenLink {
            target: "./notes.md".into(),
        },
        PluginToHostMessage::FindResult {
            current: 1,
            total: 4,
        },
        PluginToHostMessage::Error {
            code: "render-failed".into(),
            message: "boom".into(),
            recoverable: true,
        },
    ];
    for msg in plugin_msgs {
        let json = serde_json::to_string(&msg).unwrap();
        let decoded: PluginToHostMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, msg);
    }
}

#[test]
fn open_plan_serializes_with_stable_kebab_and_camel_case_schema() {
    let plan = OpenPlan {
        format_id: "pptx".into(),
        handler: HandlerId::plugin("puppyone.libreoffice", "pptx-preview"),
        reason: OpenReason::UserType,
        fallback: HandlerId::builtin("office-preview"),
        alternatives: vec![Alternative {
            handler: HandlerId::builtin("office-preview"),
            label: "Office Preview".into(),
            kind: HandlerKind::Viewer,
            runtime: RuntimeKind::Native,
            distribution: Distribution::Bundled,
            status: CandidateStatus::Available,
        }],
        skipped: vec![SkippedCandidate {
            handler: HandlerId::system_default_app(),
            reason: UnavailableReason::SourceNotAllowed,
        }],
        preference_notice: None,
        chain: Some(ConversionChain {
            converter: HandlerId::plugin("puppyone.libreoffice", "pptx-preview"),
            source_format: "pptx".into(),
            target_format: "pdf".into(),
            target_viewer: HandlerId::builtin("pdf-preview"),
        }),
    };
    let value = serde_json::to_value(&plan).unwrap();
    assert_eq!(value["handler"], "plugin:puppyone.libreoffice/pptx-preview");
    assert_eq!(value["reason"], "user-type");
    assert_eq!(value["fallback"], "builtin:office-preview");
    let decoded: OpenPlan = serde_json::from_value(value).unwrap();
    assert_eq!(decoded, plan);
}

#[test]
fn normalize_relative_path_rejects_traversal_windows_drives_and_control_chars() {
    assert_eq!(
        normalize_relative_path("bin\\soffice").unwrap(),
        "bin/soffice"
    );
    assert_eq!(normalize_relative_path("LICENSE").unwrap(), "LICENSE");
    assert_eq!(normalize_relative_path(""), Err("empty-or-too-long"));
    assert_eq!(
        normalize_relative_path("/etc/passwd"),
        Err("absolute-or-empty-segment")
    );
    assert_eq!(
        normalize_relative_path("C:/win.exe"),
        Err("absolute-or-empty-segment")
    );
    assert_eq!(
        normalize_relative_path("a//b"),
        Err("absolute-or-empty-segment")
    );
    assert_eq!(normalize_relative_path("../a"), Err("traversal-or-control"));
    assert_eq!(normalize_relative_path("./a"), Err("traversal-or-control"));
    assert_eq!(
        normalize_relative_path("a/\x01b"),
        Err("traversal-or-control")
    );
}
