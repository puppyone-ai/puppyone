## E2E 测试报告：folder-search-e2e

- **run_id**: `2026-01-27T12:57:42Z`
- **generated_at**: `2026-01-27T12:57:42Z`

### 结果明细

#### ✅ PASS `dotenv.load`

- **time**: `2026-01-27T12:57:42Z`

**details**

```json
{
  "env_path": "/Volumes/Portable/puppy-agents-workspace/PuppyContext/backend/.env",
  "loaded": true
}
```

#### ✅ PASS `env.configured`

- **time**: `2026-01-27T12:57:42Z`

**details**

```json
{
  "region": "gcp-us-central1",
  "namespace": "e2e-folder-search-20260127-125742-6d936ea9"
}
```

#### ✅ PASS `data.prepared`

- **time**: `2026-01-27T12:57:42Z`

**details**

```json
{
  "total_files": 3,
  "total_chunks": 5,
  "folder_node_id": "folder-324d62d3"
}
```

#### ✅ PASS `embedding.generated`

- **time**: `2026-01-27T12:57:51Z`

**details**

```json
{
  "count": 5,
  "dimensions": 4096
}
```

#### ✅ PASS `turbopuffer.write`

- **time**: `2026-01-27T12:57:54Z`

**details**

```json
{
  "namespace": "e2e-folder-search-20260127-125742-6d936ea9",
  "rows": 5
}
```

**data**

```json
{
  "kind": "write",
  "rows_affected": 5,
  "rows_upserted": 5,
  "rows_patched": null,
  "rows_deleted": null,
  "rows_remaining": null,
  "billing": {
    "billable_logical_bytes_written": 83284,
    "query": null
  }
}
```

#### ✅ PASS `search.query.authentication_login`

- **time**: `2026-01-27T12:57:57Z`

**details**

```json
{
  "query": "authentication login JWT",
  "expected": "应该找到 data.json 中的 auth 配置",
  "results_count": 3
}
```

**data**

```json
{
  "rows": [
    {
      "id": "file-data-68_2_2c1f1e",
      "score": null,
      "distance": 0.19275701,
      "file_name": "data.json",
      "file_type": "json",
      "file_id_path": "/folder-324d62d3/data-7424"
    },
    {
      "id": "file-readme-_1_b97aaf",
      "score": null,
      "distance": 0.53202116,
      "file_name": "readme.md",
      "file_type": "markdown",
      "file_id_path": "/folder-324d62d3/readme-1887"
    },
    {
      "id": "file-data-68_3_6788eb",
      "score": null,
      "distance": 0.6808721,
      "file_name": "data.json",
      "file_type": "json",
      "file_id_path": "/folder-324d62d3/data-7424"
    }
  ]
}
```

#### ✅ PASS `search.query.semantic_search_embe`

- **time**: `2026-01-27T12:57:59Z`

**details**

```json
{
  "query": "semantic search embedding model",
  "expected": "应该找到 notes.md 中的开发笔记",
  "results_count": 3
}
```

**data**

```json
{
  "rows": [
    {
      "id": "file-readme-_1_b97aaf",
      "score": null,
      "distance": 0.30669415,
      "file_name": "readme.md",
      "file_type": "markdown",
      "file_id_path": "/folder-324d62d3/readme-1887"
    },
    {
      "id": "file-notes-7_4_23755b",
      "score": null,
      "distance": 0.38212067,
      "file_name": "notes.md",
      "file_type": "markdown",
      "file_id_path": "/folder-324d62d3/notes-cdec"
    },
    {
      "id": "file-readme-_0_f24168",
      "score": null,
      "distance": 0.5440682,
      "file_name": "readme.md",
      "file_type": "markdown",
      "file_id_path": "/folder-324d62d3/readme-1887"
    }
  ]
}
```

#### ✅ PASS `search.query.project_overview_fea`

- **time**: `2026-01-27T12:58:01Z`

**details**

```json
{
  "query": "project overview features",
  "expected": "应该找到 readme.md 中的项目介绍",
  "results_count": 3
}
```

**data**

```json
{
  "rows": [
    {
      "id": "file-readme-_1_b97aaf",
      "score": null,
      "distance": 0.38799137,
      "file_name": "readme.md",
      "file_type": "markdown",
      "file_id_path": "/folder-324d62d3/readme-1887"
    },
    {
      "id": "file-readme-_0_f24168",
      "score": null,
      "distance": 0.47757673,
      "file_name": "readme.md",
      "file_type": "markdown",
      "file_id_path": "/folder-324d62d3/readme-1887"
    },
    {
      "id": "file-data-68_2_2c1f1e",
      "score": null,
      "distance": 0.49013364,
      "file_name": "data.json",
      "file_type": "json",
      "file_id_path": "/folder-324d62d3/data-7424"
    }
  ]
}
```

#### ✅ PASS `search.query.PostgreSQL_database_`

- **time**: `2026-01-27T12:58:03Z`

**details**

```json
{
  "query": "PostgreSQL database connection",
  "expected": "应该找到 data.json 中的数据库配置",
  "results_count": 3
}
```

