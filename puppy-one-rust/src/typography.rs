//! Three product text presets; no editor content, window or storage dependency.
//! Metrics mirror `TYPOGRAPHY_SCALE_METRICS` in `src/features/typography/fontCatalog.ts`.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scale {
    Small,
    #[default]
    Medium,
    Large,
}

/// Application-chrome roles (`--po-type-ui-*`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct UiType {
    pub glyph: f32,
    pub micro: f32,
    pub caption: f32,
    pub hint: f32,
    pub meta: f32,
    pub label: f32,
    pub control: f32,
    pub body: f32,
    pub body_large: f32,
    pub section_title: f32,
    pub title: f32,
    pub heading: f32,
    pub page_title: f32,
    pub display: f32,
    pub hero: f32,
}
/// Left sidebar (`--po-type-left-sidebar-*`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SidebarType {
    pub content: f32,
    pub meta: f32,
    pub line_height: f32,
}
/// Header (`--po-type-header-*`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HeaderType {
    pub content: f32,
    pub line_height: f32,
    pub meta: f32,
    pub meta_line_height: f32,
}
/// Editor content (`--po-type-editor-*`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EditorType {
    pub content: f32,
    pub line_height: f32,
    pub data: f32,
    pub code: f32,
    pub headings: [f32; 6],
}
/// Right sidebar: Agent conversation, controls and terminal (`--po-type-right-sidebar-*`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RightType {
    pub content: f32,
    pub control_line_height: f32,
    pub meta: f32,
    pub meta_line_height: f32,
    pub caption: f32,
    pub caption_line_height: f32,
    pub micro: f32,
    pub micro_line_height: f32,
    pub code: f32,
    pub terminal: f32,
    pub heading1: f32,
    pub heading2: f32,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metrics {
    /// `--po-control-size`; all compact/small/large control variants derive from it.
    pub control_size: f32,
    pub ui: UiType,
    pub left: SidebarType,
    pub header: HeaderType,
    pub editor: EditorType,
    pub right: RightType,
}

const SMALL: Metrics = Metrics {
    control_size: 30.,
    ui: UiType {
        glyph: 8.,
        micro: 10.,
        caption: 11.,
        hint: 12.,
        meta: 12.,
        label: 13.,
        control: 13.,
        body: 13.,
        body_large: 14.,
        section_title: 15.,
        title: 16.,
        heading: 18.,
        page_title: 20.,
        display: 24.,
        hero: 28.,
    },
    left: SidebarType {
        content: 13.,
        meta: 11.,
        line_height: 18.,
    },
    header: HeaderType {
        content: 13.,
        line_height: 18.,
        meta: 12.,
        meta_line_height: 17.,
    },
    editor: EditorType {
        content: 14.,
        line_height: 28.,
        data: 12.,
        code: 12.,
        headings: [21., 18., 16., 15., 14., 14.],
    },
    right: RightType {
        content: 13.,
        control_line_height: 18.,
        meta: 12.,
        meta_line_height: 18.,
        caption: 11.,
        caption_line_height: 16.,
        micro: 10.,
        micro_line_height: 14.,
        code: 12.,
        terminal: 12.,
        heading1: 19.,
        heading2: 15.,
    },
};
const MEDIUM: Metrics = Metrics {
    control_size: 32.,
    ui: UiType {
        glyph: 8.,
        micro: 11.,
        caption: 12.,
        hint: 13.,
        meta: 13.,
        label: 14.,
        control: 14.,
        body: 14.,
        body_large: 15.,
        section_title: 16.,
        title: 17.,
        heading: 19.,
        page_title: 21.,
        display: 25.,
        hero: 29.,
    },
    left: SidebarType {
        content: 14.,
        meta: 12.,
        line_height: 19.,
    },
    header: HeaderType {
        content: 14.,
        line_height: 19.,
        meta: 13.,
        meta_line_height: 18.,
    },
    editor: EditorType {
        content: 15.,
        line_height: 30.,
        data: 13.,
        code: 13.,
        headings: [22., 19., 17., 16., 15., 15.],
    },
    right: RightType {
        content: 14.,
        control_line_height: 19.,
        meta: 13.,
        meta_line_height: 19.,
        caption: 12.,
        caption_line_height: 17.,
        micro: 11.,
        micro_line_height: 15.,
        code: 13.,
        terminal: 13.,
        heading1: 20.,
        heading2: 16.,
    },
};
const LARGE: Metrics = Metrics {
    control_size: 34.,
    ui: UiType {
        glyph: 8.,
        micro: 12.,
        caption: 13.,
        hint: 14.,
        meta: 14.,
        label: 16.,
        control: 16.,
        body: 16.,
        body_large: 16.,
        section_title: 18.,
        title: 19.,
        heading: 21.,
        page_title: 23.,
        display: 27.,
        hero: 31.,
    },
    left: SidebarType {
        content: 16.,
        meta: 14.,
        line_height: 21.,
    },
    header: HeaderType {
        content: 16.,
        line_height: 21.,
        meta: 14.,
        meta_line_height: 19.,
    },
    editor: EditorType {
        content: 16.,
        line_height: 32.,
        data: 14.,
        code: 14.,
        headings: [24., 20., 18., 17., 16., 16.],
    },
    right: RightType {
        content: 16.,
        control_line_height: 21.,
        meta: 14.,
        meta_line_height: 20.,
        caption: 13.,
        caption_line_height: 18.,
        micro: 12.,
        micro_line_height: 16.,
        code: 14.,
        terminal: 14.,
        heading1: 23.,
        heading2: 18.,
    },
};

