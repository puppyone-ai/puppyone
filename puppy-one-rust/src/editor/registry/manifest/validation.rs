//! Validation order and diagnostics of the shared TS preset manifest parser.
use serde_json::Value;
use std::collections::HashSet;

const SAFE_INTEGER: u64 = (1_u64 << 53) - 1;
const DEFINITION_KEYS: &[&str] = &[
    "id",
    "formatViewerIds",
    "capability",
    "source",
    "runtime",
    "surfaceIsolation",
    "computeIsolation",
    "contentSandbox",
    "resourcePolicy",
    "recoveryPolicy",
    "surfacePreparation",
    "readinessSignal",
    "surfaceFamily",
    "surfaceTraits",
];
const RESOURCE_KEYS: &[&str] = &[
    "memoryClass",
    "maxSourceBytes",
    "maxCanvasPixels",
    "maxActiveCanvases",
    "maxWorkers",
];
fn object(value: &Value, keys: &[&str], label: &str) -> Result<(), String> {
    let map = value
        .as_object()
        .ok_or_else(|| format!("{label} must be an object."))?;
    let unknown: Vec<_> = map
        .keys()
        .filter(|key| !keys.contains(&key.as_str()))
        .cloned()
        .collect();
    if !unknown.is_empty() {
        return Err(format!(
            "{label} has unknown field(s): {}.",
            unknown.join(", ")
        ));
    }
    Ok(())
}
fn id(value: &Value) -> bool {
    value.as_str().is_some_and(|id| {
        id.starts_with(|c: char| c.is_ascii_lowercase())
            && id.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            })
    })
}
fn integer(value: &Value) -> Option<u64> {
    if let Some(number) = value.as_u64() {
        return (number <= SAFE_INTEGER).then_some(number);
    }
    let number = value.as_f64()?;
    (number.is_finite() && number >= 0. && number <= SAFE_INTEGER as f64 && number.fract() == 0.)
        .then_some(number as u64)
}
fn unique_list(
    value: &Value,
    allowed: impl Fn(&Value) -> bool,
    message: String,
) -> Result<(), String> {
    let Some(values) = value.as_array() else {
        return Err(message);
    };
    let mut seen = HashSet::new();
    if values
        .iter()
        .any(|v| !allowed(v) || !seen.insert(v.as_str()))
    {
        return Err(message);
    }
    Ok(())
}
fn enums(value: &Value, fields: &[(&str, &[&str], &str)]) -> Result<(), String> {
    for (key, allowed, label) in fields {
        if !value[key].as_str().is_some_and(|s| allowed.contains(&s)) {
            return Err(format!(
                "Preset viewer {} has an unsupported {label}.",
                value["id"].as_str().unwrap()
            ));
        }
    }
    Ok(())
}
macro_rules! reject {
    ($condition:expr, $($message:tt)*) => {
        if $condition { return Err(format!($($message)*)); }
    };
}
fn definition(value: &Value, index: usize) -> Result<(), String> {
    let label = format!("Preset viewer definition at index {index}");
    object(value, DEFINITION_KEYS, &label)?;
    reject!(!id(&value["id"]), "{label} has an invalid id.");
    let id = value["id"].as_str().unwrap();
    unique_list(
        &value["formatViewerIds"],
        self::id,
        format!("Preset viewer {id} has invalid or repeated format viewer ids."),
    )?;
    enums(
        value,
        &[
            (
                "capability",
                &["edit", "preview", "placeholder"],
                "capability",
            ),
            (
                "source",
                &[
                    "content",
                    "resource",
                    "resource-session",
                    "content-and-resource",
                    "none",
                ],
                "source requirement",
            ),
            ("runtime", &["eager", "lazy"], "runtime boundary"),
            (
                "surfaceIsolation",
                &["inline", "isolated-webcontents"],
                "surface isolation boundary",
            ),
            (
                "computeIsolation",
                &["main-thread", "worker", "browser-engine", "native-process"],
                "compute isolation boundary",
            ),
            (
                "contentSandbox",
                &["none", "sandboxed-frame"],
                "content sandbox boundary",
            ),
        ],
    )?;
    let resource = &value["resourcePolicy"];
    let label = format!("Preset viewer {id} resource policy");
    object(resource, RESOURCE_KEYS, &label)?;
    reject!(
        !resource["memoryClass"]
            .as_str()
            .is_some_and(|s| ["small", "medium", "large"].contains(&s)),
        "{label} has an unsupported memory class."
    );
    for key in &RESOURCE_KEYS[1..] {
        reject!(
            integer(&resource[key]).is_none(),
            "{label} {key} must be a non-negative safe integer."
        );
    }
    let recovery = &value["recoveryPolicy"];
    let label = format!("Preset viewer {id} recovery policy");
    object(
        recovery,
        &["maxAutomaticRetries", "supportsSafeMode"],
        &label,
    )?;
    reject!(
        !integer(&recovery["maxAutomaticRetries"]).is_some_and(|n| n <= 1),
        "{label} maxAutomaticRetries must be zero or one."
    );
    reject!(
        !recovery["supportsSafeMode"].is_boolean(),
        "{label} supportsSafeMode must be a boolean."
    );
    enums(
        value,
        &[
            (
                "surfacePreparation",
                &["hidden-safe", "requires-visible"],
                "surface preparation policy",
            ),
            (
                "readinessSignal",
                &[
                    "dom-stable",
                    "decoded-resource",
                    "frame-paint",
                    "first-rendered-frame",
                    "media-metadata",
                ],
                "readiness signal",
            ),
            (
                "surfaceFamily",
                &[
                    "document", "code", "grid", "canvas", "media", "embedded", "fallback",
                ],
                "surface family",
            ),
        ],
    )?;
    unique_list(
        &value["surfaceTraits"],
        |v| {
            v.as_str().is_some_and(|s| {
                [
                    "rich-text",
                    "monospace",
                    "tabular",
                    "scrollable",
                    "zoomable",
                    "paginated",
                    "sandboxed",
                ]
                .contains(&s)
            })
        },
        format!("Preset viewer {id} has unsupported or repeated surface traits."),
    )?;
    let capability = value["capability"].as_str().unwrap();
    let source = value["source"].as_str().unwrap();
    let compute = value["computeIsolation"].as_str().unwrap();
    let runtime = value["runtime"].as_str().unwrap();
    let isolation = value["surfaceIsolation"].as_str().unwrap();
    let budget = |key: &str| integer(&resource[key]).unwrap();
    reject!(
        capability == "edit" && source == "none",
        "Editable preset viewer {id} must receive content or a resource."
    );
    reject!(
        capability == "preview" && source == "none",
        "Preview preset viewer {id} must declare a content or resource source."
    );
    reject!(
        capability == "placeholder" && source != "none",
        "Placeholder preset viewer {id} must use source 'none'."
    );
    reject!(
        source == "none" && budget("maxSourceBytes") != 0,
        "Metadata-only preset viewer {id} cannot declare a source byte budget."
    );
    reject!(
        source != "none" && budget("maxSourceBytes") == 0,
        "Preset viewer {id} must declare a positive source byte budget."
    );
    reject!(
        compute == "worker" && budget("maxWorkers") == 0,
        "Worker-compute preset viewer {id} must declare at least one worker."
    );
    reject!(
        compute == "main-thread" && budget("maxWorkers") != 0,
        "Main-thread preset viewer {id} cannot declare worker capacity."
    );
    if compute == "browser-engine" {
        reject!(
            source != "resource" || runtime != "eager",
            "Browser-engine preset viewer {id} must eagerly navigate to a resource."
        );
        reject!(
            ["maxWorkers", "maxCanvasPixels", "maxActiveCanvases"]
                .iter()
                .any(|key| budget(key) != 0),
            "Browser-engine preset viewer {id} cannot declare app-owned worker or Canvas budgets."
        );
    }
    reject!(
        compute == "worker" && runtime != "lazy",
        "Worker-compute preset viewer {id} must keep its runtime lazy."
    );
    if source == "resource-session" || compute == "native-process" {
        reject!(
            source != "resource-session"
                || compute != "native-process"
                || capability != "preview"
                || runtime != "lazy"
                || isolation != "inline"
                || ["maxWorkers", "maxCanvasPixels", "maxActiveCanvases"]
                    .iter()
                    .any(|key| budget(key) != 0),
            "Native-session preset viewer {id} must be a lazy, inline, read-only DOM surface."
        );
    }
    let sandboxed = value["surfaceTraits"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == "sandboxed");
    reject!(
        value["contentSandbox"] == "sandboxed-frame" && !sandboxed,
        "Sandboxed-frame preset viewer {id} must declare the sandboxed trait."
    );
    reject!(
        value["contentSandbox"] == "none" && sandboxed,
        "Preset viewer {id} cannot claim a sandboxed trait without a sandbox boundary."
    );
    reject!(
        recovery["supportsSafeMode"] == true && isolation != "isolated-webcontents",
        "Safe-mode preset viewer {id} must use an isolated surface."
    );
    let paginated = value["surfaceTraits"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v == "paginated");
    reject!(
        compute != "browser-engine"
            && (value["surfaceFamily"] == "canvas"
                || (value["surfaceFamily"] != "grid" && paginated))
            && (budget("maxCanvasPixels") == 0 || budget("maxActiveCanvases") == 0),
        "Canvas or paginated preset viewer {id} must declare positive Canvas limits."
    );
    Ok(())
}

