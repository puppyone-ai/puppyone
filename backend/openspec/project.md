# Project Context

## Purpose

Contextbase is a unified platform for ETL and RAG knowledge base management.
Purpose: Enable LLM-driven agents to access a wide range of internal enterprise data more effectively, providing a context data management platform for Agentic RAG workflows.

Goals: Cleanse and structure complex multimodal enterprise data, and offer data access interfaces optimized for large language models.
1. Multimodal ETL Support: Convert and cleanse data provided by enterprise users—including audio, video, images, documents (PDFs, Docs, Markdown), and spreadsheets—into structured data for managed storage.
2. Custom ETL Rules and Algorithms: Allow enterprise users to define custom ETL rules and algorithms to drive the cleansing process for multimodal data.
3. LLM-Friendly Data Access Interfaces: Expose any part of files as an MCP service, providing operations such as create, delete, update, and query, facilitating agent-based management of the knowledge base.

## Tech Stack

- Python 3.12, uv, ruff,
- Web server: FastAPI
- Storage: S3

## Project Conventions

### Code Style

#### Linting Tool

We use `ruff` as our code linting tool. When you need to perform code linting, use the script below:

```bash
#!/bin/sh -e
set -x

ruff check --fix src
ruff format src
```

### Architecture Patterns

Monolithic application architecture, organized into service-based layers:
1. All domain-specific directories are stored in the `src` folder:
   1. `src/` – The top-level of the application, containing common models, configuration, and constants.
   2. `src/main.py` – The root file of the project, used to initialize the FastAPI application.
2. Each package includes its own routes, schemas, models, etc.:
   1. `router.py` – The core of each module, containing all endpoints.
   2. `schemas.py` – For Pydantic models.
   3. `models.py` – For database models.
   4. `service.py` – Module-specific business logic.
   5. `dependencies.py` – Route dependencies.
   6. `constants.py` – Module-specific constants and error codes.
   7. `config.py` – For example, environment variables.
   8. `utils.py` – Non-business logic functions, such as response normalization, data enrichment, etc.
   9. `exceptions.py` – Module-specific exceptions, e.g., `PostNotFound`, `InvalidUserData`.
3. When a package needs services, dependencies, or constants from another package, use explicit module imports.

```python
from src.auth import constants as auth_constants
from src.notifications import service as notification_service
from src.posts.constants import ErrorCode as PostsErrorCode  # In case each package's constants module defines its own standard ErrorCode
```

### Testing Strategy

#### Set Up Asynchronous Test Clients from the Start
Writing integration tests involving the database can easily lead to confusing event loop errors in the future. Avoid this by setting up an asynchronous test client early on, such as httpx.

```python
import pytest
from async_asgi_testclient import TestClient

from src.main import app  # inited FastAPI app

@pytest.fixture
async def client() -> AsyncGenerator[TestClient, None]:
    host, port = "127.0.0.1", "9000"

    async with AsyncClient(transport=ASGITransport(app=app, client=(host, port)), base_url="http://test") as client:
        yield client

@pytest.mark.asyncio
async def test_create_post(client: TestClient):
    resp = await client.post("/posts")

    assert resp.status_code == 201
```

### Git Workflow
[Describe your branching strategy and commit conventions]

## Domain Context
[Add domain-specific knowledge that AI assistants need to understand]

## Important Constraints
[List any technical, business, or regulatory constraints]

- When defining routes, follow RESTful API conventions.
- Extensively use Pydantic and its built-in comprehensive data processing tools, such as regular expressions, enums, string manipulation, email validation, etc.
- To improve maintainability and organization, we should split `BaseSettings` into different modules and domains.

### Dependency Injection

1. Place data validation logic into dependencies.
2. When necessary, use chained dependencies to improve code reusability.
3. We can split dependencies into smaller functions that operate on narrower domains, making them easier to reuse across different routes.
4. Prefer using async dependencies

For Example:
```python
# dependencies.py
from fastapi import BackgroundTasks
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

async def valid_post_id(post_id: UUID4) -> Mapping:
    post = await service.get_by_id(post_id)
    if not post:
        raise PostNotFound()

    return post

async def parse_jwt_data(
    token: str = Depends(OAuth2PasswordBearer(tokenUrl="/auth/token"))
) -> dict:
    try:
        payload = jwt.decode(token, "JWT_SECRET", algorithms=["HS256"])
    except JWTError:
        raise InvalidCredentials()

    return {"user_id": payload["id"]}

async def valid_owned_post(
    post: Mapping = Depends(valid_post_id), 
    token_data: dict = Depends(parse_jwt_data),
) -> Mapping:
    if post["creator_id"] != token_data["user_id"]:
        raise UserNotOwner()

    return post

async def valid_active_creator(
    token_data: dict = Depends(parse_jwt_data),
):
    user = await users_service.get_by_id(token_data["user_id"])
    if not user["is_active"]:
        raise UserIsBanned()
    
    if not user["is_creator"]:
       raise UserNotCreator()
    
    return user
        

# router.py
@router.get("/users/{user_id}/posts/{post_id}", response_model=PostResponse)
async def get_user_post(
    worker: BackgroundTasks,
    post: Mapping = Depends(valid_owned_post),
    user: Mapping = Depends(valid_active_creator),
):
    """Get post that belong the active user."""
    worker.add_task(notifications_service.send_email, user["id"])
    return post
```