impl Scale {
    pub fn delta(self) -> f32 {
        match self {
            Self::Small => -1.,
            Self::Medium => 0.,
            Self::Large => 1.,
        }
    }
    pub fn label_key(self) -> &'static str {
        match self {
            Self::Small => "settings.typography.textSize.scale.small",
            Self::Medium => "settings.typography.textSize.scale.medium",
            Self::Large => "settings.typography.textSize.scale.large",
        }
    }
    pub fn metrics(self) -> &'static Metrics {
        match self {
            Self::Small => &SMALL,
            Self::Medium => &MEDIUM,
            Self::Large => &LARGE,
        }
    }
    /// Re-scale a size authored against the Medium preset. Sizes that name a
    /// Medium UI/editor role follow that role's table entry; any other literal
    /// keeps the preset's step so ad hoc sizes still move with the user scale.
    pub fn scale_medium(self, medium: f32) -> f32 {
        if self == Self::Medium {
            return medium;
        }
        let from = MEDIUM;
        let to = self.metrics();
        let pairs = [
            (from.ui.micro, to.ui.micro),
            (from.ui.caption, to.ui.caption),
            (from.ui.meta, to.ui.meta),
            (from.ui.label, to.ui.label),
            (from.ui.body_large, to.ui.body_large),
            (from.ui.section_title, to.ui.section_title),
            (from.ui.title, to.ui.title),
            (from.ui.heading, to.ui.heading),
            (from.ui.page_title, to.ui.page_title),
            (from.ui.display, to.ui.display),
            (from.ui.hero, to.ui.hero),
            (from.editor.headings[1], to.editor.headings[1]),
            (from.editor.headings[0], to.editor.headings[0]),
        ];
        pairs
            .iter()
            .find(|(m, _)| (*m - medium).abs() < 0.01)
            .map(|(_, v)| *v)
            .unwrap_or(medium + self.delta())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn medium_literals_follow_the_product_role_table() {
        assert_eq!(Scale::Medium.scale_medium(14.), 14.);
        assert_eq!(Scale::Large.scale_medium(14.), 16.);
        assert_eq!(Scale::Small.scale_medium(14.), 13.);
        assert_eq!(Scale::Large.scale_medium(21.), 23.);
        assert_eq!(Scale::Small.scale_medium(9.), 8.);
        assert_eq!(Scale::Large.metrics().control_size, 34.);
    }
}
