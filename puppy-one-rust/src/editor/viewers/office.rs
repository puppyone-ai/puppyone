//! `OfficeViewer` (`viewers/office`): the same browser renderers the product
//! uses — docx-preview (Word), @aiden0z/pptx-renderer (PowerPoint) and
//! SheetJS (spreadsheets) — running in the system web engine over the file's
//! bytes. RTF, legacy .doc and OpenDocument text go through macOS
//! `textutil` to HTML. Content is the renderer's (close, not pixels); the
//! loading, failure and size states are the product's. Budget: 25 MiB.
use super::web::WebFrame;
use crate::{
    editor::registry::{SurfaceInput, SurfaceRequest, ViewerSurface},
    localization::{t, tf},
    platform::webview::{Content, Entry, url_for},
    theme,
    ui::appearance::ActiveAppearance,
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use std::path::{Path, PathBuf};

/// `office-preview` resourcePolicy.maxSourceBytes.
pub const BUDGET: u64 = 25 * 1024 * 1024;
const DOCX: &[u8] = include_bytes!("../../../assets/web/vendor/docx-preview.min.js");
const JSZIP: &[u8] = include_bytes!("../../../assets/web/vendor/jszip.min.js");
const PPTX: &[u8] = include_bytes!("../../../assets/web/vendor/pptx-renderer.js");
const XLSX: &[u8] = include_bytes!("../../../assets/web/vendor/xlsx.full.min.js");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    Word,
    Slides,
    Sheet,
    /// RTF, .doc, .odt: converted to HTML by the platform.
    Converted,
    /// .odp, .ppt: no renderer here.
    Unsupported,
}
pub fn family(name: &str) -> Family {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "docx" => Family::Word,
        "pptx" | "ppsx" => Family::Slides,
        "xlsx" | "xlsm" | "xlsb" | "xls" | "ods" | "ots" => Family::Sheet,
        "rtf" | "doc" | "odt" | "ott" => Family::Converted,
        _ => Family::Unsupported,
    }
}

fn page(family: Family, src: &str, background: &str, text: &str, muted: &str) -> String {
    let style = format!(
        "html,body{{margin:0;min-height:100%;background:{background};color:{text};font:13px -apple-system,system-ui,sans-serif}}\
         #status{{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:{muted}}}\
         #host{{padding:16px;box-sizing:border-box}}\
         table{{border-collapse:collapse}}td,th{{border:1px solid {muted};padding:2px 6px;white-space:nowrap}}\
         .sheets{{display:flex;gap:6px;padding:8px 16px;position:sticky;top:0;background:{background}}}\
         .sheets button{{border:1px solid {muted};background:none;color:{text};border-radius:4px;padding:2px 8px}}\
         .sheets button[aria-pressed=true]{{font-weight:600}}"
    );
    let script = match family {
        Family::Word => format!(
            r#"<script src="__assets__/jszip.min.js"></script><script src="__assets__/docx-preview.min.js"></script>
<script>fetch("{src}").then(r=>{{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}}).then(b=>docx.renderAsync(b,document.getElementById("host"),undefined,{{
renderAltChunks:false,ignoreLastRenderedPageBreak:false,renderHeaders:true,renderFooters:true,renderFootnotes:true,renderEndnotes:true,
renderComments:false,renderChanges:false,breakPages:true,ignoreWidth:false,ignoreHeight:false,ignoreFonts:false,useBase64URL:true,inWrapper:true,experimental:true}}))
.then(()=>document.getElementById("status").remove()).catch(e=>document.getElementById("status").textContent=FAILED)</script>"#
        ),
        Family::Slides => format!(
            r#"<script type="module">import {{PptxViewer,RECOMMENDED_ZIP_LIMITS}} from "./__assets__/pptx-renderer.js";
fetch("{src}").then(r=>{{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}}).then(b=>PptxViewer.open(b,document.getElementById("host"),{{
fitMode:"width",lazyMedia:true,lazySlides:true,pdfjs:false,renderMode:"list",zipLimits:RECOMMENDED_ZIP_LIMITS}}))
.then(()=>document.getElementById("status").remove()).catch(e=>document.getElementById("status").textContent=FAILED)</script>"#
        ),
        Family::Sheet => format!(
            r#"<script src="__assets__/xlsx.full.min.js"></script>
<script>fetch("{src}").then(r=>{{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}}).then(b=>{{
const wb=XLSX.read(b,{{type:"array",cellStyles:true,sheetRows:5000}});const host=document.getElementById("host");
const bar=document.createElement("div");bar.className="sheets";document.body.insertBefore(bar,host);
const show=n=>{{host.innerHTML=XLSX.utils.sheet_to_html(wb.Sheets[n],{{header:"",footer:""}});
[...bar.children].forEach(c=>c.setAttribute("aria-pressed",c.textContent===n))}};
wb.SheetNames.forEach(n=>{{const x=document.createElement("button");x.textContent=n;x.onclick=()=>show(n);bar.appendChild(x)}});
show(wb.SheetNames[0]);document.getElementById("status").remove()}}).catch(e=>document.getElementById("status").textContent=FAILED)</script>"#
        ),
        Family::Converted | Family::Unsupported => String::new(),
    };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><style>{style}</style><script>const FAILED=__FAILED__;</script></head>
<body><div id="status">__LOADING__</div><div id="host"></div>{script}</body></html>"#
    )
}

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let name = request.name.to_owned();
    let p = cx.palette();
    let colors = (
        theme::css_hex(p.canvas),
        theme::css_hex(p.text),
        theme::css_hex(p.subtle),
    );
    let view = cx.new(|cx| {
        let mut view = OfficeView {
            name,
            frame: None,
            failure: None,
            _temporary: None,
        };
        view.load(resource, colors, cx);
        view
    });
    Box::new(OfficeSurface { view })
}

