import { desktopCapturer, systemPreferences } from "electron";

export function canCaptureNativeWindow() {
  return process.platform !== "darwin" || systemPreferences.getMediaAccessStatus("screen") === "granted";
}

/** Page.captureScreenshot/capturePage omit sibling WebContentsViews. */
export async function captureNativeWindow(window) {
  const [width, height] = window.getSize();
  const id = window.getMediaSourceId().split(":")[1];
  const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: width * 2, height: height * 2 } });
  const image = sources.find(source => source.id.split(":")[1] === id)?.thumbnail;
  if (!image || image.isEmpty()) throw new Error("Native window capture is unavailable; page-only screenshots cannot replace it.");
  return image;
}

/** A small, noninteractive paint sentinel makes a missing child in a capture detectable. */
export async function markNativeSurface(contents, selector = "body") {
  const point = await contents.executeJavaScript(`(() => {
    const target=document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error("Paint target is missing");
    const marker=document.createElement('div');marker.dataset.visibilityMarker='true';
    marker.style.cssText='position:absolute;left:12px;top:12px;width:32px;height:32px;background:rgb(255,0,160);z-index:2147483647;pointer-events:none';
    target.append(marker);
    const r=marker.getBoundingClientRect();return {x:r.x+16,y:r.y+16};
  })()`);
  await contents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const image = await contents.capturePage();
  const width = await contents.executeJavaScript("innerWidth");
  const scale = image.getSize().width / width;
  const sample = image.crop({ x: Math.round(point.x * scale), y: Math.round(point.y * scale), width: 1, height: 1 }).toBitmap();
  if (!(sample[2] > 180 && sample[1] < 100 && sample[0] > 70)) throw new Error("Native paint marker did not render; no positive visual control is available.");
  return Array.from(sample.subarray(0, 3)); // NativeImage bitmap channels, including platform color management.
}

export function countMarkerPixels(image, color) {
  const bitmap = image.toBitmap();
  let count = 0;
  for (let index = 0; index < bitmap.length; index += 4) {
    if (color.every((value, channel) => Math.abs(value - bitmap[index + channel]) <= 3)) count++;
  }
  return count;
}

/** Compare actual composited Editor pixels with its own page after children leave. */
export async function compareEditorRegion(window, composite) {
  const region = await window.webContents.executeJavaScript(`(() => {
    const r=document.querySelector('.desktop-editor-pane').getBoundingClientRect();
    return {x:Math.ceil(r.x+24),y:Math.ceil(r.y+40),width:Math.floor(r.width-48),height:Math.floor(r.height-64)};
  })()`);
  if (region.width < 40 || region.height < 40) throw new Error("No meaningful Editor region is available for pixel comparison");
  const page = await window.webContents.capturePage();
  const outer = window.getBounds(), content = window.getContentBounds();
  const crop = (image, scale, dx = 0, dy = 0) => image.crop({
    x: Math.round((region.x + dx) * scale), y: Math.round((region.y + dy) * scale),
    width: Math.round(region.width * scale), height: Math.round(region.height * scale),
  }).resize({ width: region.width, height: region.height, quality: "good" });
  const expected = crop(page, page.getSize().width / content.width);
  const actual = crop(composite, composite.getSize().width / outer.width, content.x - outer.x, content.y - outer.y);
  const a = actual.toBitmap(), b = expected.toBitmap();
  let mismatches = 0;
  for (let offset = 0; offset < a.length; offset += 4) {
    if ([0, 1, 2].some(channel => Math.abs(a[offset + channel] - b[offset + channel]) > 30)) mismatches++;
  }
  return { region, mismatchRatio: mismatches / (a.length / 4), actual, expected };
}