pub(super) fn validate(value: &Value) -> Result<(), String> {
    object(
        value,
        &["contractVersion", "fallbackViewerId", "viewers"],
        "Preset viewer manifest",
    )?;
    reject!(
        integer(&value["contractVersion"]) != Some(super::CONTRACT_VERSION as u64),
        "Preset viewer manifest uses an unsupported contract version."
    );
    reject!(
        !id(&value["fallbackViewerId"]),
        "Preset viewer manifest has an invalid fallback viewer id."
    );
    let Some(viewers) = value["viewers"].as_array().filter(|v| !v.is_empty()) else {
        return Err("Preset viewer manifest must declare at least one viewer.".into());
    };
    let (mut canonical, mut all) = (HashSet::new(), HashSet::new());
    for (index, viewer) in viewers.iter().enumerate() {
        definition(viewer, index)?;
        let id = viewer["id"].as_str().unwrap();
        reject!(
            !canonical.insert(id),
            "Preset viewer manifest declares {id} more than once."
        );
        for id in std::iter::once(id).chain(
            viewer["formatViewerIds"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap()),
        ) {
            reject!(
                !all.insert(id),
                "Core viewer id {id} maps to more than one preset viewer."
            );
        }
    }
    reject!(
        !viewers.iter().any(|v| v["id"] == value["fallbackViewerId"]
            && v["capability"] == "placeholder"
            && v["source"] == "none"),
        "Preset viewer fallback must be a declared placeholder with source 'none'."
    );
    reject!(
        viewers
            .iter()
            .filter(|v| v["capability"] == "placeholder")
            .count()
            != 1,
        "Preset viewer manifest must declare exactly one placeholder fallback."
    );
    Ok(())
}

/// JSON numbers such as 8.0 are integers in the JS contract too.
pub(super) fn normalize_numbers(value: &mut Value) {
    value["contractVersion"] = super::CONTRACT_VERSION.into();
    for viewer in value["viewers"].as_array_mut().unwrap() {
        for key in &RESOURCE_KEYS[1..] {
            viewer["resourcePolicy"][key] = integer(&viewer["resourcePolicy"][key]).unwrap().into();
        }
        viewer["recoveryPolicy"]["maxAutomaticRetries"] =
            integer(&viewer["recoveryPolicy"]["maxAutomaticRetries"])
                .unwrap()
                .into();
    }
}
