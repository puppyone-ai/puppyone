import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { verifyRemoteReleaseEntries } from "../../../../scripts/release-support/desktop-release-remote-verifier.mjs";

const servers = [];
const timers = [];
const payload = Buffer.from("verified installer bytes");
const digest = createHash("sha256").update(payload).digest("hex");
const entry = url => ({ url, bytes: payload.length, sha256: digest });
const options = {
  attempts: 2, requestTimeoutMs: 300, idleTimeoutMs: 150,
  attemptTimeoutMs: 1_000, fileTimeoutMs: 2_000,
  retryDelayMs: 10, progressIntervalMs: 30, onEvent: () => {},
};

async function serve(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  timers.splice(0).forEach(clearInterval);
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

describe("bounded release verification over real HTTP", () => {
  it("shares one concurrency limit across platforms and origins", async () => {
    let active = 0;
    let maximum = 0;
    const firstWave = [];
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const handler = (_request, response) => {
      active++;
      maximum = Math.max(maximum, active);
      if (firstWave.length < 3) {
        firstWave.push(() => { active--; response.end(payload); });
        if (firstWave.length === 3) started();
      } else { active--; response.end(payload); }
    };
    const first = await serve(handler);
    const second = await serve(handler);
    const entries = Array.from({ length: 8 }, (_, i) => entry(`${i % 2 ? second : first}/target-${i}`));
    const verification = verifyRemoteReleaseEntries(entries, { ...options, concurrency: 3 });
    await ready;
    expect(active).toBe(3);
    firstWave.forEach(release => release());
    await expect(verification).resolves.toMatchObject({ files: 8, verified: 8, failed: 0 });
    expect(maximum).toBe(3);
  });

  it("retries temporary HTTP errors and records attempts, progress and final digests", async () => {
    let requests = 0;
    const events = [];
    const origin = await serve((_request, response) => {
      if (++requests === 1) { response.writeHead(503); response.end("retry"); return; }
      response.write(payload.subarray(0, 5));
      const timer = setTimeout(() => response.end(payload.subarray(5)), 90);
      timers.push(timer);
    });
    await verifyRemoteReleaseEntries([entry(origin)], { ...options, onEvent: event => events.push(event) });
    expect(requests).toBe(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "retry", attempt: 1, nextAttempt: 2 }),
      expect.objectContaining({ event: "progress", bytes: 5, expectedBytes: payload.length }),
      expect.objectContaining({ event: "verified", attempt: 2, bytes: payload.length }),
      expect.objectContaining({ event: "summary", verified: 1, failed: 0 }),
    ]));
  });

  it("restarts hashing from zero after a broken connection", async () => {
    let requests = 0;
    const origin = await serve((_request, response) => {
      if (++requests === 1) {
        response.writeHead(200, { "Content-Length": payload.length });
        response.write(payload.subarray(0, 5));
        timers.push(setTimeout(() => response.destroy(), 20));
      } else response.end(payload);
    });
    await expect(verifyRemoteReleaseEntries([entry(origin)], options)).resolves.toMatchObject({ verified: 1 });
    expect(requests).toBe(2);
  });

  it("bounds the wait for response headers", async () => {
    let requests = 0;
    const origin = await serve(() => { requests++; });
    await expect(verifyRemoteReleaseEntries([entry(origin)], {
      ...options, requestTimeoutMs: 80,
    })).rejects.toThrow("Response headers timed out");
    expect(requests).toBe(2);
  });

  it("bounds a body that stops delivering data after its first chunk", async () => {
    const origin = await serve((_request, response) => { response.write(payload.subarray(0, 3)); });
    await expect(verifyRemoteReleaseEntries([entry(origin)], {
      ...options, attempts: 1, idleTimeoutMs: 80,
    })).rejects.toThrow("Download stalled");
  });

  it("bounds a continuously trickling body even though it never hits the idle timeout", async () => {
    const origin = await serve((_request, response) => {
      response.write("x");
      timers.push(setInterval(() => response.write("x"), 25));
    });
    await expect(verifyRemoteReleaseEntries([{ ...entry(origin), bytes: 1_000_000 }], {
      ...options, attempts: 1, attemptTimeoutMs: 140,
    })).rejects.toThrow("Attempt time limit exceeded");
  });

  it("applies a single time budget across retries, rather than restarting it each attempt", async () => {
    const events = [];
    const origin = await serve(() => {});
    await expect(verifyRemoteReleaseEntries([entry(origin)], {
      ...options, attempts: 5, requestTimeoutMs: 80, fileTimeoutMs: 230,
      onEvent: event => events.push(event),
    })).rejects.toThrow("File time budget exhausted");
    // Windows timer scheduling can consume enough budget to skip an attempt.
    // The contract is that the shared deadline stops retries before the cap.
    const attempts = events.filter(event => event.event === "attempt").length;
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(attempts).toBeLessThan(5);
  });

  it.each([403, 206])("rejects HTTP %s without retrying or accepting a partial response", async status => {
    let requests = 0;
    const origin = await serve((_request, response) => {
      requests++;
      response.writeHead(status);
      response.end(payload);
    });
    await expect(verifyRemoteReleaseEntries([entry(origin)], options)).rejects.toThrow(`HTTP ${status}`);
    expect(requests).toBe(1);
  });

  it("never follows redirects or prints access credentials", async () => {
    let redirected = 0;
    const events = [];
    const foreign = await serve((_request, response) => { redirected++; response.end(payload); });
    const origin = await serve((request, response) => {
      expect(request.headers.authorization).toBe("Bearer fixture-private-token");
      response.writeHead(302, { Location: foreign });
      response.end();
    });
    await expect(verifyRemoteReleaseEntries([entry(origin)], {
      ...options, headers: { Authorization: "Bearer fixture-private-token" },
      onEvent: event => events.push(event),
    })).rejects.toThrow("HTTP 302");
    expect(redirected).toBe(0);
    expect(JSON.stringify(events)).not.toContain("fixture-private-token");
  });

  it.each([
    ["different bytes with identical size", Buffer.alloc(payload.length, "x"), "Digest mismatch"],
    ["truncated payload", payload.subarray(0, 4), "Digest mismatch"],
    ["oversized payload", Buffer.concat([payload, payload]), "exceeds expected size"],
  ])("rejects %s and does not retry integrity failures", async (_name, served, message) => {
    let requests = 0;
    const origin = await serve((_request, response) => { requests++; response.end(served); });
    await expect(verifyRemoteReleaseEntries([entry(origin)], options)).rejects.toThrow(message);
    expect(requests).toBe(1);
  });

  it("waits for the remaining workers before reporting failure", async () => {
    let siblingFinished = false;
    const origin = await serve((request, response) => {
      if (request.url === "/failure") { response.writeHead(403); response.end(); }
      else {
        timers.push(setTimeout(() => { siblingFinished = true; response.end(payload); }, 100));
      }
    });
    const events = [];
    await expect(verifyRemoteReleaseEntries([entry(`${origin}/failure`), entry(`${origin}/sibling`)], {
      ...options, onEvent: event => events.push(event),
    })).rejects.toThrow("HTTP 403");
    expect(siblingFinished).toBe(true);
    expect(events.at(-1)).toMatchObject({ event: "summary", verified: 1, failed: 1 });
    await delay(10);
  });
});
