# Configuration (Environment Variables)

Use `.env` files in each package during local development. Do not commit real secrets.

General rules
- `.env.example` shows supported variables with safe defaults
- `.env` overrides are local-only (gitignored)
- OS environment variables override `.env`

PuppyEngine (8001)
- DEPLOYMENT_TYPE: local | remote (default: local)
- USER_SYSTEM_URL: user system backend (default: http://localhost:8000)
- STORAGE_SERVER_URL: storage backend (default: http://localhost:8002)
- SERVICE_KEY: optional S2S key
- LLM providers (optional): OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_CHAT_URL, DEEPBRICKS_API_KEY, DEEPBRICKS_BASE_URL, HUGGINGFACE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY
- Search (optional): GCP_API_KEY, CSE_ID, FIRECRAWL_API_KEY, PERPLEXITY_API_KEY, PERPLEXITY_BASE_URL, ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY
- Observability (optional): AXIOM_TOKEN, AXIOM_ORG_ID, AXIOM_DATASET

PuppyStorage (8002)
- DEPLOYMENT_TYPE: local | remote (default: local)
- LOCAL_STORAGE_PATH: local path for files (default: ./local_storage)
- Cloudflare R2 (remote): CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET
- Vector DB (optional): SUPABASE_URL, PINECONE_API_KEY
- Embeddings (optional): OPENAI_API_KEY
- Observability (optional): AXIOM_TOKEN, AXIOM_ORG_ID, AXIOM_DATASET

PuppyFlow (4000)
- USER_SYSTEM_BACKEND: http://localhost:8000
- PUPPYENGINE_URL: http://localhost:8001
- PUPPYSTORAGE_URL: http://localhost:8002
- API_SERVER_URL: http://localhost:8004
- SERVICE_KEY: optional S2S key (server-only)
- NEXT_PUBLIC_FRONTEND_VERSION: 0.1.0

Notes
- For LLM via Ollama, ensure Ollama runs at http://localhost:11434
- For local dev, most variables have safe defaults; only set providers if you use those features
