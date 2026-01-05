# $ pip install turbopuffer
import turbopuffer
import os

tpuf = turbopuffer.Turbopuffer(
    # API tokens are created in the dashboard: https://turbopuffer.com/dashboard
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    # Pick the right region: https://turbopuffer.com/docs/regions
    region="gcp-us-central1",
)

ns = tpuf.namespace(f'fts-basic-example-py')
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'content': 'turbopuffer is a fast search engine with FTS, filtering, and vector search support'
        },
        {
            'id': 2,
            'content': 'turbopuffer can store billions and billions of documents cheaper than any other search engine'
        },
        {
            'id': 3,
            'content': 'turbopuffer will support many more types of queries as it evolves. turbopuffer will only get faster.'
        }
    ],
    schema={
        'content': {
            'type': 'string',
            # Enable BM25 with default settings
            # For all config options, see https://turbopuffer.com/docs/write#schema
            'full_text_search': True
        }
    }
)

# Basic FTS search.
results = ns.query(
    rank_by=('content', 'BM25', 'turbopuffer'),
    top_k=10,
    include_attributes=['content']
)
# [3, 1, 2] is the default BM25 ranking based on document length and
# term frequency
print(results)

# Simple phrase matching filter, to limit results to documents that contain the
# terms "search" and "engine"
results = ns.query(
    rank_by=('content', 'BM25', 'turbopuffer'),
    filters=('content', 'ContainsAllTokens', 'search engine'),
    top_k=10,
    include_attributes=['content']
)
# [1, 2] (same as above, but without document 3)
print(results)

# To combine with vector search, see:
# https://turbopuffer.com/docs/hybrid-search
