# PuppyOne scope-sandbox — custom E2B template (roadmap #6)

Bakes `sshd` (hardened, publickey-only), `websocat`, `python3`, and the sync
sidecar into an E2B image so a **cold connect skips the per-create runtime
install** (websocat download + sshd config + host-key generation). Connect then
only seeds the user's key and starts the pre-installed daemons (`puppyone-ssh-up`).

## Why
The default flow (`ssh_e2b.provision_steps`) downloads websocat and writes the
sshd config on **every** cold create — correct but slow/fragile. This template
moves that to build time. The runtime spec and this Dockerfile mirror each other
(`SSHD_HARDENED_CONFIG` + `provision_steps`); keep them in sync.

## Build
```bash
./build.sh            # stages the sidecar, runs `e2b template build`
```
Requires the E2B CLI (`npm i -g @e2b/cli`) and auth (`e2b auth login` or
`E2B_ACCESS_TOKEN`). The build is an **external, billable** step (publishes to
E2B's registry) — run it deliberately, like a deploy.

## Wire it up
After the build prints a template id:
```
SCOPE_SANDBOX_E2B_TEMPLATE=<template-id>
```
in the backend env. With it set:
- `SdkE2BClient.create` launches this template (`Sandbox.create(template=…)`),
- the bootstrap uses `ssh_e2b.fast_provision_steps` (seed key + `puppyone-ssh-up`)
  instead of the full install.

Leave it unset → behavior is unchanged (default template + full runtime install).

## What's baked
| Component | Path | Notes |
|---|---|---|
| websocat | `/usr/local/bin/websocat` | pinned v1.13.0 musl static |
| hardened sshd config | `/etc/ssh/puppyone_sshd_config` | publickey-only; access == authorized_keys |
| host keys | `/etc/ssh/ssh_host_*` | generated at build |
| sync sidecar | `/opt/puppyone/sync_sidecar.py` | fallback/cache — connect still re-installs the live version (no drift) |
| startup helper | `/usr/local/bin/puppyone-ssh-up` | frees :22, starts hardened sshd + websocat forwarder |
