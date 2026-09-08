#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT,
  DESKTOP_TELEMETRY_FIRST_RUN_EVENT,
  DESKTOP_TELEMETRY_LEVELS,
  getDesktopTelemetryDisclosure,
} from "../shared/desktop-telemetry-contract.mjs";
import { DESKTOP_STABLE_TELEMETRY_INGEST_URL } from "../shared/desktop-telemetry-distribution-contract.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const expectedStableEndpoint = "https://telemetry.puppyone.ai/v1/desktop/events";

if (DESKTOP_TELEMETRY_LEVELS.join(",") !== "off,basic") {
  errors.push("the default-on telemetry contract must remain limited to off and basic");
}

const disclosure = getDesktopTelemetryDisclosure();
if (
  disclosure.events.length !== 2
  || disclosure.events[0]?.name !== DESKTOP_TELEMETRY_FIRST_RUN_EVENT
  || disclosure.events[1]?.name !== DESKTOP_TELEMETRY_DAILY_ACTIVE_EVENT
) {
  errors.push("the basic level must disclose exactly one first-run and one daily-active event");
}
for (const event of disclosure.events) {
  if (
    !event?.fields.includes("activity_day")
    || !event?.fields.includes("retention_id")
    || event?.fields.includes("occurred_at")
    || event?.fields.includes("properties.channel")
  ) {
    errors.push("public events must disclose the bounded retention ID and calendar day without time-of-day or build channel");
  }
}

if (DESKTOP_STABLE_TELEMETRY_INGEST_URL !== null) {
  let endpoint;
  try {
    endpoint = new URL(DESKTOP_STABLE_TELEMETRY_INGEST_URL);
  } catch {
    errors.push("the Stable telemetry endpoint must be null or a valid URL");
  }
  if (
    endpoint
    && (
      endpoint.protocol !== "https:"
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
      || !endpoint.hostname.endsWith(".puppyone.ai")
    )
  ) {
    errors.push("the Stable telemetry endpoint must be a first-party HTTPS URL without credentials or URL parameters");
  }
}
if (DESKTOP_STABLE_TELEMETRY_INGEST_URL !== expectedStableEndpoint) {
  errors.push(`the active Stable telemetry endpoint must be pinned to ${expectedStableEndpoint}`);
}

const mainSource = await readText("electron/main.mjs");
requireSource(mainSource, "createDesktopTelemetryHost", "Electron main must own the telemetry host");
requireSource(mainSource, "buildInfo: desktopBuildInfo", "telemetry eligibility must use packaged Desktop Build Identity");
requireSource(mainSource, "await telemetryHost.start()", "telemetry must initialize before the first window can report activity");

const serviceSource = await readText("electron/main/telemetry/application/desktop-telemetry-service.mjs");
requireSource(serviceSource, 'identity.channel !== "stable"', "non-Stable builds must stay ineligible");
requireSource(serviceSource, 'preference.level === "off"', "the application service must enforce the off level");
requireSource(serviceSource, "notice_seen_version", "the current product notice must gate telemetry delivery");
requireSource(serviceSource, "await queueStore.clear()", "switching off must delete queued events");
requireSource(serviceSource, "await identityStore.clear()", "switching off must delete the local identity secret");
requireSource(serviceSource, "createDesktopFirstRunEvent", "the application service must own the bounded first-run signal");
requireSource(serviceSource, "neutralizeTelemetryLifecycle", "opt-out and identity reset must not create false new-install cohorts");

const identitySource = await readText("electron/main/telemetry/infrastructure/telemetry-identity-store.mjs");
requireSource(identitySource, 'deriveAnonymousId("m1"', "daily activity must keep its calendar-month identifier");
requireSource(identitySource, 'deriveAnonymousId("r1"', "retention must use a separate scoped identifier");
const lifecycleSource = await readText("electron/main/telemetry/infrastructure/telemetry-lifecycle-store.mjs");
requireSource(lifecycleSource, 'cohort_status: fresh ? "fresh" : "baseline"', "first-run eligibility must be persisted independently from identity");

