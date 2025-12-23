set -a
source .env
set +a

uv run arq src.etl.jobs.worker.WorkerSettings