# $ pip install turbopuffer
import turbopuffer
import os
from typing import List

tpuf = turbopuffer.Turbopuffer(
    # API tokens are created in the dashboard: https://turbopuffer.com/dashboard
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    # Pick the right region: https://turbopuffer.com/docs/regions
    region="gcp-us-central1",
)

ns = tpuf.namespace(f'quickstart-example-py')

# Create an embedding with OpenAI, could be {Cohere, Voyage, Mixed Bread, ...}
# Requires OPENAI_API_KEY to be set (https://platform.openai.com/settings/organization/api-keys)
def openai_or_rand_vector(text: str) -> List[float]:
    if not os.getenv("OPENAI_API_KEY"): print("OPENAI_API_KEY not set, using random vectors"); return [__import__('random').random()]*2
    try: return __import__('openai').embeddings.create(model="text-embedding-3-small",input=text).data[0].embedding
    except ImportError: return [__import__('random').random()]*2

# Upsert documents with vectors and attributes
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': openai_or_rand_vector("walrus narwhal"),
            'name': "foo",
            'public': 1,
            'text': "walrus narwhal",
        },
        {
            'id': 2,
            'vector': openai_or_rand_vector("elephant walrus rhino"),
            'name': "foo",
            'public': 0,
            'text': "elephant walrus rhino",
        },
    ],
    distance_metric='cosine_distance',
    schema={
        "text": { # Configure FTS/BM25, other attribtues have inferred types (name: str, public: int)
            "type": "string",
             # More schema & FTS options https://turbopuffer.com/docs/write#schema
            "full_text_search": True,
        }
    }
)

# Query nearest neighbors with filter
print(ns.query(
  rank_by=("vector", "ANN", openai_or_rand_vector("walrus narwhal")),
  top_k=10,
  filters=("And", (("name", "Eq", "foo"), ("public", "Eq", 1))),
  include_attributes=["name"],
))
# [Row(id=1, vector=None, $dist=0.009067952632904053, name='foo')]

# Full-text search on an attribute
# To combine FTS and vector search concurrently and fuse results, see https://turbopuffer.com/docs/hybrid-search
print(ns.query(
  top_k=10,
  filters=("name", "Eq", "foo"),
  rank_by=('text', 'BM25', 'quick walrus'),
))
# [Row(id=1, vector=None, $dist=0.19, name='foo')]
# [Row(id=2, vector=None, $dist=0.168, name='foo')]

# Vectors can be updated by passing new data for an existing ID
ns.write(
  upsert_rows=[
    {
      'id': 1,
      'vector': openai_or_rand_vector("foo"),
      'name': "foo",
      'public': 1,
    },
    {
      'id': 2,
      'vector': openai_or_rand_vector("foo"),
      'name': "foo",
      'public': 1,
    },
    {
      'id': 3,
      'vector': openai_or_rand_vector("foo"),
      'name': "foo",
      'public': 1,
    },
  ],
  distance_metric='cosine_distance',
)
# Vectors are deleted by ID.
ns.write(deletes=[1, 3])
