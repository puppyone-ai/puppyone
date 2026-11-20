//! User preferences for file opening (`fileTypeDefaults` and `fileOverrides`),
//! pure JSON serialization helpers, and invalidation (§4.3).
//!
//! Storage I/O lives outside Layer ②:
//! - `fileTypeDefaults` persists in user settings (`platform::preference_storage`).
//! - `fileOverrides` persists only in local project editor state
//!   (`platform::editor_state_storage`), never written into workspace files and
//!   never synced to Cloud (§8.1).

use crate::{
    editor::registry,
    plugin_contract::{
        Catalog, HandlerId, Platform, PluginManifest, SkippedCandidate, UnavailableReason,
    },
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, str::FromStr};

/// Per-format default handlers (`formatId -> HandlerId`).
pub type FileTypeDefaults = BTreeMap<String, HandlerId>;

/// Per-file local overrides (`resourceId -> HandlerId`).
pub type FileOverrides = BTreeMap<String, HandlerId>;

/// Combined opening preferences supplied to [`super::open_plan`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OpenPreferences {
    /// Global user defaults keyed by canonical format ID (`markdown`, `csv`, …).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub file_type_defaults: FileTypeDefaults,
    /// Project-local per-file overrides keyed by stable resource ID (`resource_key`).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub file_overrides: FileOverrides,
}

/// Summary of stale preference entries removed by [`OpenPreferences::invalidate`].
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InvalidationReport {
    pub removed_type_defaults: Vec<(String, SkippedCandidate)>,
    pub removed_file_overrides: Vec<(String, SkippedCandidate)>,
}

impl InvalidationReport {
    pub fn is_empty(&self) -> bool {
        self.removed_type_defaults.is_empty() && self.removed_file_overrides.is_empty()
    }
}

