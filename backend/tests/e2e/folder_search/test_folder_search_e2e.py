"""
Folder Search E2E Test

在真实的 Turbopuffer 上测试 folder search 功能。
测试完成后不删除数据，方便后续检查。

运行方式（使用 uv）：
    uv run pytest tests/e2e/folder_search/test_folder_search_e2e.py -v -s

环境变量要求：
    - TURBOPUFFER_API_KEY
    - OPENROUTER_API_KEY 或 DEFAULT_EMBEDDING_MODEL 相关配置
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from dotenv import load_dotenv

from src.llm.embedding_service import EmbeddingService
from src.turbopuffer.config import TurbopufferConfig
from src.turbopuffer.service import TurbopufferSearchService
from tests.e2e._reporter import E2EReporter


def _utc_ts_compact() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _make_namespace(prefix: str = "e2e-folder-search-") -> str:
    """生成符合 turbopuffer namespace 约束的名称"""
    return f"{prefix}{_utc_ts_compact()}-{uuid4().hex[:8]}"


@pytest.mark.e2e
def test_folder_search_e2e_with_real_turbopuffer() -> None:
    """
    Folder Search E2E 测试：
    1. 创建模拟的 folder 数据（多个文件的 chunks）
    2. 生成真实的 embeddings
    3. 写入 Turbopuffer
    4. 执行搜索并验证结果包含文件路径信息
    5. 不删除 namespace（保留数据供后续检查）
    """

    report = E2EReporter(suite_name="folder-search-e2e")

    # 加载 .env
    project_root = Path(__file__).resolve().parents[3]  # backend/
    env_path = project_root / ".env"
    loaded_env = False
    if env_path.exists():
        loaded_env = load_dotenv(dotenv_path=env_path, override=False)
        report.log_ok(
            "dotenv.load",
            details={"env_path": str(env_path), "loaded": bool(loaded_env)},
        )
    else:
        report.log_ok(
            "dotenv.load",
            details={"env_path": str(env_path), "loaded": False, "note": ".env not found"},
        )

    # 检查 Turbopuffer 配置
    cfg = TurbopufferConfig()
    if not cfg.configured:
        report.log_ok(
            "skip.missing_turbopuffer_api_key",
            details={
                "reason": "TURBOPUFFER_API_KEY is not set",
                "dotenv_loaded": bool(loaded_env),
            },
        )
        report.finalize(summary={"skipped": True})
        pytest.skip("未检测到 TURBOPUFFER_API_KEY，跳过 folder search e2e 测试")

    # 初始化服务
    svc = TurbopufferSearchService(config=cfg)
    embedding_svc = EmbeddingService()

    namespace = _make_namespace()
    report.log_ok(
        "env.configured",
        details={"region": cfg.region, "namespace": namespace},
    )

    # 模拟 folder 结构：
    # /project-folder/
    #   ├── readme.md (markdown)
    #   ├── data.json (json)
    #   └── notes.md (markdown)

    folder_node_id = "folder-" + uuid4().hex[:8]
    project_id = "proj-" + uuid4().hex[:8]

    # 模拟文件内容
    files = [
        {
            "file_node_id": "file-readme-" + uuid4().hex[:6],
            "file_id_path": f"/{folder_node_id}/readme-{uuid4().hex[:4]}",
            "file_name": "readme.md",
            "file_type": "markdown",
            "chunks": [
                {
                    "text": "# Project Overview\n\nThis is a sample project for testing folder search functionality. "
                            "The project demonstrates how to index multiple files within a folder and search across them.",
                    "json_pointer": "/",
                    "chunk_index": 0,
                },
                {
                    "text": "## Features\n\n- Supports JSON and Markdown files\n- Preserves file path information\n"
                            "- Uses vector embeddings for semantic search\n- Returns file location for easy navigation",
                    "json_pointer": "/",
                    "chunk_index": 1,
                },
            ],
        },
        {
            "file_node_id": "file-data-" + uuid4().hex[:6],
            "file_id_path": f"/{folder_node_id}/data-{uuid4().hex[:4]}",
            "file_name": "data.json",
            "file_type": "json",
            "chunks": [
                {
                    "text": "The configuration contains API endpoints for user authentication. "
                            "Users can login with email and password. The JWT token expires in 24 hours.",
                    "json_pointer": "/config/auth",
                    "chunk_index": 0,
                },
                {
                    "text": "Database settings include connection pooling with max 20 connections. "
                            "The primary database is PostgreSQL running on port 5432.",
                    "json_pointer": "/config/database",
                    "chunk_index": 0,
                },
            ],
        },
        {
            "file_node_id": "file-notes-" + uuid4().hex[:6],
            "file_id_path": f"/{folder_node_id}/notes-{uuid4().hex[:4]}",
            "file_name": "notes.md",
            "file_type": "markdown",
            "chunks": [
                {
                    "text": "# Development Notes\n\nRemember to update the embedding model when switching environments. "
                            "The current model uses 4096 dimensions which is optimized for semantic search.",
                    "json_pointer": "/",
                    "chunk_index": 0,
                },
            ],
        },
    ]

    # 收集所有 chunks 的文本
    all_texts = []
    chunk_metadata = []
    for file in files:
        for chunk in file["chunks"]:
            all_texts.append(chunk["text"])
            chunk_metadata.append({
                "file_node_id": file["file_node_id"],
                "file_id_path": file["file_id_path"],
                "file_name": file["file_name"],
                "file_type": file["file_type"],
                "json_pointer": chunk["json_pointer"],
                "chunk_index": chunk["chunk_index"],
                "total_chunks": len(file["chunks"]),
            })

    report.log_ok(
        "data.prepared",
        details={
            "total_files": len(files),
            "total_chunks": len(all_texts),
            "folder_node_id": folder_node_id,
        },
    )

    # 生成 embeddings
    try:
        print(f"\n生成 {len(all_texts)} 个 chunks 的 embeddings...")
        vectors = asyncio.run(embedding_svc.generate_embeddings_batch(all_texts))
        report.log_ok(
            "embedding.generated",
            details={
                "count": len(vectors),
                "dimensions": len(vectors[0]) if vectors else 0,
            },
        )
        print(f"生成完成，向量维度: {len(vectors[0]) if vectors else 0}")
    except Exception as e:
        report.log_fail("embedding.generated", exc=e)
        report.finalize(summary={"error": str(e)})
        raise

    # 构建写入数据
    upsert_rows = []
    for i, (text, meta, vec) in enumerate(zip(all_texts, chunk_metadata, vectors)):
        doc_id = f"{meta['file_node_id'][:12]}_{i}_{uuid4().hex[:6]}"
        upsert_rows.append({
            "id": doc_id,
            "vector": vec,
            # Chunk 信息
            "chunk_text": text,  # 这里为了测试保存，实际生产中不存
            "json_pointer": meta["json_pointer"],
            "chunk_index": meta["chunk_index"],
            "total_chunks": meta["total_chunks"],
            "content_hash": f"hash-{i}",
            "chunk_id": i + 1,
            # 文件路径信息
            "file_node_id": meta["file_node_id"],
            "file_id_path": meta["file_id_path"],
            "file_name": meta["file_name"],
            "file_type": meta["file_type"],
        })

    # 写入 Turbopuffer
    try:
        print(f"\n写入 {len(upsert_rows)} 条数据到 namespace: {namespace}...")
        write_resp = asyncio.run(
            svc.write(
                namespace,
                upsert_rows=upsert_rows,
                distance_metric="cosine_distance",
            )
        )
        report.log_ok(
            "turbopuffer.write",
            details={"namespace": namespace, "rows": len(upsert_rows)},
            data=write_resp.model_dump(),
        )
        print(f"写入完成: {write_resp.model_dump()}")
    except Exception as e:
        report.log_fail("turbopuffer.write", exc=e)
        report.finalize(summary={"error": str(e)})
        raise

    # 执行搜索测试
    search_queries = [
        ("authentication login JWT", "应该找到 data.json 中的 auth 配置"),
        ("semantic search embedding model", "应该找到 notes.md 中的开发笔记"),
        ("project overview features", "应该找到 readme.md 中的项目介绍"),
        ("PostgreSQL database connection", "应该找到 data.json 中的数据库配置"),
    ]

    for query, expected_desc in search_queries:
        try:
            print(f"\n搜索: '{query}'")
            print(f"预期: {expected_desc}")

            # 生成查询向量
            query_vec = asyncio.run(embedding_svc.generate_embedding(query))

            # 执行搜索
            result = asyncio.run(
                svc.query(
                    namespace,
                    rank_by=("vector", "ANN", query_vec),
                    top_k=3,
                    include_attributes=True,
                )
            )

            # 打印结果
            print(f"结果 ({len(result.rows)} 条):")
            for j, row in enumerate(result.rows):
                attrs = row.attributes or {}
                print(f"  [{j+1}] score={row.score or row.distance}")
                print(f"      file: {attrs.get('file_name')} ({attrs.get('file_type')})")
                print(f"      path: {attrs.get('file_id_path')}")
                print(f"      pointer: {attrs.get('json_pointer')}")
                if attrs.get('chunk_text'):
                    text_preview = attrs.get('chunk_text', '')[:100]
                    print(f"      text: {text_preview}...")

            report.log_ok(
                f"search.query.{query[:20].replace(' ', '_')}",
                details={
                    "query": query,
                    "expected": expected_desc,
                    "results_count": len(result.rows),
                },
                data={
                    "rows": [
                        {
                            "id": r.id,
                            "score": r.score,
                            "distance": r.distance,
                            "file_name": (r.attributes or {}).get("file_name"),
                            "file_type": (r.attributes or {}).get("file_type"),
                            "file_id_path": (r.attributes or {}).get("file_id_path"),
                        }
                        for r in result.rows
                    ]
                },
            )

            # 验证结果包含文件路径信息
            assert result.rows, f"搜索 '{query}' 无结果"
            top_result = result.rows[0]
            attrs = top_result.attributes or {}
            assert attrs.get("file_node_id"), "结果缺少 file_node_id"
            assert attrs.get("file_id_path"), "结果缺少 file_id_path"
            assert attrs.get("file_name"), "结果缺少 file_name"
            assert attrs.get("file_type"), "结果缺少 file_type"

        except Exception as e:
            report.log_fail(f"search.query.{query[:20].replace(' ', '_')}", exc=e)
            raise

    # 获取 namespace metadata
    try:
        meta = asyncio.run(svc.metadata(namespace))
        report.log_ok("namespace.metadata", data=meta)
        # 注意：meta 可能包含 datetime 对象，需要特殊处理
        print(f"\nNamespace metadata keys: {list(meta.keys())}")
    except Exception as e:
        report.log_fail("namespace.metadata", exc=e)

    # 保存 namespace 信息供后续查看
    last_ns_path = Path(__file__).with_name(".last_folder_search_namespace.json")
    try:
        payload = {
            "namespace": namespace,
            "region": cfg.region,
            "project_id": project_id,
            "folder_node_id": folder_node_id,
            "files": [
                {
                    "file_node_id": f["file_node_id"],
                    "file_name": f["file_name"],
                    "file_type": f["file_type"],
                    "chunks_count": len(f["chunks"]),
                }
                for f in files
            ],
            "total_chunks": len(all_texts),
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
        }
        last_ns_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        report.log_ok(
            "namespace.persist",
            details={"path": str(last_ns_path), "namespace": namespace},
        )
        print(f"\n✅ Namespace 信息已保存到: {last_ns_path}")
    except Exception as e:
        report.log_fail("namespace.persist", exc=e)

    # 完成报告
    report.finalize(
        summary={
            "namespace": namespace,
            "project_id": project_id,
            "folder_node_id": folder_node_id,
            "total_files": len(files),
            "total_chunks": len(all_texts),
            "deleted": False,
            "note": "数据已保留，可通过 Turbopuffer 控制台查看",
        }
    )

    print("\n" + "=" * 60)
    print("✅ Folder Search E2E 测试完成!")
    print(f"   Namespace: {namespace}")
    print(f"   Region: {cfg.region}")
    print(f"   Files: {len(files)}")
    print(f"   Chunks: {len(all_texts)}")
    print("=" * 60)
    print("\n数据已保留在 Turbopuffer，你可以：")
    print(f"1. 通过 Turbopuffer 控制台查看 namespace: {namespace}")
    print(f"2. 使用以下代码查询数据：")
    print(f"""
    from src.turbopuffer.service import TurbopufferSearchService
    from src.turbopuffer.config import TurbopufferConfig
    import asyncio

    svc = TurbopufferSearchService()
    result = asyncio.run(svc.query(
        "{namespace}",
        rank_by=("id", "asc"),
        top_k=10,
        include_attributes=True,
    ))
    for r in result.rows:
        print(r.id, r.attributes)
    """)
