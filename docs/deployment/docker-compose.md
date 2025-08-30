# Docker Compose

License reminder
- The compose stack is for personal or internal single-tenant use under SUL
- Do not operate as a managed/hosted multi-tenant service to third parties without a commercial license
- See LICENSE for details; contact guantum@puppyagent.com for commercial rights

A compose file is provided at the repo root.

Start all services:
```bash
docker compose up --build
```

Services
- storage
  - Image: built from `PuppyStorage/Dockerfile`
  - Port: 8002
  - Env: DEPLOYMENT_TYPE=local by default; pass Cloudflare R2 envs for remote
- engine
  - Image: built from `PuppyEngine/Dockerfile`
  - Port: 8001
  - Env: STORAGE_SERVER_URL=http://storage:8002; USER_SYSTEM_URL uses host.docker.internal
- flow
  - Image: node:18-alpine (bind mounts project)
  - Port: 4000
  - Env: PUPPYENGINE_URL=http://engine:8001, PUPPYSTORAGE_URL=http://storage:8002

Override variables
```bash
# Example: set OpenRouter API key at runtime
docker compose run -e OPENROUTER_API_KEY=sk-... engine
```

Common tips
- If you need hot reload in flow, code is mounted; changes reflect live
- For host services (e.g., user system at 8000), use `host.docker.internal`
- Check container logs with `docker compose logs -f <service>`
