# PuppyOne Desktop telemetry edge

This Cloudflare Worker accepts the two public Desktop telemetry events,
enforces the shared schema, and maintains exact active-installation and bounded
retention sets in D1.
The checked-in configuration represents the active production service: the D1
binding targets the production database, `TELEMETRY_MODE` is `accept`, and the
Stable Desktop client pins the first-party ingestion route.

## Runtime boundary

- `POST /v1/desktop/events` accepts one versioned batch of at most 16 events.
- Schema v2 accepts `desktop_first_run` once for a fresh local installation and
  `desktop_daily_active` at most once per UTC day while the app is foregrounded.
  Schema v1 daily-active batches remain accepted during client migration.
- `GET /healthz` reports only the operational mode.
- The Worker does not read or persist IP, User-Agent, account, repository, or
  workspace information.
- `INGEST_RATE_LIMITER` is keyed by the monthly rotating pseudonymous ID.
- D1 primary keys make daily and calendar-month active counts exact.
- A separately scoped `r1_` identifier links the first-run cohort to activity
  days only during its first 100 lifecycle days. Raw retention identifiers are
  deleted after 100 days; aggregate
  lifecycle-week counts contain no identifier and may be kept longer.
- The scheduled handler runs at 00:17 UTC to roll up the previous day/month and
  recompute bounded retention cohorts before deleting expired pseudonymous rows.
- Wrangler usage metrics and dependency instrumentation are disabled for this
  project in addition to Worker invocation logs.

## Operational modes

| Mode | Behavior |
| --- | --- |
| `paused` | Returns retryable `503`; default for every new deployment. |
| `accept` | Validates, limits, and persists accepted events. |
| `discard` | Validates and acknowledges events without persisting them. Emergency privacy kill switch. |

## Local verification

From the repository root:

```bash
npm run test:desktop-telemetry
npm run check:boundaries
npx wrangler dev --config cloudflare/desktop-telemetry/wrangler.jsonc
```

Retention week `0` covers lifecycle days 0–6, week `1` covers days 7–13,
and so on through completed week `13`. A cohort member counts once in a week
when the installation has at least one foreground activity day in that window;
completed weeks with no retained installations are stored explicitly as zero.

The checked-in database ID is the production binding. Do not reuse it for local,
preview, or third-party deployments.

## Provisioning checklist

These commands are intentionally not run by repository builds:

```bash
npx wrangler whoami
npx wrangler d1 migrations apply puppyone-desktop-telemetry \
  --remote \
  --config cloudflare/desktop-telemetry/wrangler.jsonc
npx wrangler deploy --config cloudflare/desktop-telemetry/wrangler.jsonc
```

New non-production environments must use their own D1 database and start in
`paused` or `discard` mode. Never point a preview Worker at the production D1
binding.

## Activation gates

The production service may remain in `accept` mode only while all of the
following are true:

1. Migrations and malformed-request tests pass against a non-production Worker.
2. Worker invocation logs are confirmed disabled and no request body is logged.
3. The public telemetry disclosure and product notice are published.
4. The Settings opt-out is available in the same Stable release.
5. The privacy contact `guanqun.real@puppyone.ai` is monitored.
6. D1 contains no IP address, User-Agent, account, or workspace columns.
7. `paused`, `discard`, rate-limit, duplicate, offline-batch, and Cron behavior
   have all been smoke tested.

If any gate stops being true, switch the Worker to `discard` immediately while
the issue is investigated. Use `paused` only when clients should retain and
retry their bounded local queue.
