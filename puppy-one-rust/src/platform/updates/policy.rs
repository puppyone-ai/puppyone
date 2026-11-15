//! `update-policy.mjs`: an update candidate is offered only when it is a
//! canonical semantic version strictly newer than the running one, on the
//! running build's own channel. Anything malformed fails closed.
use crate::platform::build_identity::Channel;
use std::cmp::Ordering;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Relation {
    Newer,
    Same,
    Older,
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Evaluation {
    pub allowed: bool,
    pub channel_compatible: bool,
    pub relation: Relation,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Identifier {
    Numeric(u64),
    Text(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    text: String,
    core: [u64; 3],
    prerelease: Vec<Identifier>,
}

/// `parseCanonicalVersion`: SemVer 2.0 without leading zeros or padding.
pub fn parse(value: &str) -> Option<Version> {
    if value.is_empty() || value.trim() != value {
        return None;
    }
    let (without_build, build) = match value.split_once('+') {
        Some((head, build)) => (head, Some(build)),
        None => (value, None),
    };
    if build.is_some_and(|b| !identifiers(b)) {
        return None;
    }
    let (core, prerelease) = match without_build.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (without_build, None),
    };
    let numbers: Vec<&str> = core.split('.').collect();
    if numbers.len() != 3 || !numbers.iter().all(|n| numeric(n)) {
        return None;
    }
    let mut parsed = [0u64; 3];
    for (slot, part) in parsed.iter_mut().zip(&numbers) {
        *slot = safe_integer(part)?;
    }
    let prerelease = match prerelease {
        None => Vec::new(),
        Some(pre) => {
            if !identifiers(pre) {
                return None;
            }
            pre.split('.')
                .map(|id| {
                    if id.bytes().all(|b| b.is_ascii_digit()) {
                        if id.len() > 1 && id.starts_with('0') {
                            return None;
                        }
                        safe_integer(id).map(Identifier::Numeric)
                    } else {
                        Some(Identifier::Text(id.to_owned()))
                    }
                })
                .collect::<Option<Vec<_>>>()?
        }
    };
    Some(Version {
        text: value.to_owned(),
        core: parsed,
        prerelease,
    })
}

fn numeric(part: &str) -> bool {
    !part.is_empty()
        && part.bytes().all(|b| b.is_ascii_digit())
        && (part == "0" || !part.starts_with('0'))
}
/// `Number.isSafeInteger`.
fn safe_integer(part: &str) -> Option<u64> {
    part.parse::<u64>().ok().filter(|n| *n < (1u64 << 53))
}
fn identifiers(list: &str) -> bool {
    list.split('.')
        .all(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}

/// `compareParsedVersions`: SemVer precedence; build metadata is ignored.
pub fn compare(left: &Version, right: &Version) -> Ordering {
    left.core.cmp(&right.core).then_with(|| {
        match (left.prerelease.is_empty(), right.prerelease.is_empty()) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            (false, false) => {
                for (l, r) in left.prerelease.iter().zip(&right.prerelease) {
                    let order = match (l, r) {
                        (Identifier::Numeric(a), Identifier::Numeric(b)) => a.cmp(b),
                        (Identifier::Numeric(_), Identifier::Text(_)) => Ordering::Less,
                        (Identifier::Text(_), Identifier::Numeric(_)) => Ordering::Greater,
                        (Identifier::Text(a), Identifier::Text(b)) => a.cmp(b),
                    };
                    if order != Ordering::Equal {
                        return order;
                    }
                }
                left.prerelease.len().cmp(&right.prerelease.len())
            }
        }
    })
}

/// `isVersionCompatibleWithChannel`.
fn compatible(version: &Version, channel: Channel) -> bool {
    match channel {
        Channel::Stable => version.prerelease.is_empty() && !version.text.contains('+'),
        Channel::Dev => !version.prerelease.is_empty(),
        Channel::Internal => {
            !version.text.contains('+')
                && version.prerelease.len() == 2
                && version.prerelease[0] == Identifier::Text("internal".into())
                && matches!(version.prerelease[1], Identifier::Numeric(n) if n > 0)
        }
    }
}

/// `evaluateDesktopUpdateCandidate`.
pub fn evaluate(channel: Channel, current: &str, candidate: Option<&str>) -> Evaluation {
    let (Some(current), Some(candidate)) = (parse(current), candidate.and_then(parse)) else {
        return Evaluation {
            allowed: false,
            channel_compatible: false,
            relation: Relation::Invalid,
        };
    };
    let order = compare(&candidate, &current);
    let channel_compatible = compatible(&current, channel) && compatible(&candidate, channel);
    Evaluation {
        allowed: order == Ordering::Greater && channel_compatible,
        channel_compatible,
        relation: match order {
            Ordering::Greater => Relation::Newer,
            Ordering::Less => Relation::Older,
            Ordering::Equal => Relation::Same,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn channel_of(version: &str) -> Channel {
        if version.contains("internal") {
            Channel::Internal
        } else {
            Channel::Stable
        }
    }

    /// `desktopUpdatePolicy.test.mjs`.
    #[test]
    fn only_a_strictly_newer_candidate_is_accepted() {
        for (current, candidate) in [
            ("0.3.13", "0.3.14"),
            ("0.3.13-internal.33", "0.3.13-internal.34"),
            ("0.3.13-internal.33", "0.3.14-internal.1"),
        ] {
            let e = evaluate(channel_of(current), current, Some(candidate));
            assert!(
                e.allowed && e.relation == Relation::Newer,
                "{current} -> {candidate}"
            );
        }
        for (current, candidate, relation) in [
            ("0.3.13", "0.3.13", Relation::Same),
            ("0.3.13", "0.3.11", Relation::Older),
            ("0.3.13", "0.1.14", Relation::Older),
            ("0.3.13-internal.33", "0.3.13-internal.32", Relation::Older),
        ] {
            let e = evaluate(channel_of(current), current, Some(candidate));
            assert!(
                !e.allowed && e.relation == relation,
                "{current} -> {candidate}"
            );
        }
    }

    #[test]
    fn semver_prerelease_ordering_is_canonical() {
        let ordered = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
        ];
        for pair in ordered.windows(2) {
            assert_eq!(
                compare(&parse(pair[1]).unwrap(), &parse(pair[0]).unwrap()),
                Ordering::Greater,
                "{pair:?}"
            );
        }
        assert_eq!(
            compare(
                &parse("1.0.0+build.2").unwrap(),
                &parse("1.0.0+build.1").unwrap()
            ),
            Ordering::Equal
        );
        for bad in ["01.0.0", "1.01.0", "1.0.01", "1.0.0-alpha.01", "1.0"] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn wrong_channel_and_malformed_input_fail_closed() {
        for (channel, current, candidate) in [
            (Channel::Stable, "0.3.13", "0.3.14-internal.1"),
            (Channel::Internal, "0.3.13-internal.33", "0.3.14"),
        ] {
            let e = evaluate(channel, current, Some(candidate));
            assert!(!e.allowed && !e.channel_compatible && e.relation == Relation::Newer);
        }
        for (current, candidate) in [
            ("not-semver", Some("0.3.14")),
            ("0.3.13", Some("v0.3.14")),
            ("0.3.13", Some(" 0.3.14")),
            ("0.3.13", None),
        ] {
            let e = evaluate(Channel::Stable, current, candidate);
            assert!(!e.allowed && e.relation == Relation::Invalid);
        }
    }
}
