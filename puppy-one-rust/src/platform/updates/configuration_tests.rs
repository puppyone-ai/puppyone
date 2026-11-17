use super::*;

fn identity(channel: Channel, packaged: bool) -> Identity {
    Identity {
        channel,
        packaged,
        version: match channel {
            Channel::Dev => "1.4.0-dev.gdddddddd",
            Channel::Internal => "1.4.0-internal.72",
            Channel::Stable => "1.4.0",
        }
        .into(),
        ..crate::platform::build_identity::current()
    }
}

fn environment(key: &str) -> Option<String> {
    Some(
        match key {
            "PUPPYONE_DESKTOP_UPDATE_CHANNEL" => "dev",
            "PUPPYONE_DESKTOP_UPDATE_URL" => "https://attacker.invalid/latest",
            "PUPPYONE_DESKTOP_DEV_UPDATE_URL" => "https://attacker.invalid/dev",
            "PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG" => "1",
            _ => panic!("unexpected runtime input: {key}"),
        }
        .into(),
    )
}

#[test]
fn actual_release_stamps_pin_both_macos_channels_and_ignore_runtime_overrides() {
    // Exercise the real packaging producer and the runtime consumer together.
    // Python is already required by the repository's local release gates.
    let release = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/release");
    let output = std::process::Command::new("python3")
        .args([
            "-B",
            "-c",
            r#"
import json, sys
sys.path.insert(0, sys.argv[1])
import identity
print(json.dumps({channel: identity.build_environment(identity.release_identity(
    '1.4.0', channel, 'd' * 40, '72', built_at='2026-11-17T00:00:00.000Z'
)) for channel in ('dev', 'internal', 'stable')}))
"#,
        ])
        .arg(release)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stamps: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(stamps["dev"].get("PUPPYONE_UPDATE_FEED_URL").is_none());
    for (channel, origin) in [
        (Channel::Internal, "https://downloads.puppyone.ai"),
        (Channel::Stable, "https://updates.puppyone.ai"),
    ] {
        let identity = identity(channel, true);
        let stamp = &stamps[channel.key()];
        assert_eq!(stamp["PUPPYONE_BUILD_VERSION"], identity.version);
        let expected = format!("{origin}/desktop/{}/mac/latest", channel.key());
        assert_eq!(stamp["PUPPYONE_UPDATE_FEED_URL"], expected);
        let config = resolve_configuration(
            &identity,
            stamp["PUPPYONE_UPDATE_FEED_URL"].as_str(),
            environment,
        );
        assert_eq!(config.channel, channel);
        assert_eq!(config.current_version, identity.version);
        assert_eq!(config.update_channel, Some(channel.key()));
        assert!(!config.force_dev);
        assert_eq!(config.feed.as_ref().unwrap().as_str(), expected);
        assert_eq!(disabled_reason(&config, true, || Signature::Release), None);
        let archives = feed::Metadata {
            version: identity.version.clone(),
            files: ["x64", "arm64"]
                .into_iter()
                .map(|arch| feed::File {
                    url: format!("puppyone-{}-{arch}.zip", identity.version),
                    sha512: String::new(),
                    size: 1,
                })
                .collect(),
            path: String::new(),
            sha512: String::new(),
            release_date: String::new(),
        };
        for architecture in ["arm64", "x64"] {
            // macOS has one shared channel feed; architecture selects only
            // its archive, never a different origin or metadata channel.
            let metadata = feed::payload_url(
                config.feed.as_ref().unwrap(),
                &format!("{}-mac.yml", channel.key()),
                false,
            )
            .unwrap();
            assert_eq!(
                metadata.as_str(),
                format!("{expected}/{}-mac.yml", channel.key())
            );
            let selected = feed::payload(&archives, architecture).unwrap();
            let payload =
                feed::payload_url(config.feed.as_ref().unwrap(), &selected.url, false).unwrap();
            assert_eq!(
                payload.as_str(),
                format!(
                    "{expected}/puppyone-{}-{architecture}.zip",
                    identity.version
                )
            );
        }
        assert!(!policy::evaluate(channel, &identity.version, Some(&identity.version)).allowed);
        assert!(!policy::evaluate(channel, &identity.version, Some("1.3.9")).allowed);
        let cross_channel = if channel == Channel::Stable {
            "1.4.1-internal.73"
        } else {
            "1.4.1"
        };
        assert!(!policy::evaluate(channel, &identity.version, Some(cross_channel)).allowed);
    }
}

