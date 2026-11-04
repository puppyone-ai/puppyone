//! Decoded Markdown images, shared by every pane: each source loads once,
//! off the foreground thread, and the windows redraw when it is ready.
//! (`img.decode()` before reveal: an image shows only once decoded.)
use super::source::Source;
use crate::editor::registry::DocumentAssets;
use gpui::{App, ImageFormat, RenderImage};
use std::{cell::RefCell, collections::HashMap, sync::Arc, time::Duration};

/// A remote image's budget (the product leaves it to Chromium; this keeps
/// a stray link from pulling an unbounded body).
const MAX_REMOTE_BYTES: usize = 32 * 1024 * 1024;
const REMOTE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone)]
pub enum State {
    Loading,
    /// Decoded, with its natural size in CSS pixels.
    Ready {
        image: Arc<RenderImage>,
        width: f32,
        height: f32,
    },
    Failed,
}

thread_local! {
    static CACHE: RefCell<HashMap<String, State>> = RefCell::new(HashMap::new());
}

/// The image at `key`, starting its load the first time it is asked for.
pub fn get(key: &str, source: &Source, assets: Option<&DocumentAssets>, cx: &mut App) -> State {
    if let Some(state) = CACHE.with(|c| c.borrow().get(key).cloned()) {
        return state;
    }
    CACHE.with(|c| c.borrow_mut().insert(key.to_owned(), State::Loading));
    let source = source.clone();
    let read = assets.map(|a| a.read.clone());
    let svg = cx.svg_renderer();
    let task = cx.background_executor().spawn(async move {
        let bytes = match &source {
            Source::Workspace(path) => read.and_then(|read| read(path)),
            Source::Remote(url) => fetch(url),
            Source::Data(bytes) => Some(bytes.clone()),
        }?;
        decode(bytes, &svg)
    });
    let key = key.to_owned();
    cx.spawn(async move |cx| {
        let state = task
            .await
            .map_or(State::Failed, |(image, width, height)| State::Ready {
                image,
                width,
                height,
            });
        CACHE.with(|c| c.borrow_mut().insert(key, state));
        cx.update(|cx| cx.refresh_windows());
    })
    .detach();
    State::Loading
}

/// SVG rasterises at this many device pixels per CSS pixel (Retina).
const SVG_SCALE: f32 = 2.;

fn format(bytes: &[u8]) -> Option<ImageFormat> {
    let head = &bytes[..bytes.len().min(512)];
    Some(match head {
        [0x89, b'P', b'N', b'G', ..] => ImageFormat::Png,
        [0xff, 0xd8, 0xff, ..] => ImageFormat::Jpeg,
        [b'G', b'I', b'F', b'8', ..] => ImageFormat::Gif,
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => ImageFormat::Webp,
        [b'B', b'M', ..] => ImageFormat::Bmp,
        [0, 0, 1, 0, ..] => ImageFormat::Ico,
        [b'I', b'I', 42, 0, ..] | [b'M', b'M', 0, 42, ..] => ImageFormat::Tiff,
        _ if String::from_utf8_lossy(head).contains("<svg") => ImageFormat::Svg,
        _ => return None,
    })
}

fn decode(bytes: Vec<u8>, svg: &gpui::SvgRenderer) -> Option<(Arc<RenderImage>, f32, f32)> {
    let format = format(&bytes)?;
    if format == ImageFormat::Svg {
        let image = svg.render_single_frame(&bytes, SVG_SCALE).ok()?;
        let size = image.size(0);
        return Some((
            image,
            size.width.0 as f32 / SVG_SCALE,
            size.height.0 as f32 / SVG_SCALE,
        ));
    }
    let image = gpui::Image::from_bytes(format, bytes)
        .to_image_data(svg.clone())
        .ok()?;
    let size = image.size(0);
    Some((image, size.width.0 as f32, size.height.0 as f32))
}

/// `https:` only, following at most five redirects that stay `https:`.
fn fetch(url: &str) -> Option<Vec<u8>> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()?;
    runtime.block_on(async {
        let client = reqwest::Client::builder()
            .redirect_policy(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 || attempt.url().scheme() != "https" {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .timeout(REMOTE_TIMEOUT)
            .build()
            .ok()?;
        let mut response = client.get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            body.extend_from_slice(&chunk);
            if body.len() > MAX_REMOTE_BYTES {
                return None;
            }
        }
        Some(body)
    })
}
