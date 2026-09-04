import fsp from "node:fs/promises";
import {
  buildProjectIconAssetUrl,
} from "./project-icon-protocol.mjs";
import {
  requireProjectEmoji,
  requireProjectIdentity,
} from "./project-appearance-store.mjs";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_EDGE = 8_192;
const NORMALIZED_ICON_EDGE = 256;

/** Application service around the local repository. A future cloud reconciler
 * can consume the repository's stable identity, content hash, and updatedAt
 * fields without changing the renderer contract or the on-disk asset format. */
export function createProjectAppearanceService({
  store,
  dialog,
  nativeImage,
  getDialogOwnerWindow,
} = {}) {
  if (!store?.list || !store?.setIcon || !store?.setEmoji || !store?.resetIcon) {
    throw new TypeError("Project appearance store is required.");
  }
  if (!dialog?.showOpenDialog) throw new TypeError("Electron dialog is required.");
  if (!nativeImage?.createFromPath) throw new TypeError("Electron nativeImage is required.");

  const materialize = (appearance) => Object.freeze({
    ...appearance,
    icon: appearance.icon?.kind === "asset"
      ? Object.freeze({
          ...appearance.icon,
          url: buildProjectIconAssetUrl(appearance.icon.assetId),
        })
      : appearance.icon,
  });

  return Object.freeze({
    async list(projectIdentities) {
      return (await store.list(projectIdentities)).map(materialize);
    },

    async chooseIcon({ projectIdentity, sender }) {
      const identity = requireProjectIdentity(projectIdentity);
      const owner = getDialogOwnerWindow?.(sender);
      const options = {
        properties: ["openFile"],
        filters: [{
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp"],
        }],
      };
      const selection = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      const sourcePath = selection.canceled ? null : selection.filePaths?.[0];
      if (!sourcePath) return Object.freeze({ status: "cancelled" });

      const normalizedPng = await normalizeProjectIcon({
        sourcePath,
        nativeImage,
      });
      const appearance = materialize(await store.setIcon(identity, normalizedPng));
      return Object.freeze({ status: "updated", appearance });
    },

    async resetIcon(projectIdentity) {
      return materialize(await store.resetIcon(requireProjectIdentity(projectIdentity)));
    },

    async setEmoji({ projectIdentity, emoji }) {
      return materialize(await store.setEmoji(
        requireProjectIdentity(projectIdentity),
        requireProjectEmoji(emoji),
      ));
    },
  });
}

export async function normalizeProjectIcon({ sourcePath, nativeImage }) {
  if (typeof sourcePath !== "string" || !sourcePath) {
    throw new TypeError("Project icon source path is required.");
  }
  const metadata = await fsp.stat(sourcePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_SOURCE_BYTES) {
    throw new Error("Project icon must be an image no larger than 10 MB.");
  }
  const source = nativeImage.createFromPath(sourcePath);
  if (!source || source.isEmpty()) throw new Error("The selected Project icon could not be decoded.");
  const size = source.getSize();
  if (
    !Number.isSafeInteger(size.width)
    || !Number.isSafeInteger(size.height)
    || size.width <= 0
    || size.height <= 0
    || size.width > MAX_SOURCE_EDGE
    || size.height > MAX_SOURCE_EDGE
  ) {
    throw new Error("Project icon dimensions are unsupported.");
  }
  const edge = Math.min(size.width, size.height);
  const cropped = source.crop({
    x: Math.floor((size.width - edge) / 2),
    y: Math.floor((size.height - edge) / 2),
    width: edge,
    height: edge,
  });
  const normalized = cropped.resize({
    width: NORMALIZED_ICON_EDGE,
    height: NORMALIZED_ICON_EDGE,
    quality: "best",
  });
  const png = normalized.toPNG();
  if (!Buffer.isBuffer(png) || png.length === 0) {
    throw new Error("The selected Project icon could not be normalized.");
  }
  return png;
}
