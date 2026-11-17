import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishViewerPacksToR2,
  verifyLocalViewerPacks,
} from "../../../../scripts/publish-viewer-packs-r2.mjs";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempPackDir({ tamperArchive = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "po-viewer-pack-pub-"));
  tempDirs.push(dir);
  const archiveBytes = Buffer.from("fake-excalidraw-pack-tar-gz-payload");
  const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const id = "puppyone.excalidraw";
  const version = "0.18.1";
  const archive = `${id}-${version}.tar.gz`;
  const checksum = `${id}-${version}.sha256`;

  await fs.writeFile(
    path.join(dir, archive),
    tamperArchive ? Buffer.from("corrupted-payload") : archiveBytes,
  );
  await fs.writeFile(path.join(dir, checksum), `${sha256}  ${archive}\n`);
  await fs.writeFile(
    path.join(dir, `${id}-${version}.manifest.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        id,
        version,
        archive,
        checksum,
        sha256,
        size: archiveBytes.byteLength,
      },
      null,
      2,
    ) + "\n",
  );
  return { dir, archiveBytes, sha256, id, version, archive };
}

describe("viewerPacksPublisher", () => {
  it("verifies intact local viewer packs and rejects tampered archives", async () => {
    const valid = await createTempPackDir();
    const packs = await verifyLocalViewerPacks(valid.dir, { requireNonEmpty: true });
    expect(packs).toHaveLength(1);
    expect(packs[0].r2Prefix).toBe("desktop/viewer-packs/puppyone.excalidraw/0.18.1");

    const tampered = await createTempPackDir({ tamperArchive: true });
    await expect(verifyLocalViewerPacks(tampered.dir, { requireNonEmpty: true })).rejects.toThrow(
      /size mismatch|sha256 mismatch/,
    );
  });

  it("uploads missing viewer packs to R2 idempotently and verifies public CDN sha256", async () => {
    const valid = await createTempPackDir();
    const awsCalls = [];
    const uploadedKeys = new Map();

    const server = http.createServer((req, res) => {
      const key = (req.url ?? "").replace(/^\/+/, "");
      const body = uploadedKeys.get(key);
      if (!body) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/gzip" }).end(body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;

    try {
      const runAws = (args, { allowFailure = false } = {}) => {
        awsCalls.push(args);
        if (args[0] === "s3api" && args[1] === "head-object") {
          const key = args[args.indexOf("--key") + 1];
          if (uploadedKeys.has(key)) return true;
          if (allowFailure) return false;
          throw new Error("missing object");
        }
        if (args[0] === "s3" && args[1] === "cp") {
          const src = args[2];
          const destKey = args[3].replace(/^s3:\/\/[^/]+\//, "");
          return fs.readFile(src).then((buf) => {
            uploadedKeys.set(destKey, buf);
            return true;
          });
        }
        throw new Error(`Unexpected aws invocation: ${args.join(" ")}`);
      };

      // Synchronous mock wrapper pre-populating on s3 cp using sync read
      const syncRunAws = (args, opts) => {
        awsCalls.push(args);
        if (args[0] === "s3api" && args[1] === "head-object") {
          const key = args[args.indexOf("--key") + 1];
          return uploadedKeys.has(key) ? true : opts?.allowFailure ? false : (() => { throw new Error("missing"); })();
        }
        if (args[0] === "s3" && args[1] === "cp") {
          const destKey = args[3].replace(/^s3:\/\/[^/]+\//, "");
          if (destKey.endsWith(".tar.gz")) {
            uploadedKeys.set(destKey, valid.archiveBytes);
          } else {
            uploadedKeys.set(destKey, Buffer.from("meta"));
          }
          return true;
        }
        throw new Error(`Unexpected aws invocation: ${args.join(" ")}`);
      };
      void runAws;

      const first = await publishViewerPacksToR2({
        packsDir: valid.dir,
        bucket: "puppyone-desktop",
        endpoint: "https://example.r2.cloudflarestorage.com",
        publicOrigin: origin,
        requireNonEmpty: true,
        runAws: syncRunAws,
      });
      expect(first).toHaveLength(1);
      expect(awsCalls.filter((c) => c[0] === "s3" && c[1] === "cp")).toHaveLength(3);

      // Second run sees head-object succeed and performs zero duplicate uploads.
      awsCalls.length = 0;
      await publishViewerPacksToR2({
        packsDir: valid.dir,
        bucket: "puppyone-desktop",
        endpoint: "https://example.r2.cloudflarestorage.com",
        publicOrigin: origin,
        requireNonEmpty: true,
        runAws: syncRunAws,
      });
      expect(awsCalls.filter((c) => c[0] === "s3" && c[1] === "cp")).toHaveLength(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
