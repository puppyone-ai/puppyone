//! `AccessMethodPermissions`: what a CLI or MCP connection may do. A stored
//! value is read through every shape it has had, and writing one back keeps
//! whatever else its record carries. A key the product does not know is
//! dropped on both paths, so a stale name can never widen what is allowed.
use super::services::EndpointAccess;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

pub type Allowed = BTreeSet<&'static str>;

const CONFIG_KEY: &str = "command_permissions";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Read,
    Write,
}
#[derive(Clone, Copy, Debug)]
struct Spec {
    key: &'static str,
    kind: Kind,
    /// Off by default: the destructive commands.
    default_allowed: bool,
}
const fn read(key: &'static str) -> Spec {
    Spec {
        key,
        kind: Kind::Read,
        default_allowed: true,
    }
}
const fn write(key: &'static str) -> Spec {
    Spec {
        key,
        kind: Kind::Write,
        default_allowed: true,
    }
}
const fn delete(key: &'static str) -> Spec {
    Spec {
        key,
        kind: Kind::Write,
        default_allowed: false,
    }
}
const CLI: [Spec; 17] = [
    read("ls"),
    read("tree"),
    read("find"),
    read("grep"),
    read("stat"),
    read("cat"),
    read("head"),
    read("tail"),
    read("download"),
    write("write"),
    write("mkdir"),
    write("touch"),
    write("upload"),
    write("cp"),
    write("mv"),
    delete("rm"),
    delete("rmdir"),
];
const MCP: [Spec; 16] = [
    read("fs_semantics"),
    read("fs_ls"),
    read("fs_tree"),
    read("fs_find"),
    read("fs_grep"),
    read("fs_cat"),
    read("fs_head"),
    read("fs_tail"),
    read("fs_stat"),
    write("fs_write"),
    write("fs_mkdir"),
    write("fs_touch"),
    write("fs_cp"),
    write("fs_mv"),
    delete("fs_rmdir"),
    delete("fs_rm"),
];

/// `DesktopPermissionGroup`. A muted group is outside what the Scope grants:
/// it shows nothing allowed and cannot change, whatever was stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Group {
    pub title: &'static str,
    pub keys: Vec<&'static str>,
    pub muted: bool,
    pub danger: bool,
}
impl Group {
    pub fn count(&self, allowed: &Allowed) -> usize {
        if self.muted {
            return 0;
        }
        self.keys.iter().filter(|k| allowed.contains(*k)).count()
    }
    pub fn all(&self, allowed: &Allowed) -> bool {
        !self.muted && self.keys.iter().all(|k| allowed.contains(k))
    }
    /// `onToggleAll(group, !anyEnabled)`: a group with anything on turns off.
    pub fn toggled(&self, allowed: &Allowed) -> Allowed {
        let enable = self.count(allowed) == 0;
        let mut next = allowed.clone();
        for key in &self.keys {
            if enable {
                next.insert(key);
            } else {
                next.remove(key);
            }
        }
        next
    }
}
/// One command flipped.
pub fn toggled(allowed: &Allowed, key: &'static str) -> Allowed {
    let mut next = allowed.clone();
    if !next.remove(key) {
        next.insert(key);
    }
    next
}
fn groups(specs: &[Spec], titles: [&'static str; 3], writable: bool) -> Vec<Group> {
    let keys = |test: &dyn Fn(&Spec) -> bool| -> Vec<&'static str> {
        specs.iter().filter(|s| test(s)).map(|s| s.key).collect()
    };
    let [reading, writing, deleting] = titles;
    vec![
        Group {
            title: reading,
            keys: keys(&|s| s.kind == Kind::Read),
            muted: false,
            danger: false,
        },
        Group {
            title: writing,
            keys: keys(&|s| s.kind == Kind::Write && s.default_allowed),
            muted: !writable,
            danger: false,
        },
        Group {
            title: deleting,
            keys: keys(&|s| s.kind == Kind::Write && !s.default_allowed),
            muted: !writable,
            danger: true,
        },
    ]
}
/// `getDesktopCliPermissionGroups`: a read-only Scope mutes both write groups.
pub fn cli_groups(max_mode: &str) -> Vec<Group> {
    groups(
        &CLI,
        [
            "cloud.access.permissions.readFiles",
            "cloud.access.permissions.modifyFiles",
            "cloud.access.permissions.deleteFiles",
        ],
        max_mode != "r",
    )
}
pub fn mcp_groups(writable: bool) -> Vec<Group> {
    groups(
        &MCP,
        [
            "cloud.access.permissions.readTools",
            "cloud.access.permissions.writeTools",
            "cloud.access.permissions.deleteTools",
        ],
        writable,
    )
}
/// `getDesktopMcpWritable`: an endpoint with no recorded access inherits the
/// Scope; otherwise one writable access is needed.
pub fn mcp_writable(accesses: &[EndpointAccess], max_mode: &str) -> bool {
    max_mode == "rw" && (accesses.is_empty() || accesses.iter().any(|a| a.readonly == Some(false)))
}

