FROM docker:28-cli AS docker-cli

FROM python:3.12-slim AS base

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .
RUN uv sync --frozen

EXPOSE 9090

CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "9090"]
