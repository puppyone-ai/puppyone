# Getting Started

This guide helps you run PuppyAgent locally.

Prerequisites
- Python 3.10+
- Node.js 18+ and npm
- macOS, Linux, or WSL2 on Windows

Repo layout (top-level)
- PuppyEngine/: FastAPI-based engine (port 8001)
- PuppyStorage/: storage and vector services (port 8002)
- PuppyFlow/: Next.js frontend (port 4000)
- scripts/: tooling (run-all, formatters)

Option A) One-click startup (recommended)
```bash
./scripts/run-all.sh
```
The script will:
- Copy .env.example → .env for each service if missing (you can edit later)
- Create virtualenvs and install Python deps for Engine/Storage
- Install frontend deps and start the Next.js dev server
- Launch services on ports 8001/8002/4000

Option B) Manual startup
- Storage
```bash
cd PuppyStorage
cp -n .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m server.storage_server
```
- Engine
```bash
cd PuppyEngine
cp -n .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m Server.EngineServer
```
- Frontend
```bash
cd PuppyFlow
cp -n .env.example .env
npm install
npm run dev
```

Docker Compose
```bash
docker compose up --build
```
- Ports: storage 8002, engine 8001, flow 4000
- Host service references use host.docker.internal when needed

Troubleshooting
- Port conflicts: change ports via env or stop other services
- Missing env: ensure .env exists or export variables in your shell
- Node modules: delete PuppyFlow/node_modules and reinstall
- Python venv: recreate .venv and reinstall requirements
