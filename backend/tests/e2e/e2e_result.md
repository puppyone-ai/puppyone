## E2E 测试报告：turbopuffer-e2e

- **run_id**: `2026-01-11T11:17:52Z`
- **generated_at**: `2026-01-11T11:17:52Z`

### 结果明细

#### ✅ PASS `dotenv.load`

- **time**: `2026-01-11T11:17:52Z`

**details**

```json
{
  "env_path": "/Volumes/Portable/puppy-agents-workspace/PuppyContext/backend/.env",
  "loaded": true
}
```

#### ✅ PASS `env.configured`

- **time**: `2026-01-11T11:17:52Z`

**details**

```json
{
  "region": "gcp-us-central1",
  "namespace": "e2e-tpuf-20260111-111752-9fbf392f"
}
```

#### ✅ PASS `namespace.precleanup`

- **time**: `2026-01-11T11:18:03Z`

#### ✅ PASS `write.upsert_rows`

- **time**: `2026-01-11T11:18:03Z`

**details**

```json
{
  "rows": [
    "doc-0",
    "doc-1",
    "doc-2",
    "doc-3"
  ]
}
```

**data**

```json
{
  "kind": "write",
  "rows_affected": 4,
  "rows_upserted": 4,
  "rows_patched": null,
  "rows_deleted": null,
  "rows_remaining": null,
  "billing": {
    "billable_logical_bytes_written": 343,
    "query": null
  }
}
```

#### ✅ PASS `namespace.metadata`

- **time**: `2026-01-11T11:18:03Z`

**data**

```json
{
  "approx_logical_bytes": 0,
  "approx_row_count": 0,
  "created_at": "2026-01-11 11:18:05.395349+00:00",
  "encryption": {
    "sse": true
  },
  "index": {
    "status": "up-to-date"
  },
  "schema_": {
    "title": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "views": {
      "type": "int",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    },
    "category": {
      "type": "string",
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
    "vector": {
      "type": "[2]f32",
      "ann": {
        "distance_metric": "cosine_distance"
      },
      "filterable": null,
      "full_text_search": null,
      "regex": null
    },
    "content": {
      "type": "string",
      "ann": null,
      "filterable": false,
      "full_text_search": {
        "ascii_folding": false,
        "b": 0.75,
        "case_sensitive": false,
        "k1": 1.2,
        "language": "english",
        "max_token_length": 39,
        "remove_stopwords": true,
        "stemming": false,
        "tokenizer": "word_v3"
      },
      "regex": null
    },
    "status": {
      "type": "string",
      "ann": null,
      "filterable": true,
      "full_text_search": null,
      "regex": null
    }
  },
  "updated_at": "2026-01-11 11:18:05.395349+00:00",
  "schema": {
    "title": {
      "type": "string",
      "filterable": true
    },
    "views": {
      "type": "int",
      "filterable": true
    },
    "category": {
      "type": "string",
      "filterable": true
    },
    "id": {
      "type": "string"
    },
    "vector": {
      "type": "[2]f32",
      "ann": {
        "distance_metric": "cosine_distance"
      }
    },
    "content": {
      "type": "string",
      "filterable": false,
      "full_text_search": {
        "k1": 1.2,
        "b": 0.75,
        "ascii_folding": false,
        "case_sensitive": false,
        "language": "english",
        "stemming": false,
        "remove_stopwords": true,
        "tokenizer": "word_v3",
        "max_token_length": 39
      }
    },
    "status": {
      "type": "string",
      "filterable": true
    }
  }
}
```

#### ✅ PASS `namespace.hint_cache_warm`

- **time**: `2026-01-11T11:18:04Z`

**data**

```json
{
  "status": "ACCEPTED",
  "message": "cache warm hint accepted"
}
```

#### ✅ PASS `query.vector.ANN`

- **time**: `2026-01-11T11:18:04Z`

**data**

```json
{
  "rows": [
    {
      "id": "doc-0",
      "distance": 0.0,
      "attributes": {
        "category": "animal",
        "content": "The quick brown fox jumps over the lazy dog.",
        "status": "published",
        "title": "fox-0",
        "views": 10
      }
    },
    {
      "id": "doc-1",
      "distance": 0.006116271,
      "attributes": {
        "category": "animal",
        "content": "A quick red fox runs through the forest.",
        "status": "published",
        "title": "fox-1",
        "views": 50
      }
    },
    {
      "id": "doc-3",
      "distance": 0.88956845,
      "attributes": {
        "category": "food",
        "content": "Banana smoothies are tasty and easy to make.",
        "status": "published",
        "title": "fruit-1",
        "views": 5
      }
    }
  ]
}
```

#### ✅ PASS `query.full_text.BM25`

- **time**: `2026-01-11T11:18:04Z`

**data**

```json
{
  "rows": [
    {
      "id": "doc-1",
      "distance": 1.5098256,
      "attributes": {
        "category": "animal",
        "content": "A quick red fox runs through the forest.",
        "title": "fox-1"
      }
    },
    {
      "id": "doc-0",
      "distance": 1.4251626,
      "attributes": {
        "category": "animal",
        "content": "The quick brown fox jumps over the lazy dog.",
        "title": "fox-0"
      }
    }
  ]
}
```

