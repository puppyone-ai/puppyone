//! Product-meaning registry and shared loading data; no brand-logo catalog.
//! Imported from executable TS registries, with per-input SHA-256 provenance.
use serde_json::Value;
use std::sync::OnceLock;

pub fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        let data: Value = serde_json::from_str(include_str!("../assets/ui-assets.json"))
            .expect("UI asset catalog");
        assert_eq!(
            ProductIcon::ALL.len(),
            data["icons"].as_object().unwrap().len()
        );
        for meaning in ProductIcon::ALL {
            assert!(data["icons"].get(meaning.id()).is_some());
        }
        data
    })
}

/// The seven meanings owned by TS PRODUCT_ICONS. Views request a meaning,
/// not a concrete Lucide drawing; source coverage is checked exhaustively.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProductIcon {
    Home,
    Folder,
    Local,
    Cloud,
    CloudUpload,
    CloudOff,
    Disclosure,
}
impl ProductIcon {
    pub const ALL: [Self; 7] = [
        Self::Home,
        Self::Folder,
        Self::Local,
        Self::Cloud,
        Self::CloudUpload,
        Self::CloudOff,
        Self::Disclosure,
    ];
    pub fn id(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::Folder => "folder",
            Self::Local => "local",
            Self::Cloud => "cloud",
            Self::CloudUpload => "cloud-upload",
            Self::CloudOff => "cloud-off",
            Self::Disclosure => "disclosure",
        }
    }
}

/// Compatibility names converge here, not in each page. Lucide drawings for
/// these meanings must never silently replace the product-owned drawing.
fn meaning(name: &str) -> Option<&str> {
    Some(match name {
        "house" | "house-compact" | "home" => "home",
        "folder" | "folder-closed" => "folder",
        "laptop" | "local" => "local",
        "cloud" => "cloud",
        "cloud-off" => "cloud-off",
        "cloud-upload" => "cloud-upload",
        "tree-disclosure" | "tree-disclosure-open" | "disclosure" => "disclosure",
        _ => name.strip_prefix("product-")?,
    })
}

pub fn is_disclosure(name: &str) -> bool {
    meaning(name) == Some("disclosure")
}

/// Product SVGs are templates so stroke overrides preserve Home's optical
/// weight and CloudOff's 3x cutout. Disclosure has a fixed physical stroke.
pub fn icon_svg(path: &str) -> Option<Vec<u8>> {
    let path = path.strip_prefix("icons/")?.strip_suffix(".svg")?;
    let (name, stroke) = match path.split_once('@') {
        Some((name, value)) => (name, value.parse::<f64>().ok()?),
        None => (
            path,
            if path.ends_with("-compact") {
                1.65
            } else {
                1.8
            },
        ),
    };
    if !stroke.is_finite() || stroke <= 0. {
        return None;
    }
    let icon = &data()["icons"][meaning(name)?];
    let scale = icon["strokeScale"].as_f64()?;
    let mut svg = icon["svg"]
        .as_str()?
        .replace("{stroke}", &format!("{:.3}", stroke * scale))
        .replace("{cutout}", &format!("{:.3}", stroke * 3.));
    if name == "tree-disclosure-open" {
        let start = svg.find('>')? + 1;
        svg.insert_str(start, "<g transform=\"rotate(90 12 12)\">");
        svg = svg.replace("</svg>", "</g></svg>");
    }
    Some(svg.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn product_registry_is_exhaustive_and_preserves_geometry() {
        assert_eq!(
            ProductIcon::ALL.len(),
            data()["icons"].as_object().unwrap().len()
        );
        for icon in ProductIcon::ALL {
            assert!(icon_svg(&format!("icons/product-{}.svg", icon.id())).is_some());
        }
        let home = String::from_utf8(icon_svg("icons/house@1.65.svg").unwrap()).unwrap();
        assert!(home.contains("stroke-width=\"1.815\""));
        let cloud = String::from_utf8(icon_svg("icons/cloud-off@1.7.svg").unwrap()).unwrap();
        assert!(cloud.contains("stroke-width=\"5.100\""));
        assert!(cloud.contains("stroke-width=\"1.700\""));
        assert!(icon_svg("icons/house@NaN.svg").is_none());
        assert!(icon_svg("icons/not-a-product-meaning.svg").is_none());
        assert_eq!(
            icon_svg("icons/folder.svg"),
            icon_svg("icons/folder-closed.svg")
        );
    }
}