const transportSource = await readText("electron/main/telemetry/infrastructure/telemetry-http-transport.mjs");
requireSource(transportSource, 'credentials: "omit"', "telemetry requests must omit application and browser credentials");
requireSource(transportSource, 'redirect: "error"', "telemetry requests must reject redirects");
requireSource(transportSource, "events.every(isDesktopTelemetryEvent)", "the transport must reject non-allowlisted payloads");

const eventSource = await readText("shared/desktop-telemetry-event.mjs");
requireSource(eventSource, "activity_day", "the shared event validator must require the UTC calendar day");
for (const forbidden of ["occurred_at", "properties.channel"]) {
  if (eventSource.includes(forbidden)) errors.push(`the shared event validator must not expose ${forbidden}`);
}

const edgeSource = [
  await readText("cloudflare/desktop-telemetry/src/worker.mjs"),
  await readText("cloudflare/desktop-telemetry/src/ingest-contract.mjs"),
  await readText("cloudflare/desktop-telemetry/src/d1-telemetry-repository.mjs"),
].join("\n");
requireSource(edgeSource, "parseDesktopTelemetryRequest", "the Cloudflare Worker must validate the shared event contract");
requireSource(edgeSource, "INGEST_RATE_LIMITER", "the Cloudflare Worker must enforce a bounded ingest rate");
requireSource(edgeSource, "telemetry_daily_active", "D1 must maintain the exact daily active set");
requireSource(edgeSource, "telemetry_monthly_active", "D1 must maintain the exact calendar-month active set");
requireSource(edgeSource, "telemetry_first_runs", "D1 must maintain the anonymous first-run cohort set");
requireSource(edgeSource, "telemetry_retention_daily_active", "D1 must maintain bounded retention activity detail");
requireSource(edgeSource, "telemetry_retention_rollups", "D1 must persist lifecycle-week retention aggregates");
requireSource(edgeSource, "RETENTION_DETAIL_RETENTION_DAYS = 100", "raw retention identifiers must be bounded to 100 days");
requireSource(edgeSource, 'mode === "discard"', "the edge must retain an emergency privacy discard mode");
for (const forbidden of ["cf-connecting-ip", "x-forwarded-for", "user-agent", "console.log", "console.error"]) {
  if (edgeSource.toLowerCase().includes(forbidden)) {
    errors.push(`the telemetry edge source must not read or log ${forbidden}`);
  }
}

const migrationSource = [
  await readText("cloudflare/desktop-telemetry/migrations/0001_initial.sql"),
  await readText("cloudflare/desktop-telemetry/migrations/0002_first_run_retention.sql"),
].join("\n");
requireSource(migrationSource, "PRIMARY KEY (activity_day, anonymous_id)", "D1 must deduplicate daily activity exactly");
requireSource(migrationSource, "PRIMARY KEY (activity_month, anonymous_id)", "D1 must deduplicate calendar-month activity exactly");
requireSource(migrationSource, "PRIMARY KEY (activity_day, retention_id)", "D1 must deduplicate retention activity exactly");
requireSource(migrationSource, "PRIMARY KEY (cohort_day, retention_week)", "D1 must deduplicate retention aggregates exactly");
if (/ip_address|user_agent|email|account|workspace|repository/i.test(migrationSource)) {
  errors.push("the telemetry D1 schema must not add network, account, or workspace identifiers");
}

const wranglerSource = await readText("cloudflare/desktop-telemetry/wrangler.jsonc");
requireSource(wranglerSource, '"TELEMETRY_MODE": "accept"', "the production telemetry edge must accept Stable events");
requireSource(wranglerSource, '"invocation_logs": false', "Cloudflare invocation logs must remain disabled");
requireSource(wranglerSource, '"send_metrics": false', "project-scoped Wrangler usage telemetry must remain disabled");
requireSource(wranglerSource, '"enabled": false', "Wrangler dependency instrumentation must remain disabled");
requireSource(wranglerSource, '"binding": "DB"', "the edge must use an explicit D1 binding");
if (DESKTOP_STABLE_TELEMETRY_INGEST_URL !== null && !/"TELEMETRY_MODE"\s*:\s*"accept"/.test(wranglerSource)) {
  errors.push("the configured Stable client endpoint requires an accepting production edge");
}

