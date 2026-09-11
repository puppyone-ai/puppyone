/** Blob URLs belong to a Renderer partition; only a bounded thumbnail crosses it. */
export async function createHostedReferencePreview(url: string): Promise<string | null> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Reference preview could not be decoded."));
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    image.src = url;
    await Promise.race([loaded, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Reference preview timed out.")), 3000);
    })]);
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL("image/webp", 0.75);
    return result.length <= 96 * 1024 ? result : null;
  } catch { return null; }
  finally { clearTimeout(timer); image.src = ""; image.onload = null; image.onerror = null; }
}
