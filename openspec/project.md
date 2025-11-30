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

We use `ruff` as our code linting tool. When you need to perform code linting, use the script below:

```bash
#!/bin/sh -e
set -x

ruff check --fix src
ruff format src
```

### Architecture Patterns
[Document your architectural decisions and patterns]

单体应用架构，项目目录如下:

数据流组织: router -> service -> repository

尽量使用依赖注入的方式来

### Testing Strategy
[Explain your testing approach and requirements]

### Git Workflow
[Describe your branching strategy and commit conventions]

## Domain Context
[Add domain-specific knowledge that AI assistants need to understand]

## Important Constraints
[List any technical, business, or regulatory constraints]

## External Dependencies
- MCP server: FastMCP
- Model integration: litellm
- Model support:
  - Text models: deepseek-ai/DeepSeek-V3.2-Exp, MiniMaxAI/MiniMax-M2, moonshotai/Kimi-K2-Thinking, google/gemini-3-pro-preview, anthropic/claude-sonnet-4.5, openai/gpt-5-mini
  - OCR models: DeepSeek-OCR, PaddleOCR-VL-0.9B
  - Vision-language model: qwen/qwen3-vl-235b-a22b-instruct
  - Audio model: mistralai/voxtral-small-24b-2507
