# PuppyEngine

- Port: 8001
- Entrypoint: `python -m Server.EngineServer`
- Health: `/health`

Start (local)
```bash
cd PuppyEngine
cp -n .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m Server.EngineServer
```

Key env
- DEPLOYMENT_TYPE=local
- STORAGE_SERVER_URL=http://localhost:8002
- USER_SYSTEM_URL=http://localhost:8000 (optional for local)
