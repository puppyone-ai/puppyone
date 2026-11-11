FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap git iproute2 procps python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /desktop
RUN npm init -y >/dev/null && npm install --no-audit --no-fund node-pty@1.1.0 ssh2@1.17.0 \
 && node -e 'const p=require("./package.json"); p.type="module"; require("fs").writeFileSync("package.json", JSON.stringify(p))'
RUN useradd -m -s /bin/bash test
USER test
WORKDIR /home/test
CMD ["sleep", "infinity"]
