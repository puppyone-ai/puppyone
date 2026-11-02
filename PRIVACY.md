# Privacy

Eligible Stable builds send Basic product analytics after showing the current
notice. You can turn analytics off in **Settings → Privacy**. Development and
Internal builds do not send these events.

Basic analytics measure installations and application usage, not people. They
contain two events: `desktop_first_run`, at most once for a fresh installation,
and `desktop_daily_active`, at most once per UTC day while the app is
foregrounded. Existing installations are not counted as new installations
when they upgrade.

Events include the UTC activity day, application version, operating system
family and major version, processor architecture, notice version, a random
retry identifier, and a monthly rotating pseudonymous installation ID. A
separate pseudonymous retention ID links activity during the installation's
first 100 lifecycle days; the first-run event also includes the onboarding
version. These IDs come from a random local secret, not an account or hardware
identifier. The [event catalog](shared/desktop-telemetry-contract.mjs) lists the
exact permitted fields.

Events never include account identifiers, credentials, files or file paths,
Git metadata, prompts, Agent replies, terminal content, hardware serial
numbers, raw IP addresses, or full User-Agent strings. Cloudflare processes
connection metadata to deliver requests; the analytics Worker does not read
it into analytics records or store it in the database, and invocation logs
are disabled.

| Analytics records | Retention |
| --- | --- |
| Retry receipts | 8 days |
| Daily pseudonymous activity | 35 days |
| Monthly pseudonymous activity | 62 days |
| First-run and retention activity details | 100 days |
| Aggregate counts without identifiers | Long term |

Turning analytics off clears the local queue and identity secret. Already
submitted records expire on the schedule above; the service has no mapping
from these IDs to a Puppyone account. Opting back in does not count the
installation as a new first run.

Privacy questions: [guanqun.real@puppyone.ai](mailto:guanqun.real@puppyone.ai).