fn defaults(specs: &[Spec]) -> Allowed {
    specs
        .iter()
        .filter(|s| s.default_allowed)
        .map(|s| s.key)
        .collect()
}
fn known(specs: &[Spec], key: &str) -> Option<&'static str> {
    specs.iter().find(|s| s.key == key).map(|s| s.key)
}
/// A listed array, empty included: an explicit "nothing" stays nothing.
fn listed(value: Option<&Value>, specs: &[Spec]) -> Option<Allowed> {
    Some(
        value?
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .filter_map(|key| known(specs, key))
            .collect(),
    )
}
fn flagged(map: &Map<String, Value>, specs: &[Spec]) -> Allowed {
    specs
        .iter()
        .filter(|s| map.get(s.key) == Some(&Value::Bool(true)))
        .map(|s| s.key)
        .collect()
}
fn record<'a>(value: &'a Map<String, Value>, key: &str) -> Option<&'a Map<String, Value>> {
    value.get(key).and_then(Value::as_object)
}
fn is(groups: &Map<String, Value>, key: &str, value: bool) -> bool {
    groups.get(key) == Some(&Value::Bool(value))
}

/// `parseCliCommandPermissions`.
pub fn parse_cli(config: &Value) -> Allowed {
    let Some(raw) = config.get(CONFIG_KEY).and_then(Value::as_object) else {
        return defaults(&CLI);
    };
    if let Some(allowed) =
        listed(raw.get("allowed"), &CLI).or_else(|| listed(raw.get("allowed_commands"), &CLI))
    {
        return allowed;
    }
    if let Some(commands) = record(raw, "commands") {
        return flagged(commands, &CLI);
    }
    if let Some(groups) = record(raw, "groups") {
        return legacy_cli_groups(groups);
    }
    defaults(&CLI)
}
fn legacy_cli_groups(groups: &Map<String, Value>) -> Allowed {
    let mut allowed = Allowed::new();
    if !is(groups, "read", false) {
        allowed.extend(CLI.iter().filter(|s| s.kind == Kind::Read).map(|s| s.key));
    }
    let mut add = |group: &str, keys: &[&'static str]| {
        if is(groups, group, true) {
            allowed.extend(keys);
        }
    };
    add("write", &["write", "mkdir", "touch", "upload"]);
    add("move", &["cp", "mv"]);
    add("delete", &["rm", "rmdir"]);
    allowed
}
/// `parseMcpToolPermissions`.
pub fn parse_mcp(raw: &Value) -> Allowed {
    if let Some(allowed) = legacy_mcp_list(raw) {
        return allowed;
    }
    let Some(record_value) = raw.as_object() else {
        return defaults(&MCP);
    };
    let filesystem = record(record_value, "filesystem")
        .or_else(|| record(record_value, "fs"))
        .unwrap_or(record_value);
    let allowed = listed(filesystem.get("allowed"), &MCP)
        .or_else(|| listed(filesystem.get("allowed_tools"), &MCP))
        .or_else(|| listed(filesystem.get("tools_allowed"), &MCP));
    if let Some(allowed) = allowed {
        return allowed;
    }
    if let Some(tools) = record(filesystem, "tools") {
        return flagged(tools, &MCP);
    }
    if let Some(groups) = record(filesystem, "groups") {
        return mcp_group_flags(groups);
    }
    if ["read", "write", "delete"]
        .iter()
        .any(|k| filesystem.contains_key(*k))
    {
        return mcp_group_flags(filesystem);
    }
    defaults(&MCP)
}
fn legacy_mcp_list(value: &Value) -> Option<Allowed> {
    let mut found = false;
    let mut allowed = Allowed::new();
    for item in value.as_array()?.iter().filter_map(Value::as_object) {
        let name = item
            .get("name")
            .filter(|v| !v.is_null())
            .or_else(|| item.get("tool_name"))
            .and_then(Value::as_str);
        let Some(key) = name.and_then(|n| known(&MCP, n)) else {
            continue;
        };
        found = true;
        if !is(item, "enabled", false) {
            allowed.insert(key);
        }
    }
    found.then_some(allowed)
}
fn mcp_group_flags(groups: &Map<String, Value>) -> Allowed {
    let tools = |kind: Kind, default_allowed: bool| {
        MCP.iter()
            .filter(move |s| s.kind == kind && s.default_allowed == default_allowed)
            .map(|s| s.key)
    };
    let mut allowed = Allowed::new();
    if !is(groups, "read", false) {
        allowed.extend(tools(Kind::Read, true));
    }
    if !is(groups, "write", false) {
        allowed.extend(tools(Kind::Write, true));
    }
    if is(groups, "delete", true) {
        allowed.extend(tools(Kind::Write, false));
    }
    allowed
}

