#!/usr/bin/env bash
set -euo pipefail

# Hosted Ubuntu's Azure mirror can fail DNS for an entire runner pool. Keep
# signed Ubuntu packages, using the official primary mirrors directly.
if [ -f /etc/apt/apt-mirrors.txt ]; then
  printf '%s\n' 'https://archive.ubuntu.com/ubuntu' | sudo tee /etc/apt/apt-mirrors.txt > /dev/null
fi
if [ -f /etc/apt/apt-mirrors-security.txt ]; then
  printf '%s\n' 'https://security.ubuntu.com/ubuntu' | sudo tee /etc/apt/apt-mirrors-security.txt > /dev/null
fi
printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' \
  | sudo tee /etc/apt/apt.conf.d/80puppyone-ci-network > /dev/null
