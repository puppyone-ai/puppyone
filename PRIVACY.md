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
folder use does not enable it. When enabled, the sharing computer keeps an
outbound TLS connection to the PuppyOne gateway; your other computers reach the
folder only inside an SSH session that ends on the sharing computer. File
contents, change notifications, terminal and Agent input and output, and Git
results are encrypted end to end between your two computers: the gateway relays
bytes it cannot read. For each connection your other computer makes a fresh key
and gets a five-minute certificate from the Cloud for that one computer; the
sharing computer checks the certificate and its own permission for the folder,
and identifies itself with its device key, which your other computer checks.

The Cloud stores device and folder identifiers, display names (the computer's
host name and the folder's name), permissions and connection metadata
including when the computer was last online, the PuppyOne version it runs and a
random identifier that changes on every launch. It never sees what happens
inside a connection, so nothing is recorded per file or per command. It records
connections: which of your computers and which shared folder was opened, when,
and how it ended, without file names, paths or content, kept 30 days. Only your
own sign-in reaches your computers; PuppyOne's cloud Agents and other runtime
credentials cannot. The PuppyOne CLI (`puppyone hosts`) uses the same
certificates with standard OpenSSH. It is not an automatic Cloud publish and
not product analytics.

On the computer that shares a folder, a separate PuppyOne Host process (the
same program, without windows) keeps the folder's location, the device key
(encrypted with the operating system's credential storage) and the "paused"
choice in its own application data. It keeps
sharing after PuppyOne quits, until you pause, remove the folder or the
computer, or sign out of PuppyOne on that computer. Your PuppyOne sign-in stays
with the App; the Host process never receives it. On the computer that opens a
shared folder, PuppyOne remembers recently opened folders by identifier and
display name. Removing a computer deletes its key; pausing stops serving until
resumed.

If you allow terminals, Git or Agents in a shared folder, what your other
computers start there runs on the sharing computer, always inside an
operating-system sandbox (macOS and Linux) that can change only that folder and
cannot read SSH keys, the keychain, browser data or PuppyOne's own data. Where no
sandbox is available (for example Windows), nothing can be run there remotely.

You can choose to start the PuppyOne Host process when you log in (a login
item on macOS and Windows, an autostart entry on Linux) so shared folders come
back after a restart without opening the App. It is off unless you turn it on.

This experiment remains off until privacy review, retention policy, security
and two-device acceptance are complete. Do not treat this section as notice
that the feature is available in Stable builds.

Privacy questions: [guanqun.real@puppyone.ai](mailto:guanqun.real@puppyone.ai).
