# Fly.io scope-sandbox image (V2 "sandbox as access point")

The image + Fly app for the **Fly provider** of the scope-sandbox feature. A user
proven to hold scope permission connects with VSCode Remote-SSH to a long-lived,
scope-keyed Fly Machine; all git/CLI runs inside (data stays server-side).

> Status: **live-validated 2026-06-13** (app `puppyone-sandboxes`, region `sin`)
> — full provider lifecycle + credential grant/revoke + SSH connect over BOTH
> the free `fly proxy`/WireGuard path AND the public raw-TCP `:22` ingress
> (dedicated IPv4, allocated for the test then released). Only the VSCode IDE
> walk-through remains. Switching providers is a config flip
> (`SCOPE_SANDBOX_PROVIDER=fly`). See
> `docs/proposals/sandbox-fly-validation-2026-06.md`.

## Why Fly differs from E2B

| | E2B | Fly Machines |
|---|---|---|
| Raw TCP ingress | ❌ none → sshd + **websocat tunnel** over `wss://` | ✅ native public TCP |
| sshd setup | provisioned **at runtime** (`ssh_e2b.provision_steps`) | **baked into this image**, runs as PID 1 |
| Connection | `ProxyCommand = websocat … wss://<port>-<id>.e2b.app` | direct `ssh puppy@<app>.fly.dev` (no proxy) |
| Lifecycle stop | pause/resume | `machines stop`/`start` (disk retained) |

What's **identical** on both: the per-user credential layer
(`ssh_credentials.grant_ssh_access` / `revoke_ssh_access`) and the scope git
bootstrap (`scope_provision`) — both run via `provider.exec`, which Fly
implements over the Machines exec API. So grant = add a tagged, `expiry-time`d
line to `~/.ssh/authorized_keys`; revoke = remove it; offboarding is immediate.

The image hardens sshd to **publickey-only** (`AuthenticationMethods publickey`,
`UsePAM no`). This is essential: live E2B testing showed a stock sshd will accept
the SSH `none` auth method and let anyone in regardless of `authorized_keys`,
silently defeating per-user credentials. Don't relax this.

## One-time Fly app setup

```sh
fly auth login

# 1. App to hold the scope-sandbox machines (validated app: puppyone-sandboxes)
fly apps create puppyone-sandboxes

# 2. Build + push the image via Fly's REMOTE builder (no local Docker needed).
#    --build-only --push builds + pushes to registry.fly.io without releasing.
fly deploy ./sandbox/scope-fly --build-only --push -a puppyone-sandboxes \
  --image-label scope-sandbox --dockerfile ./sandbox/scope-fly/Dockerfile

# 3. (Production only) Dedicated IPv4 for public raw TCP :22 (~$3.60/mo, needs a
#    card; shared v4 only does HTTP). NOT needed for the free fly-proxy path below.
fly ips allocate-v4 -a puppyone-sandboxes
fly ips allocate-v6 -a puppyone-sandboxes   # free
```

### Connecting without a dedicated IPv4 (free — used for validation)

`fly proxy` tunnels a local port to the machine's internal `:2222` over
6PN/WireGuard, so you can reach sshd with no public IP:

```sh
fly proxy 10022:2222 <machine-id>.vm.puppyone-sandboxes.internal -a puppyone-sandboxes
ssh -p 10022 -i <your-key> -o IdentitiesOnly=yes puppy@localhost
```

This is exactly what `backend/scripts/fly_ssh_e2e.py` does. The public `:22`
path (step 3 + `ssh puppy@<app>.fly.dev`) is the production form once an IPv4 is
allocated; `ConnectionInfo(host=<app>.fly.dev, port=22)` already targets it.

The provider creates machines via the **Machines API** (not `fly deploy`), one
per scope, mapping internal `2222` → public TCP `22` (see
`fly_provider._machine_config`). `fly.toml` here is only a reference for the
machine config the API sends.

## Backend config

`backend/.env` (or project-level override; the provider is user-selectable):

```
SCOPE_SANDBOX_PROVIDER=fly
SCOPE_SANDBOX_FLY_APP=puppyone-sandboxes
SCOPE_SANDBOX_FLY_TOKEN=<fly api token>     # fly tokens create deploy -a <app>
SCOPE_SANDBOX_FLY_IMAGE=registry.fly.io/puppyone-sandboxes:scope-sandbox
```

## Connection flow (what the user gets)

1. `acquire()` → provider `create()` brings a machine to RUNNING; manager
   bootstrap runs `scope_provision` (clone scope via the access-key git remote,
   `pull.rebase true`).
2. Credential layer `grant_ssh_access(provider, machine_id, user_id, pubkey,
   expires_at=…)` adds the user's short-lived key.
3. **Sync sidecar auto-start** (best-effort, gated on the scope's `auto_sync`):
   `connect` calls `sidecar_provision.install_and_start`, which installs
   `~/.puppyone/sync_sidecar.py` and starts `watch`. On Fly this uses the
   **self-detaching** form (`setsid … &`) since Fly exec is SSH-based and the
   detached process survives the machine staying up — unlike E2B, which needs
   `background_exec_required` + `exec(background=True)`. The exact wrapped command
   (`su - puppy -c '… setsid python3 … &'`, with single-quoted `SYNC_*` env) is
   quoting-verified in `test_install_and_start_sidecar_command_survives_su_wrapping`.
4. User connects: `ssh puppy@<app>.fly.dev` (or VSCode Remote-SSH) — direct TCP,
   no `ProxyCommand`. `ConnectionInfo.proxy_command` is `None` for Fly.
5. Offboarding / TTL: `revoke_ssh_access(...)` (or `manager.revoke_user`, wired
   to the revoke_hook) removes the line; `expiry-time` also auto-expires it.

## Verifying the image locally (no Fly account)

```sh
docker build -t puppyone-sandboxes sandbox/scope-fly
docker run -d --name sb -p 2222:2222 puppyone-sandboxes
# add a key the way grant_ssh_access does, then:
ssh -p 2222 -o IdentitiesOnly=yes -i <key> puppy@localhost echo OK
# confirm hardening: a connection with NO key must be refused (no "none" auth)
```