fn ordered(specs: &[Spec], allowed: &Allowed) -> Vec<&'static str> {
    specs
        .iter()
        .map(|s| s.key)
        .filter(|k| allowed.contains(k))
        .collect()
}
/// The surface's whole config with its permissions replaced.
pub fn cli_config(config: &Value, allowed: &Allowed) -> Value {
    let mut next = config.as_object().cloned().unwrap_or_default();
    next.insert(
        CONFIG_KEY.into(),
        json!({"allowed": ordered(&CLI, allowed)}),
    );
    Value::Object(next)
}
/// `buildMcpToolsConfig`: always the current shape, shell off, and the tools
/// bound to the endpoint kept under whichever name they were stored.
pub fn mcp_config(raw: &Value, allowed: &Allowed) -> Value {
    let mut next = json!({
        "version": 1,
        "filesystem": {"allowed": ordered(&MCP, allowed)},
        "shell": {"enabled": false},
    });
    let custom = custom_tools(raw);
    if !custom.is_empty() {
        next["custom_tools"] = Value::Array(custom);
    }
    next
}
fn custom_tools(value: &Value) -> Vec<Value> {
    let read = |items: Option<&Value>| -> Vec<Value> {
        items
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_object)
            .filter_map(|item| {
                let id = item.get("tool_id")?.as_str()?;
                let mut tool = json!({"tool_id": id});
                if let Some(enabled) = item.get("enabled").filter(|v| v.is_boolean()) {
                    tool["enabled"] = enabled.clone();
                }
                Some(tool)
            })
            .collect()
    };
    if value.is_array() {
        return read(Some(value));
    }
    ["custom_tools", "bound_tools", "external_tools"]
        .iter()
        .flat_map(|key| read(value.get(*key)))
        .collect()
}

