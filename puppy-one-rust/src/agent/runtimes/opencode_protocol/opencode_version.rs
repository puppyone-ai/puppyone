//! `runtimes/opencode-protocol/opencode-version.mjs`.
use regex::Regex;
use std::sync::LazyLock;

static VERSION_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:opencode(?:\s+version)?\s+)?v?(\d+\.\d+\.\d+)$").expect("version pattern")
});

/// `parseOpenCodeVersion(value)`.
pub fn parse_open_code_version(value: &str) -> Option<String> {
    value.split('\n').find_map(|line| {
        let line = line.strip_suffix('\r').unwrap_or(line).trim();
        VERSION_LINE
            .captures(line)
            .and_then(|captures| captures.get(1))
            .map(|m| m.as_str().to_string())
    })
}
