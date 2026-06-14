# PuppyOne scope-sandbox — custom E2B template (roadmap #6).
#
# Bakes everything the runtime connect flow otherwise installs on every cold
# create (sshd hardening + websocat download + host keys + the sync sidecar), so
# a connect only has to SEED the user's key and START the pre-installed daemons.
# Build: see build.sh (stages the sidecar into the context, runs `e2b template build`).
#
# Mirrors the runtime spec in backend/src/platform/scope_sandbox/ssh_e2b.py
# (SSHD_HARDENED_CONFIG + provision_steps) — keep the two in sync.

FROM e2bdev/code-interpreter:latest

USER root

# --- SSH server + tools (curl for websocat fetch) -------------------------
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server curl ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

# --- websocat (pinned musl static build; same URL as ssh_e2b.py) ----------
RUN curl -fsSL -o /usr/local/bin/websocat \
        https://github.com/vi/websocat/releases/download/v1.13.0/websocat.x86_64-unknown-linux-musl \
    && chmod +x /usr/local/bin/websocat

# --- hardened, publickey-only sshd config (== SSHD_HARDENED_CONFIG) --------
# Access == authorized_keys exactly: grant=add line, revoke=remove, TTL=expiry.
RUN mkdir -p /run/sshd && ssh-keygen -A \
    && printf '%s\n' \
        'Port 22' \
        'HostKey /etc/ssh/ssh_host_ed25519_key' \
        'HostKey /etc/ssh/ssh_host_rsa_key' \
        'PidFile /run/sshd.pid' \
        'AuthorizedKeysFile .ssh/authorized_keys' \
        'PubkeyAuthentication yes' \
        'AuthenticationMethods publickey' \
        'PasswordAuthentication no' \
        'PermitEmptyPasswords no' \
        'KbdInteractiveAuthentication no' \
        'ChallengeResponseAuthentication no' \
        'UsePAM no' \
        'PermitRootLogin no' \
        > /etc/ssh/puppyone_sshd_config

# --- sync sidecar (staged into the context by build.sh) -------------------
# Baked as a fallback/cache; connect still re-installs it so the deployed
# version always wins (avoids template/repo drift).
COPY sync_sidecar.py /opt/puppyone/sync_sidecar.py
RUN chmod +x /opt/puppyone/sync_sidecar.py

# --- startup helper: free :22 from the default socket-activated sshd, then
#     start OUR hardened sshd + the websocat wss→tcp:22 forwarder. The connect
#     flow runs this instead of the full provision (see fast_provision_steps). -
RUN printf '%s\n' \
        '#!/usr/bin/env bash' \
        'set -e' \
        'FORWARD_PORT="${1:-8081}"' \
        'mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' \
        'sudo systemctl stop ssh.socket ssh.service 2>/dev/null || true' \
        'sudo pkill -x sshd 2>/dev/null || true' \
        'sleep 1' \
        'sudo mkdir -p /run/sshd && sudo /usr/sbin/sshd -f /etc/ssh/puppyone_sshd_config' \
        'nohup websocat --binary ws-l:0.0.0.0:"$FORWARD_PORT" tcp:127.0.0.1:22 >/tmp/websocat.log 2>&1 &' \
        'echo puppyone-ssh-up' \
        > /usr/local/bin/puppyone-ssh-up \
    && chmod +x /usr/local/bin/puppyone-ssh-up

USER user