**data**

```json
{
  "rows": [
    {
      "id": "file-data-68_3_6788eb",
      "score": null,
      "distance": 0.23346722,
      "file_name": "data.json",
      "file_type": "json",
      "file_id_path": "/folder-324d62d3/data-7424"
    },
    {
      "id": "file-data-68_2_2c1f1e",
      "score": null,
      "distance": 0.56526995,
      "file_name": "data.json",
      "file_type": "json",
      "file_id_path": "/folder-324d62d3/data-7424"
    },
    {
      "id": "file-readme-_1_b97aaf",
      "score": null,
      "distance": 0.59981,
      "file_name": "readme.md",
      "file_type": "markdown",
      "file_id_path": "/folder-324d62d3/readme-1887"
    }
  ]
}
```

#### ✅ PASS `namespace.metadata`

- **time**: `2026-01-27T12:58:03Z`

**data**

```json
{
  "approx_logical_bytes": 0,
  "approx_row_count": 0,
  "created_at": "2026-01-27 12:57:54.567586+00:00",
  "encryption": {
    "sse": true
  },
  "index": {
    "status": "up-to-date"
  },
  "schema_": {
    "chunk_text": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "content_hash": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "chunk_id": {
      "type": "int",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "file_type": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "json_pointer": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "chunk_index": {
      "type": "int",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "total_chunks": {
      "type": "int",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "id": {
      "type": "string",
      "ann": null,
      "filterable": null,
      "full_text_search": null,
      "regex": null
    },
    "file_node_id": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "vector": {
      "type": "[4096]f32",
      "ann": {
        "distance_metric": "cosine_distance"
      },
      "filterable": null,
      "full_text_search": null,
      "regex": null
    },
    "file_id_path": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "file_name": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    }
  },
  "updated_at": "2026-01-27 12:57:54.567586+00:00",
  "schema": {
    "chunk_text": {
      "type": "string",
      "filterable": true
    },
    "content_hash": {
      "type": "string",
      "filterable": true
    },
    "chunk_id": {
      "type": "int",
      "filterable": true
    },
    "file_type": {
      "type": "string",
      "filterable": true
    },
    "json_pointer": {
      "type": "string",
      "filterable": true
    },
    "chunk_index": {
      "type": "int",
      "filterable": true
    },
    "total_chunks": {
      "type": "int",
      "filterable": true
    },
    "id": {
      "type": "string"
    },
    "file_node_id": {
      "type": "string",
      "filterable": true
    },
    "vector": {
      "type": "[4096]f32",
      "ann": {
        "distance_metric": "cosine_distance"
      }
    },
    "file_id_path": {
      "type": "string",
      "filterable": true
    },
    "file_name": {
      "type": "string",
      "filterable": true
    }
  }
}
```

#### ❌ FAIL `namespace.metadata`

- **time**: `2026-01-27T12:58:03Z`

**exception**

```text
Traceback (most recent call last):
  File "/Volumes/Portable/puppy-agents-workspace/PuppyContext/backend/tests/e2e/folder_search/test_folder_search_e2e.py", line 322, in test_folder_search_e2e_with_real_turbopuffer
    print(f"\nNamespace metadata: {json.dumps(meta, indent=2)}")
                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/opt/homebrew/anaconda3/lib/python3.12/json/__init__.py", line 238, in dumps
    **kw).encode(obj)
          ^^^^^^^^^^^
  File "/opt/homebrew/anaconda3/lib/python3.12/json/encoder.py", line 202, in encode
    chunks = list(chunks)
             ^^^^^^^^^^^^
  File "/opt/homebrew/anaconda3/lib/python3.12/json/encoder.py", line 432, in _iterencode
    yield from _iterencode_dict(o, _current_indent_level)
  File "/opt/homebrew/anaconda3/lib/python3.12/json/encoder.py", line 406, in _iterencode_dict
    yield from chunks
  File "/opt/homebrew/anaconda3/lib/python3.12/json/encoder.py", line 439, in _iterencode
    o = _default(o)
        ^^^^^^^^^^^
  File "/opt/homebrew/anaconda3/lib/python3.12/json/encoder.py", line 180, in default
    raise TypeError(f'Object of type {o.__class__.__name__} '
TypeError: Object of type datetime is not JSON serializable

```

#### ✅ PASS `namespace.persist`

- **time**: `2026-01-27T12:58:03Z`

**details**

```json
{
  "path": "/Volumes/Portable/puppy-agents-workspace/PuppyContext/backend/tests/e2e/folder_search/.last_folder_search_namespace.json",
  "namespace": "e2e-folder-search-20260127-125742-6d936ea9"
}
```

### 汇总

```json
{
  "namespace": "e2e-folder-search-20260127-125742-6d936ea9",
  "project_id": "proj-db2d46b0",
  "folder_node_id": "folder-324d62d3",
  "total_files": 3,
  "total_chunks": 5,
  "deleted": false,
  "note": "数据已保留，可通过 Turbopuffer 控制台查看"
}
```

