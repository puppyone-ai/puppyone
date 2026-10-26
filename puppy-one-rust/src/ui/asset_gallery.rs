//! Developer-only registry board shared with the real React reference.
use super::{
    appearance::ActiveAppearance,
    components::{FileIcon, Icon, ProductIcon},
    loading::{self, LoaderSize, LoadingMark, LoadingStyle, Tone},
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;
use serde::Deserialize;
#[derive(Deserialize)]
struct Board {
    items: Vec<Item>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: String,
    kind: String,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    #[serde(default)]
    name: String,
    #[serde(default)]
    node_type: String,
    #[serde(default)]
    theme: String,
    #[serde(default)]
    ink: String,
    #[serde(default)]
    size: serde_json::Value,
    #[serde(default)]
    stroke: f32,
    #[serde(default)]
    style: LoadingStyle,
    #[serde(default)]
    layout: String,
    #[serde(default)]
    tone: Tone,
    #[serde(default)]
    shapes: Vec<loading::model::Shape>,
}
impl Item {
    fn file(&self) -> FileIcon {
        FileIcon::for_node(
            self.name.clone(),
            Some(self.node_type.clone().into()),
            None,
            self.theme.clone(),
        )
        .size_px(self.size.as_f64().unwrap() as f32)
    }
    fn ink(&self, cx: &App) -> Rgba {
        let t = cx.palette();
        match self.ink.as_str() {
            "text-muted" => t.muted,
            "accent" => t.accent,
            _ => t.text,
        }
    }
}
fn board() -> Board {
    serde_json::from_str(include_str!("../../fixtures/ui/asset-gallery.json")).unwrap()
}
pub struct AssetGallery;
impl AssetGallery {
    pub fn ready(window: &Window, cx: &mut App) -> bool {
        let mut ready = true;
        for item in board().items.into_iter().filter(|i| i.kind == "file") {
            let resource = item
                .file()
                .resource(window.scale_factor(), cx.palette(), item.ink(cx));
            match cx.fetch_asset::<ImgResourceLoader>(&resource) {
                Some(Ok(_)) => {}
                Some(Err(e)) => panic!("File glyph {} failed: {e}", item.id),
                None => ready = false,
            }
        }
        ready
    }
}
impl Render for AssetGallery {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .relative()
            .bg(cx.palette().canvas)
            .children(board().items.into_iter().map(|item| {
                let ink = item.ink(cx);
                let element: AnyElement = match item.kind.as_str() {
                    "icon" => Icon::product(
                        ProductIcon::ALL
                            .into_iter()
                            .find(|m| m.id() == item.name)
                            .expect("registered meaning"),
                    )
                    .stroke(item.stroke)
                    .with_size(px(item.size.as_f64().unwrap() as f32))
                    .color(ink)
                    .into_any_element(),
                    "file" => item.file().into_any_element(),
                    "mark" => {
                        let size = match item.size.as_str().unwrap() {
                            "xs" => LoaderSize::Xs,
                            "sm" => LoaderSize::Sm,
                            "md" => LoaderSize::Md,
                            _ => panic!("unknown loading size"),
                        };
                        let mark = LoadingMark::new(SharedString::from(item.id.clone()))
                            .size(size)
                            .loading_style(item.style)
                            .tone(item.tone);
                        if item.layout == "area" {
                            mark.area().into_any_element()
                        } else {
                            mark.into_any_element()
                        }
                    }
                    "placeholder" => loading::placeholder(
                        SharedString::from(item.id.clone()),
                        item.w,
                        item.h,
                        item.shapes,
                        item.style,
                    )
                    .into_any_element(),
                    other => panic!("Unknown registry fixture {other}"),
                };
                div()
                    .id(SharedString::from(item.id))
                    .absolute()
                    .left(px(item.x))
                    .top(px(item.y))
                    .w(px(item.w))
                    .h(px(item.h))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(ink)
                    .child(element)
            }))
    }
}