#### ✅ PASS `query.hybrid.multi_query.rrf`

- **time**: `2026-01-11T11:18:04Z`

**data**

```json
{
  "subquery_vector_ids": [
    "doc-0",
    "doc-1",
    "doc-3"
  ],
  "subquery_bm25_ids": [
    "doc-1",
    "doc-0"
  ],
  "rrf_ranked_ids": [
    "doc-0",
    "doc-1",
    "doc-3"
  ]
}
```

#### ✅ PASS `query.filters.lookup`

- **time**: `2026-01-11T11:18:05Z`

**data**

```json
{
  "rows": [
    {
      "id": "doc-2",
      "attributes": {
        "category": "food",
        "title": "fruit-0",
        "views": 2500
      }
    },
    {
      "id": "doc-3",
      "attributes": {
        "category": "food",
        "title": "fruit-1",
        "views": 5
      }
    }
  ]
}
```

#### ✅ PASS `query.aggregations.count`

- **time**: `2026-01-11T11:18:05Z`

**data**

```json
{
  "rows": [],
  "aggregations": {
    "my_count": 4
  },
  "aggregation_groups": null,
  "billing": {
    "billable_logical_bytes_queried": 256000000,
    "billable_logical_bytes_returned": 16
  },
  "performance": {
    "client_total_ms": 251.7303330823779,
    "client_compress_ms": 0.0,
    "client_response_ms": 250.71029108949006,
    "client_body_read_ms": 0.19454210996627808,
    "client_deserialize_ms": 0.5955828819423914,
    "approx_namespace_size": 4,
    "cache_hit_ratio": 1.0,
    "cache_temperature": "hot",
    "exhaustive_search_count": 4,
    "query_execution_ms": 8,
    "server_total_ms": 8
  },
  "kind": "query"
}
```

#### ✅ PASS `query.aggregations.group_by`

- **time**: `2026-01-11T11:18:05Z`

**data**

```json
{
  "rows": [],
  "aggregations": null,
  "aggregation_groups": [
    {
      "category": "animal",
      "count_by_category": 2
    },
    {
      "category": "food",
      "count_by_category": 2
    }
  ],
  "billing": {
    "billable_logical_bytes_queried": 256000000,
    "billable_logical_bytes_returned": 42
  },
  "performance": {
    "client_total_ms": 266.4875420741737,
    "client_compress_ms": 0.0,
    "client_response_ms": 266.10029209405184,
    "client_body_read_ms": 0.07429183460772038,
    "client_deserialize_ms": 0.23304205387830734,
    "approx_namespace_size": 4,
    "cache_hit_ratio": 1.0,
    "cache_temperature": "hot",
    "exhaustive_search_count": 4,
    "query_execution_ms": 11,
    "server_total_ms": 11
  },
  "kind": "query"
}
```

#### ✅ PASS `write.patch_by_filter`

- **time**: `2026-01-11T11:18:06Z`

**data**

```json
{
  "kind": "write",
  "rows_affected": 3,
  "rows_upserted": null,
  "rows_patched": 3,
  "rows_deleted": null,
  "rows_remaining": null,
  "billing": {
    "billable_logical_bytes_written": 39,
    "query": {
      "billable_logical_bytes_queried": 512000000,
      "billable_logical_bytes_returned": 266
    }
  }
}
```

#### ✅ PASS `verify.patch_by_filter`

- **time**: `2026-01-11T11:18:06Z`

**data**

```json
{
  "archived_ids": [
    "doc-0",
    "doc-1",
    "doc-3"
  ]
}
```

#### ✅ PASS `write.delete_by_filter`

- **time**: `2026-01-11T11:18:07Z`

**data**

```json
{
  "kind": "write",
  "rows_affected": 1,
  "rows_upserted": null,
  "rows_patched": null,
  "rows_deleted": 1,
  "rows_remaining": null,
  "billing": {
    "billable_logical_bytes_written": 13,
    "query": {
      "billable_logical_bytes_queried": 256000000,
      "billable_logical_bytes_returned": 5
    }
  }
}
```

#### ✅ PASS `verify.delete_by_filter`

- **time**: `2026-01-11T11:18:07Z`

**data**

```json
{
  "remaining_ids": [
    "doc-0",
    "doc-1",
    "doc-2"
  ]
}
```

#### ✅ PASS `namespaces.list`

- **time**: `2026-01-11T11:18:07Z`

**data**

```json
{
  "prefix": "e2e-tpuf-",
  "namespaces": [
    "e2e-tpuf-20260111-111752-9fbf392f"
  ]
}
```

#### ✅ PASS `namespace.delete_namespace`

- **time**: `2026-01-11T11:18:08Z`

#### ✅ PASS `namespace.delete.verify_not_found`

- **time**: `2026-01-11T11:18:08Z`

### 汇总

```json
{
  "namespace": "e2e-tpuf-20260111-111752-9fbf392f"
}
```