impl OpenPreferences {
    pub fn new(file_type_defaults: FileTypeDefaults, file_overrides: FileOverrides) -> Self {
        Self {
            file_type_defaults,
            file_overrides,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.file_type_defaults.is_empty() && self.file_overrides.is_empty()
    }

    pub fn type_default(&self, format_id: &str) -> Option<&HandlerId> {
        self.file_type_defaults.get(format_id)
    }

    pub fn file_override(&self, resource_id: &str) -> Option<&HandlerId> {
        self.file_overrides.get(resource_id)
    }

    pub fn set_type_default(&mut self, format_id: impl Into<String>, handler: HandlerId) {
        self.file_type_defaults.insert(format_id.into(), handler);
    }

    pub fn clear_type_default(&mut self, format_id: &str) -> bool {
        self.file_type_defaults.remove(format_id).is_some()
    }

    pub fn set_file_override(&mut self, resource_id: impl Into<String>, handler: HandlerId) {
        self.file_overrides.insert(resource_id.into(), handler);
    }

    pub fn clear_file_override(&mut self, resource_id: &str) -> bool {
        self.file_overrides.remove(resource_id).is_some()
    }

    /// Rebinds a per-file override when a file is renamed or moved inside the
    /// workspace so the override follows the resource.
    pub fn rebase_file_override(
        &mut self,
        old_resource_id: &str,
        new_resource_id: impl Into<String>,
    ) -> bool {
        let Some(handler) = self.file_overrides.remove(old_resource_id) else {
            return false;
        };
        self.file_overrides.insert(new_resource_id.into(), handler);
        true
    }

    /// Removes preferences that point at uninstalled, incompatible, or unknown
    /// handlers, returning every removed entry with its reason.
    pub fn invalidate(
        &mut self,
        installed: &[PluginManifest],
        _catalog: &Catalog,
        app_version: &str,
        host_api: u32,
        platform: Platform,
    ) -> InvalidationReport {
        let mut report = InvalidationReport::default();

        self.file_type_defaults.retain(|format_id, handler| {
            match stored_handler_validity(handler, installed, app_version, host_api, platform) {
                Ok(()) => true,
                Err(reason) => {
                    report.removed_type_defaults.push((
                        format_id.clone(),
                        SkippedCandidate {
                            handler: handler.clone(),
                            reason,
                        },
                    ));
                    false
                }
            }
        });

        self.file_overrides.retain(|resource_id, handler| {
            match stored_handler_validity(handler, installed, app_version, host_api, platform) {
                Ok(()) => true,
                Err(reason) => {
                    report.removed_file_overrides.push((
                        resource_id.clone(),
                        SkippedCandidate {
                            handler: handler.clone(),
                            reason,
                        },
                    ));
                    false
                }
            }
        });

        report
    }

    /// Removes preferences referencing a specific uninstalled plugin.
    pub fn invalidate_plugin(&mut self, plugin_id: &str) -> InvalidationReport {
        let mut report = InvalidationReport::default();
        self.file_type_defaults.retain(|format_id, handler| {
            if handler
                .plugin_parts()
                .is_some_and(|(pid, _)| pid == plugin_id)
            {
                report.removed_type_defaults.push((
                    format_id.clone(),
                    SkippedCandidate {
                        handler: handler.clone(),
                        reason: UnavailableReason::NotInstalled,
                    },
                ));
                false
            } else {
                true
            }
        });
        self.file_overrides.retain(|resource_id, handler| {
            if handler
                .plugin_parts()
                .is_some_and(|(pid, _)| pid == plugin_id)
            {
                report.removed_file_overrides.push((
                    resource_id.clone(),
                    SkippedCandidate {
                        handler: handler.clone(),
                        reason: UnavailableReason::NotInstalled,
                    },
                ));
                false
            } else {
                true
            }
        });
        report
    }
}

fn stored_handler_validity(
    handler: &HandlerId,
    installed: &[PluginManifest],
    app_version: &str,
    host_api: u32,
    platform: Platform,
) -> Result<(), UnavailableReason> {
    match handler {
        HandlerId::Builtin(id) => {
            if registry::manifest().definition(id).is_some() {
                Ok(())
            } else {
                Err(UnavailableReason::NotFound)
            }
        }
        HandlerId::App(_) => Ok(()),
        HandlerId::Plugin {
            plugin_id,
            handler_id,
        } => {
            let Some(plugin) = installed.iter().find(|p| p.id == *plugin_id) else {
                return Err(UnavailableReason::NotInstalled);
            };
            plugin.check_compatibility(app_version, host_api, platform)?;
            if plugin.handlers.iter().any(|h| h.id == *handler_id) {
                Ok(())
            } else {
                Err(UnavailableReason::NotFound)
            }
        }
    }
}

/// Resiliently parses a JSON map of `key -> HandlerId`, skipping malformed
/// entries so corrupted metadata never drops unrelated preferences.
pub fn parse_handler_map_json(value: &serde_json::Value) -> BTreeMap<String, HandlerId> {
    let Some(map) = value.as_object() else {
        return BTreeMap::new();
    };
    let mut parsed = BTreeMap::new();
    for (key, raw_handler) in map {
        if key.trim().is_empty() {
            continue;
        }
        if let Some(raw_str) = raw_handler.as_str()
            && let Ok(handler) = HandlerId::from_str(raw_str)
        {
            parsed.insert(key.clone(), handler);
        }
    }
    parsed
}

/// Serializes a `key -> HandlerId` map to a JSON object with canonical string
/// handler IDs.
pub fn serialize_handler_map_json(map: &BTreeMap<String, HandlerId>) -> serde_json::Value {
    let mut object = serde_json::Map::with_capacity(map.len());
    for (key, handler) in map {
        object.insert(key.clone(), serde_json::Value::String(handler.to_string()));
    }
    serde_json::Value::Object(object)
}

/// Rebases any `fileOverrides` entries whose resource key matches `old_key`.
pub fn rebase_override_map(
    overrides: &mut FileOverrides,
    old_key: &str,
    new_key: impl Into<String>,
) -> bool {
    let Some(handler) = overrides.remove(old_key) else {
        return false;
    };
    overrides.insert(new_key.into(), handler);
    true
}
