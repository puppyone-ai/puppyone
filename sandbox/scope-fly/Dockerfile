# PuppyOne V2 "sandbox as access point" image — Fly.io Machines provider.
#
# A long-lived, scope-keyed dev box a user reaches via VSCode Remote-SSH. Unlike
# E2B (no raw TCP → sshd+websocat tunnel set up at runtime), Fly Machines expose
# a public TCP port natively, so sshd is BAKED INTO THE IMAGE and runs as the
# machine's main process. Per-user keys are added at runtime by the credential
# layer (backend/src/platform/scope_sandbox/ssh_credentials.py) via the Fly
# Machines exec API — no tunnel, no runtime sshd install.
#
# Build & push (see README.md):
#   docker build -t registry.fly.io/<app>:scope-sandbox sandbox/scope-fly
#   fly auth docker && docker push registry.fly.io/<app>:scope-sandbox
# Then set SCOPE_SANDBOX_FLY_IMAGE=registry.fly.io/<app>:scope-sandbox.

FROM debian:trixie-slim

ARG SSH_PORT=2222
ENV DEBIAN_FRONTEND=noninteractive

# sshd + the toolchain "all git/CLI runs inside the box" needs. curl + ca-certs
# let VSCode Remote-SSH download its server; git-lfs for large assets.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssh-server git git-lfs ca-certificates curl sudo \
      python3 procps less nano tini \
 && rm -rf /var/lib/apt/lists/*

# Non-root account VSCode logs in as. Passwordless sudo so in-box provisioning
# (apt, etc.) works the same way it does on the E2B "user" account.
RUN useradd -m -s /bin/bash puppy \
 && echo 'puppy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/puppy \
 && chmod 0440 /etc/sudoers.d/puppy \
 && install -d -m 700 -o puppy -g puppy /home/puppy/.ssh \
 && install -m 600 -o puppy -g puppy /dev/null /home/puppy/.ssh/authorized_keys

# Host keys + privilege-separation dir for sshd.
RUN ssh-keygen -A && mkdir -p /run/sshd

# HARDENED, publickey-ONLY sshd. This is the governance core (#5): the stock
# config accepts other auth methods (and some base images allow the SSH "none"
# method via PAM nullok), which would let ANYONE in regardless of
# authorized_keys and silently defeat per-user credentials. Locking to
# publickey makes access EXACTLY the user's authorized_keys line, so
# grant=add-line, revoke=remove-line, and OpenSSH expiry-time = TTL all hold.
# Debian's main sshd_config has `Include /etc/ssh/sshd_config.d/*.conf` first,
# so this drop-in wins (sshd takes the first value for each keyword).
RUN { \
      echo "Port ${SSH_PORT}"; \
      echo "AuthorizedKeysFile .ssh/authorized_keys"; \
      echo "PubkeyAuthentication yes"; \
      echo "AuthenticationMethods publickey"; \
      echo "PasswordAuthentication no"; \
      echo "PermitEmptyPasswords no"; \
      echo "KbdInteractiveAuthentication no"; \
      echo "ChallengeResponseAuthentication no"; \
      echo "UsePAM no"; \
      echo "PermitRootLogin no"; \
      echo "AllowUsers puppy"; \
    } > /etc/ssh/sshd_config.d/00-puppyone.conf

EXPOSE ${SSH_PORT}

# tini reaps zombies (long-lived box runs many short git/CLI children); sshd -D
# stays in the foreground as the machine's main process, -e logs to stderr so
# auth events land in `fly logs`.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/sbin/sshd", "-D", "-e"]
