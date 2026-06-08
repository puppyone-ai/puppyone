# Fly.io scope-sandbox image (V2 "sandbox as access point")

The image + Fly app for the **Fly provider** of the scope-sandbox feature. A user
proven to hold scope permission connects with VSCode Remote-SSH to a long-lived,
scope-keyed Fly Machine; all git/CLI runs inside (data stays server-side).

> Status: **code-complete, not yet live-validated** (blocked on Fly payment +
> dedicated IPv4). The E2B provider is the live-validated path. This mirrors that
> design so switching providers is a config flip (`SCOPE_SANDBOX_PROVIDER=fly`).

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

# 1. App to hold the scope-sandbox machines
fly apps create puppyone-scope-sandbox

# 2. Dedicated IPv4 — required for raw TCP :22 (shared v4 only does HTTP).
#    ~$3.60/mo. Without it, VSCode Remote-SSH over plain TCP won't reach the box.
fly ips allocate-v4 -a puppyone-scope-sandbox
fly ips allocate-v6 -a puppyone-scope-sandbox   # free

# 3. Build + push the image to Fly's registry
fly auth docker
docker build -t registry.fly.io/puppyone-scope-sandbox:scope-sandbox sandbox/scope-fly
docker push  registry.fly.io/puppyone-scope-sandbox:scope-sandbox
```

The provider creates machines via the **Machines API** (not `fly deploy`), one
per scope, mapping internal `2222` → public TCP `22` (see
`fly_provider._machine_config`). `fly.toml` here is only a reference for the
machine config the API sends.

## Backend config

`backend/.env` (or project-level override; the provider is user-selectable):

```
SCOPE_SANDBOX_PROVIDER=fly
SCOPE_SANDBOX_FLY_APP=puppyone-scope-sandbox
SCOPE_SANDBOX_FLY_TOKEN=<fly api token>     # fly tokens create deploy -a <app>
SCOPE_SANDBOX_FLY_IMAGE=registry.fly.io/puppyone-scope-sandbox:scope-sandbox
```

## Connection flow (what the user gets)

1. `acquire()` → provider `create()` brings a machine to RUNNING; manager
   bootstrap runs `scope_provision` (clone scope via the access-key git remote,
   `pull.rebase true`).
2. Credential layer `grant_ssh_access(provider, machine_id, user_id, pubkey,
   expires_at=…)` adds the user's short-lived key.
3. User connects: `ssh puppy@<app>.fly.dev` (or VSCode Remote-SSH) — direct TCP,
   no `ProxyCommand`. `ConnectionInfo.proxy_command` is `None` for Fly.
4. Offboarding / TTL: `revoke_ssh_access(...)` (or `manager.revoke_user`, wired
   to the revoke_hook) removes the line; `expiry-time` also auto-expires it.

## Verifying the image locally (no Fly account)

```sh
docker build -t puppyone-scope-sandbox sandbox/scope-fly
docker run -d --name sb -p 2222:2222 puppyone-scope-sandbox
# add a key the way grant_ssh_access does, then:
ssh -p 2222 -o IdentitiesOnly=yes -i <key> puppy@localhost echo OK
# confirm hardening: a connection with NO key must be refused (no "none" auth)
```