#[test]
fn runtime_cannot_replace_the_compiled_feed_or_enable_a_packaged_dev_build() {
    for channel in [Channel::Stable, Channel::Internal, Channel::Dev] {
        for packaged in [false, true] {
            if channel == Channel::Dev && !packaged {
                continue;
            }
            let identity = identity(channel, packaged);
            let pristine = configuration(&identity, |_| None);
            let injected = configuration(&identity, environment);
            assert_eq!(injected, pristine, "{channel:?} packaged={packaged}");
            assert!(!injected.force_dev);
            if channel == Channel::Dev {
                assert_eq!(injected.feed, None);
                assert_eq!(injected.update_channel, None);
                assert_eq!(
                    resolve_configuration(
                        &identity,
                        Some("https://compiled.example/release"),
                        environment
                    )
                    .feed,
                    None
                );
            } else {
                assert_eq!(
                    resolve_configuration(&identity, None, environment).feed,
                    None
                );
                let pinned = resolve_configuration(
                    &identity,
                    Some("https://compiled.example/release/"),
                    environment,
                );
                assert_eq!(
                    pinned.feed.unwrap().as_str(),
                    "https://compiled.example/release"
                );
                assert_eq!(pinned.update_channel, Some(channel.key()));
            }
        }
    }
}

#[test]
fn development_requires_an_allowed_feed_and_an_exact_explicit_opt_in() {
    let identity = identity(Channel::Dev, false);
    for forced in [
        None,
        Some(""),
        Some("false"),
        Some("TRUE"),
        Some(" true "),
        Some("0"),
        Some("1"),
        Some("true"),
        Some("yes"),
    ] {
        for source in [
            None,
            Some(""),
            Some("  "),
            Some("https://localhost.invalid/dev/"),
            Some(" http://127.0.0.1:8765/feed/ "),
            Some("http://localhost:8765/feed"),
            Some("http://remote.invalid/feed"),
            Some("file:///tmp/feed"),
            Some("https://user:password@host.invalid/feed"),
            Some("https://host.invalid/feed?token=x"),
        ] {
            let config = configuration(&identity, |key| match key {
                "PUPPYONE_DESKTOP_DEV_UPDATE_URL" => source.map(str::to_owned),
                "PUPPYONE_DESKTOP_FORCE_DEV_UPDATE_CONFIG" => forced.map(str::to_owned),
                _ => panic!("unsupported override: {key}"),
            });
            let expected = matches!(forced, Some("1" | "true" | "yes"))
                && matches!(
                    source,
                    Some(
                        "https://localhost.invalid/dev/"
                            | " http://127.0.0.1:8765/feed/ "
                            | "http://localhost:8765/feed"
                    )
                );
            assert_eq!(config.force_dev, expected, "{source:?} {forced:?}");
            assert_eq!(config.update_channel, expected.then_some("dev"));
            assert_eq!(config.feed.is_some(), expected);
            assert_eq!(config.current_version, identity.version);
            if expected {
                assert_eq!(
                    config.feed.unwrap().as_str(),
                    source.unwrap().trim().trim_end_matches('/')
                );
            }
        }
    }
}

#[test]
fn preflight_rejections_are_ordered_and_never_inspect_signatures_when_disabled_earlier() {
    for (channel, packaged, message) in [
        (Channel::Dev, false, "Development builds"),
        (Channel::Dev, true, "Development builds"),
        (Channel::Stable, false, "outside a packaged release"),
        (Channel::Internal, false, "outside a packaged release"),
    ] {
        let config = configuration(&identity(channel, packaged), |_| None);
        let reason = disabled_reason(&config, packaged, || {
            panic!("disabled builds must not inspect a native signature")
        });
        assert!(reason.unwrap().contains(message));
    }
    let config = configuration(&identity(Channel::Dev, false), |key| {
        Some(
            if key == "PUPPYONE_DESKTOP_DEV_UPDATE_URL" {
                "http://127.0.0.1/feed"
            } else {
                "1"
            }
            .into(),
        )
    });
    assert_eq!(
        disabled_reason(&config, false, || panic!(
            "explicit local override has no packaged app"
        )),
        None
    );
    #[cfg(target_os = "macos")]
    for (signature, message) in [
        (Signature::AdHoc, "ad-hoc signed"),
        (Signature::Unsigned, "not code signed"),
        (
            Signature::OtherCertificate,
            "not signed with a release certificate",
        ),
        (
            Signature::Unreadable("inspection failed".into()),
            "inspection failed",
        ),
        (Signature::Release, "names no update feed"),
    ] {
        let config = resolve_configuration(&identity(Channel::Stable, true), None, |_| None);
        assert!(
            disabled_reason(&config, true, || signature)
                .unwrap()
                .contains(message)
        );
    }
}