/// `parseScopeExclude`: one path a line.
pub fn parse_exclude(value: &str) -> Vec<String> {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(keys: &[&'static str]) -> Allowed {
        keys.iter().copied().collect()
    }
    fn access(readonly: Option<bool>) -> EndpointAccess {
        EndpointAccess {
            path: String::new(),
            readonly,
        }
    }

    #[test]
    fn nothing_stored_allows_all_but_the_destructive_commands() {
        for raw in [json!(null), json!({}), json!({"command_permissions": 1})] {
            let cli = parse_cli(&raw);
            assert_eq!(cli.len(), 15);
            assert!(cli.contains("cat") && cli.contains("mv"));
            assert!(!cli.contains("rm") && !cli.contains("rmdir"));
        }
        for raw in [json!(null), json!({}), json!(3), json!([])] {
            let mcp = parse_mcp(&raw);
            assert_eq!(mcp.len(), 14);
            assert!(!mcp.contains("fs_rm") && !mcp.contains("fs_rmdir"));
        }
    }

    #[test]
    fn every_stored_cli_shape_reads_back_and_an_empty_list_stays_empty() {
        let parsed = |permissions: Value| parse_cli(&json!({"command_permissions": permissions}));
        assert_eq!(
            parsed(json!({"allowed": ["cat", "rm"]})),
            set(&["cat", "rm"])
        );
        assert_eq!(parsed(json!({"allowed_commands": ["ls"]})), set(&["ls"]));
        assert_eq!(parsed(json!({"allowed": []})), set(&[]));
        assert_eq!(
            parsed(json!({"commands": {"ls": true, "rm": false, "cat": "yes"}})),
            set(&["ls"])
        );
        let legacy = parsed(json!({"groups": {"read": false, "write": true, "move": true}}));
        assert_eq!(
            legacy,
            set(&["write", "mkdir", "touch", "upload", "cp", "mv"])
        );
        let reading = parsed(json!({"groups": {"delete": true}}));
        assert!(reading.contains("cat") && reading.contains("rm"));
        assert!(!reading.contains("write"));
    }

    #[test]
    fn every_stored_mcp_shape_reads_back() {
        for raw in [
            json!({"filesystem": {"allowed": ["fs_ls"]}}),
            json!({"fs": {"allowed_tools": ["fs_ls"]}}),
            json!({"tools_allowed": ["fs_ls"]}),
            json!({"filesystem": {"tools": {"fs_ls": true, "fs_rm": false}}}),
        ] {
            assert_eq!(parse_mcp(&raw), set(&["fs_ls"]), "{raw}");
        }
        let listed = parse_mcp(&json!([
            {"name": "fs_ls"},
            {"tool_name": "fs_rm", "enabled": true},
            {"name": "fs_cat", "enabled": false},
        ]));
        assert_eq!(listed, set(&["fs_ls", "fs_rm"]));
        let grouped = parse_mcp(&json!({"filesystem": {"groups": {"write": false}}}));
        assert!(grouped.contains("fs_cat") && !grouped.contains("fs_write"));
        let flat = parse_mcp(&json!({"delete": true, "read": false}));
        assert!(flat.contains("fs_rm") && flat.contains("fs_write"));
        assert!(!flat.contains("fs_cat"));
    }

    #[test]
    fn a_name_the_product_does_not_know_never_gets_through() {
        assert_eq!(
            parse_cli(&json!({"command_permissions": {"allowed": ["ls", "sudo", 7]}})),
            set(&["ls"])
        );
        assert_eq!(
            parse_mcp(&json!({"filesystem": {"allowed": ["fs_ls", "shell_exec"]}})),
            set(&["fs_ls"])
        );
        // No known tool at all: not a list of tools, so the defaults apply.
        assert_eq!(parse_mcp(&json!([{"name": "shell_exec"}])).len(), 14);
    }

    #[test]
    fn writing_keeps_the_rest_of_the_record_in_the_products_order() {
        let config = json!({"profile": "ops", "command_permissions": {"allowed": ["ls"]}});
        let next = cli_config(&config, &set(&["mv", "cat", "ls"]));
        assert_eq!(next["profile"], "ops");
        assert_eq!(
            next["command_permissions"],
            json!({"allowed": ["ls", "cat", "mv"]})
        );
        assert_eq!(parse_cli(&next), set(&["mv", "cat", "ls"]));

        let raw = json!({"bound_tools": [{"tool_id": "a", "enabled": false, "x": 1}, {"nope": 1}],
            "custom_tools": [{"tool_id": "b"}]});
        let tools = mcp_config(&raw, &set(&["fs_cat", "fs_ls"]));
        assert_eq!(
            tools,
            json!({"version": 1, "filesystem": {"allowed": ["fs_ls", "fs_cat"]},
                "shell": {"enabled": false},
                "custom_tools": [{"tool_id": "b"}, {"tool_id": "a", "enabled": false}]})
        );
        assert!(
            mcp_config(&json!({}), &set(&[]))
                .get("custom_tools")
                .is_none()
        );
        assert_eq!(parse_mcp(&tools), set(&["fs_cat", "fs_ls"]));
    }

    #[test]
    fn a_read_only_scope_mutes_the_write_groups_whatever_was_stored() {
        let open = cli_groups("rw");
        assert!(open.iter().all(|g| !g.muted));
        assert_eq!(open[2].keys, ["rm", "rmdir"]);
        assert!(open[2].danger);
        let closed = cli_groups("r");
        assert!(!closed[0].muted && closed[1].muted && closed[2].muted);
        let stored = set(&["write", "rm", "cat"]);
        assert_eq!(closed[1].count(&stored), 0);
        assert!(!closed[1].all(&stored));

        assert!(!mcp_groups(true)[1].muted);
        assert!(mcp_groups(false)[1].muted);
    }

    #[test]
    fn an_endpoint_is_writable_only_inside_a_writable_scope() {
        assert!(mcp_writable(&[], "rw"));
        assert!(!mcp_writable(&[], "r"));
        assert!(!mcp_writable(&[access(Some(false))], "r"));
        assert!(mcp_writable(
            &[access(Some(true)), access(Some(false))],
            "rw"
        ));
        assert!(!mcp_writable(&[access(Some(true)), access(None)], "rw"));
    }

    #[test]
    fn a_group_with_anything_on_turns_off_and_an_empty_one_turns_on() {
        let group = &cli_groups("rw")[2];
        let both = group.toggled(&set(&["cat"]));
        assert_eq!(both, set(&["cat", "rm", "rmdir"]));
        assert!(group.all(&both));
        assert_eq!(group.toggled(&set(&["cat", "rm"])), set(&["cat"]));
        assert_eq!(toggled(&set(&["cat"]), "ls"), set(&["cat", "ls"]));
        assert_eq!(toggled(&set(&["cat"]), "cat"), set(&[]));
    }

    #[test]
    fn excluded_paths_are_one_a_line_trimmed_and_never_blank() {
        assert_eq!(
            parse_exclude("dist\r\n  .cache  \n\n*.tmp\n"),
            ["dist", ".cache", "*.tmp"]
        );
        assert!(parse_exclude(" \n\t").is_empty());
    }
}
