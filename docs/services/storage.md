# PuppyStorage

- Port: 8002
- Entrypoint: `python -m server.storage_server`
- Health: `/health`

Start (local)
```bash
cd PuppyStorage
cp -n .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m server.storage_server
```

Key env
- DEPLOYMENT_TYPE=local
- LOCAL_STORAGE_PATH=./local_storage
- Cloudflare R2 vars required if DEPLOYMENT_TYPE=remote
