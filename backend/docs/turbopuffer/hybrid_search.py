# $ pip install turbopuffer
import turbopuffer
from turbopuffer.types import Row, ID
import os
from typing import List

tpuf = turbopuffer.Turbopuffer(
    # API tokens are created in the dashboard: https://turbopuffer.com/dashboard
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    # Pick the right region: https://turbopuffer.com/docs/regions
    region="gcp-us-central1",
)

ns = tpuf.namespace(f'hybrid-example-py')

# Create an embedding with OpenAI, could be {Cohere, Voyage, Mixed Bread, ...}
# Requires OPENAI_API_KEY to be set (https://platform.openai.com/settings/organization/api-keys)
def openai_or_rand_vector(text: str) -> List[float]:
    if not os.getenv("OPENAI_API_KEY"): print("OPENAI_API_KEY not set, using random vectors"); return [__import__('random').random()]*2
    try: return __import__('openai').embeddings.create(model="text-embedding-3-small",input=text).data[0].embedding
    except ImportError: return [__import__('random').random()]*2

# Upsert documents with both FTS and vector search capabilities
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': openai_or_rand_vector('Muesli: A mix of raw oats, nuts and dried fruit served with cold milk'),
            'content': 'Muesli: A quick mix of raw oats, nuts and dried fruit served with cold milk',
        },
        {
            'id': 2,
            'vector': openai_or_rand_vector('Classic chia seed pudding is a cold breakfast that takes 5 minutes to prepare'),
            'content': 'Classic chia seed pudding is a cold breakfast that takes 5 minutes to prepare',
        },
        {
            'id': 3,
            'vector': openai_or_rand_vector('Overnight oats: Mix oats with milk, refrigerate overnight for a delicious chilled breakfast'),
            'content': 'Overnight oats: Mix oats with milk, refrigerate overnight for a delicious chilled breakfast',
        },
        {
            'id': 4,
            'vector': openai_or_rand_vector('Hot oatmeal is a quick and healthy breakfast'),
            'content': 'Hot oatmeal is a quick and healthy breakfast',
        },
        {
            'id': 5,
            'vector': openai_or_rand_vector("Breakfast sandwich: A little extra prep, but worth it on Sunday mornings!"),
            'content': 'Breakfast sandwich: A little extra prep, but worth it on Sunday mornings!',
        },
    ],
    distance_metric="cosine_distance",
    schema={ "content": { "type": "string", "full_text_search": True } }
)
query = "quick breakfast like oatmeal but cold"
print("Ideal:", [1, 2, 3, 4, 5])

# ===============================================
# Multi-query: Vector Search + FTS
# combine both vector search and FTS in a single API call
# https://turbopuffer.com/docs/query#multi-queries
# ===============================================
response = ns.multi_query(
    queries=[
        {
            "rank_by": ("vector", "ANN", openai_or_rand_vector(query)),
            "top_k": 10,
            "include_attributes": ["content"],
        },
        {
            "rank_by": ("content", "BM25", query),
            "top_k": 10,
            "include_attributes": ["content"],
        },
    ]
)

# FTS:    [4, 1, 2, 5, 3], matches Muesli well (NDCG: 0.72)
# Vector: [4, 3, 2, 1, 5], picks up on overnight oats, but not Muesli! (NDCG: 0.63)
# Ideal:  [1, 2, 3, 4, 5]
vector_result, fts_result = response.results[0].rows, response.results[1].rows
print("Vector:", [item.id for item in vector_result])
print("FTS:", [item.id for item in fts_result])

# ===============================================
# Rank Fusion
# ===============================================
# There are many ways to fuse the results, see https://github.com/AmenRa/ranx?tab=readme-ov-file#fusion-algorithms

# That's why it's not built into turbopuffer (yet), as you may otherwise not be
# able to express the fusing you need.
def reciprocal_rank_fusion(result_lists, k = 60): # simple way to fuse results based on position
    scores = {} 
    all_results = {} 
    for results in result_lists:
        for rank, item in enumerate(results, start=1):
            scores[item.id] = scores.get(item.id, 0) + 1.0 / (k + rank)
            all_results[item.id] = item
    return [
        setattr(all_results[doc_id], '$dist', score) or all_results[doc_id]
        for doc_id, score in sorted(scores.items(), key=lambda x: x[1], reverse=True)
    ]

# Better than FTS or Vector alone, but still weighs the "hot oatmeal" highly.
# To fix that, we need a re-ranker to bring some more FLOPS to the table.
# Ideal: [1, 2, 3, 4, 5]
# Fused: [4, 1, 2, 3, 5] (NDCG: 0.73)
fused_results = reciprocal_rank_fusion([vector_result, fts_result])
print("Fused:", [item.id for item in fused_results])


# ===============================================
# Reranking
# ===============================================
# See alternative re-rankers turbopuffer.com/docs/hybrid
def cohere_rerank_or_unranked(results, query, k = None): 
    if not os.getenv("COHERE_API_KEY"):
        print("Warning: COHERE_API_KEY not set (https://dashboard.cohere.com/api-keys), returning unranked results")
        return results
    try:
        co = __import__('cohere').Client(os.getenv("COHERE_API_KEY"))
        reranked = co.rerank(query=query, documents=[r.content for r in results], top_n=k or len(results)).results
        for r in reranked:
            results[r.index]['$dist'] = r.relevance_score
        return [results[r.index] for r in reranked]
    except ImportError:
        print("Warning: cohere package not installed (`pip install cohere`), returning unranked results")
        return results

# Weighs the slow overnight oats higher than the chia pudding, but not bad!
# Cohere: [1, 3, 2, 4, 5] (NDCG: 0.97)
# Ideal: [1, 2, 3, 4, 5]
reranked_results = cohere_rerank_or_unranked(fused_results, query)
print("Reranked:", [item.id for item in reranked_results])