struct OfficeSurface {
    view: Entity<OfficeView>,
}
impl ViewerSurface for OfficeSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
}
struct OfficeView {
    name: String,
    frame: Option<Entity<WebFrame>>,
    failure: Option<String>,
    _temporary: Option<tempfile::TempDir>,
}
impl OfficeView {
    fn load(
        &mut self,
        resource: Option<PreviewResource>,
        (background, text, muted): (String, String, String),
        cx: &mut Context<Self>,
    ) {
        // `office.loadFailed`: the product's Office failure copy.
        let unavailable = || t("editor.office.loadFailed").to_owned();
        let family = family(&self.name);
        if family == Family::Unsupported {
            self.failure = Some(unavailable());
            return;
        }
        let (folder, file) = match resource.as_ref().and_then(|r| r.data().ok()) {
            Some(PreviewData::LocalFile(path)) => {
                let size = path.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
                if size > BUDGET {
                    self.failure = Some(tf(
                        "editor.unavailable.resourceLimit",
                        &[("limit", "25 MB".into())],
                    ));
                    return;
                }
                match (path.parent(), path.file_name()) {
                    (Some(dir), Some(file)) => {
                        (dir.to_path_buf(), file.to_string_lossy().into_owned())
                    }
                    _ => {
                        self.failure = Some(unavailable());
                        return;
                    }
                }
            }
            Some(PreviewData::Bytes { bytes, .. }) if bytes.len() as u64 <= BUDGET => {
                let Ok(dir) = tempfile::tempdir() else {
                    self.failure = Some(unavailable());
                    return;
                };
                let file = Path::new(&self.name)
                    .file_name()
                    .map(|f| f.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "document".into());
                if crate::platform::webview::write_private(&dir.path().join(&file), bytes).is_err()
                {
                    self.failure = Some(unavailable());
                    return;
                }
                let folder = dir.path().to_path_buf();
                self._temporary = Some(dir);
                (folder, file)
            }
            _ => {
                self.failure = Some(unavailable());
                return;
            }
        };
        let html = if family == Family::Converted {
            match crate::platform::office::convert_to_html(&folder.join(&file), BUDGET) {
                Ok(html) => html,
                Err(_) => {
                    self.failure = Some(unavailable());
                    return;
                }
            }
        } else {
            page(family, &url_for(&file), &background, &text, &muted)
                .replace(
                    "__FAILED__",
                    &serde_json::to_string(&unavailable()).unwrap_or_default(),
                )
                .replace("__LOADING__", t("editor.preview.loading"))
        };
        let content = Content {
            root: Some(PathBuf::from(&folder)),
            entry: Entry::Html(html),
            max_bytes: BUDGET,
            assets: vec![
                ("docx-preview.min.js", DOCX),
                ("jszip.min.js", JSZIP),
                ("pptx-renderer.js", PPTX),
                ("xlsx.full.min.js", XLSX),
            ],
        };
        self.frame = Some(cx.new(|_| WebFrame::new(Some(content), false)));
    }
}
impl Render for OfficeView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        match (&self.frame, &self.failure) {
            (Some(frame), None) => div().size_full().child(frame.clone()).into_any_element(),
            (_, failure) => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .p(px(24.))
                .bg(p.canvas)
                .text_size(px(theme::ty().ui.meta))
                .text_color(p.danger)
                .child(failure.clone().unwrap_or_default())
                .into_any_element(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn families_route_to_their_renderers() {
        assert_eq!(family("a.DOCX"), Family::Word);
        assert_eq!(family("deck.pptx"), Family::Slides);
        for sheet in ["a.xlsx", "a.xls", "a.ods"] {
            assert_eq!(family(sheet), Family::Sheet);
        }
        assert_eq!(family("a.rtf"), Family::Converted);
        assert_eq!(family("a.odp"), Family::Unsupported);
        let html = page(
            Family::Word,
            "puppyone-preview://local/a.docx",
            "BG",
            "FG",
            "MUTED",
        );
        assert!(html.contains("docx.renderAsync") && html.contains("__assets__/jszip.min.js"));
        assert!(page(Family::Slides, "x", "BG", "FG", "M").contains("PptxViewer.open"));
        assert!(page(Family::Sheet, "x", "BG", "FG", "M").contains("sheet_to_html"));
    }
}
