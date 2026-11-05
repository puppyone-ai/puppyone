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

## Experimental device folders (disabled by default)

A future, separately gated feature lets you explicitly register a folder on
one signed-in computer for access from your other signed-in computers. Local
folder use does not enable it. When enabled, the host makes an outbound TLS
connection; file bytes travel through the Puppyone API/gateway, which can see
them in transit. The planned relay must not persist file bodies or the host's absolute
path. Its current prototype stores device and folder identifiers, display names
(the computer's host name and the folder's name), permissions and connection
metadata including when the computer was last online, the PuppyOne version it
runs and a random identifier that changes on every launch. It records operation
type (including starting to watch a folder for changes) and outcome, not file
paths or bodies. Change notifications carry folder-relative names of changed
files through the relay without storing them. Audit retention and privacy
review remain rollout gates. It is **not end-to-end
encrypted**, not an automatic Cloud publish, and not product analytics.

On the computer that shares a folder, a separate PuppyOne Host process (the
same program, without windows) keeps the folder's location, the device key
(encrypted with the operating system's credential storage), the "paused" and
"run on the whole computer" choices in its own application data. It keeps
sharing after PuppyOne quits, until you pause, remove the folder or the
computer, or sign out of PuppyOne on that computer. Your PuppyOne sign-in stays
with the App; the Host process never receives it. On the computer that opens a
shared folder, PuppyOne remembers recently opened folders by identifier and
display name. Removing a computer deletes its key; pausing stops serving until
resumed.

If you allow terminals, Git or Agents in a shared folder, what your other
computers start there runs on the sharing computer. By default it runs in an
operating-system sandbox (macOS and Linux) that can change only that folder and
cannot read SSH keys, the keychain, browser data or PuppyOne's own data; where
no sandbox is available nothing runs unless you separately allow running on the
whole computer, which acts as you with access to all your files and sign-ins.
The relay records only that such a session or connection started and how it
ended.

For a planned end-to-end encrypted transport, the Cloud can also sign
five-minute SSH certificates for your own computers and relay connection bytes
it cannot read; it records only that a connection opened and how it ended. That
transport is not used by PuppyOne yet.

This experiment remains off until privacy review, retention policy, security
and two-device acceptance are complete. Do not treat this section as notice
that the feature is available in Stable builds.

Privacy questions: [guanqun.real@puppyone.ai](mailto:guanqun.real@puppyone.ai).