const publicTelemetrySource = await readText("src/features/telemetry/publicDisclosure.ts");
requireSource(
  publicTelemetrySource,
  "https://github.com/puppyone-ai/puppyone-desktop/blob/main/README.md#privacy",
  "the product must link to the disclosure in the public Desktop repository",
);
const publicReadme = await readText("README.md");
for (const term of ["## Privacy", "desktop_first_run", "desktop_daily_active", "100 days", "Settings → Privacy", "shared/desktop-telemetry-contract.mjs"]) {
  requireSource(publicReadme, term, `the public disclosure must include ${term}`);
}

const ipcSource = await readText("electron/main/ipc/telemetry-ipc.mjs");
const registeredChannels = [...ipcSource.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((match) => match[1]);
const expectedChannels = [
  "telemetry:get-state",
  "telemetry:get-disclosure",
  "telemetry:mark-notice-seen",
  "telemetry:set-level",
  "telemetry:reset-identity",
];
if (registeredChannels.sort().join(",") !== expectedChannels.sort().join(",")) {
  errors.push("telemetry IPC must expose only state, disclosure, notice, level, and identity-reset controls");
}

const preloadSource = await readText("electron/preload.cjs");
for (const forbidden of ["trackTelemetryEvent", "captureTelemetryEvent", "sendTelemetryEvent"]) {
  if (preloadSource.includes(forbidden)) {
    errors.push(`preload must not expose an arbitrary renderer telemetry method (${forbidden})`);
  }
}

const noticeSource = await readText("src/components/onboarding/OnboardingTelemetryDisclosure.tsx");
requireSource(noticeSource, "state?.eligible", "the disclosure must remain limited to eligible Stable builds");
requireSource(noticeSource, "markTelemetryNoticeSeen", "the renderer must persist the versioned first-launch disclosure through bounded IPC");
requireSource(noticeSource, "shownForLaunch", "the disclosure must remain visible for the current onboarding after it is persisted");
requireSource(noticeSource, 't("onboarding.telemetry.notice")', "the first-launch disclosure must use the localized onboarding contract");

const privacySettingsSource = await readText("src/features/settings/main/PrivacySettingsView.tsx");
const analyticsSettingsSource = await readText("src/features/settings/main/ProductAnalyticsSettingsRow.tsx");
requireSource(privacySettingsSource, "<ProductAnalyticsSettingsRow />", "Settings Privacy must contain the product analytics preference");
requireSource(analyticsSettingsSource, "getTelemetryState", "Settings Privacy must read the authoritative telemetry state");
requireSource(analyticsSettingsSource, "setTelemetryLevel", "Settings Privacy must update telemetry through bounded IPC");
requireSource(analyticsSettingsSource, 'checked ? "basic" : "off"', "Settings Privacy must expose only the basic and off levels");
requireSource(analyticsSettingsSource, "<SettingsToggle", "Settings Privacy must reuse the product Settings switch");

const appSource = await readText("src/App.tsx");
if (appSource.includes("OnboardingTelemetryDisclosure")) {
  errors.push("the first-launch telemetry disclosure must not be mounted in the workspace sidebar");
}

for (const sourceRoot of ["src", "packages/shared-ui/src"]) {
  for (const filePath of await listSourceFiles(sourceRoot)) {
    const source = await fs.readFile(filePath, "utf8");
    if (/\b(?:posthog|mixpanel|amplitude)(?:-js)?\b/i.test(source)) {
      errors.push(`${path.relative(repositoryRoot, filePath)} must not embed a renderer analytics SDK`);
    }
    if (/electron\/main\/telemetry|telemetry-http-transport/.test(source)) {
      errors.push(`${path.relative(repositoryRoot, filePath)} must not import main-process telemetry infrastructure`);
    }
  }
}

if (errors.length > 0) {
  console.error("Desktop telemetry architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Desktop telemetry architecture check passed.");

function requireSource(source, snippet, message) {
  if (!source.includes(snippet)) errors.push(message);
}

async function readText(relativePath) {
  return fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function listSourceFiles(relativeRoot) {
  const root = path.join(repositoryRoot, relativeRoot);
  const output = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await listSourceFiles(path.relative(repositoryRoot, entryPath)));
    else if (/\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) output.push(entryPath);
  }
  return output;
}
