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

# Create an embedding with OpenAI, could be {Cohere, Voyage, Mixed Bread, ...}
# Requires OPENAI_API_KEY to be set (https://platform.openai.com/settings/organization/api-keys)
def openai_or_rand_vector(text: str) -> List[float]:
    if not os.getenv("OPENAI_API_KEY"): print("OPENAI_API_KEY not set, using random vectors"); return [__import__('random').random()]*2
    try: return __import__('openai').embeddings.create(model="text-embedding-3-small",input=text).data[0].embedding
    except ImportError: return [__import__('random').random()]*2

ns = tpuf.namespace('vector-1-example-py')

# Basic vector search example
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': openai_or_rand_vector("A cat sleeping on a windowsill"),
            'text': 'A cat sleeping on a windowsill',
            'category': 'animal',
        },
        {
            'id': 2,
            'vector': openai_or_rand_vector("A playful kitten chasing a toy"),
            'text': 'A playful kitten chasing a toy',
            'category': 'animal',
        },
        {
            'id': 3,
            'vector': openai_or_rand_vector("An airplane flying through clouds"),
            'text': 'An airplane flying through clouds',
            'category': 'vehicle',
        },
    ],
    distance_metric='cosine_distance'
)

result = ns.query(
    rank_by=("vector", "ANN", openai_or_rand_vector("feline")),
    top_k=2,
    include_attributes=['text']
)
# Returns cat and kitten documents, sorted by vector similarity
print(result.rows)

# Example of vector search with filters
ns = tpuf.namespace('vector-2-example-py')
ns.write(
    upsert_rows=[
        {
            'id': 1,
            'vector': openai_or_rand_vector("A shiny red sports car"),
            'description': 'A shiny red sports car',
            'color': 'red',
            'type': 'car',
            'price': 50000,
        },
        {
            'id': 2,
            'vector': openai_or_rand_vector("A sleek blue sedan"),
            'description': 'A sleek blue sedan',
            'color': 'blue',
            'type': 'car',
            'price': 35000,
        },
        {
            'id': 3,
            'vector': openai_or_rand_vector("A large red delivery truck"),
            'description': 'A large red delivery truck',
            'color': 'red',
            'type': 'truck',
            'price': 80000,
        },
        {
            'id': 4,
            'vector': openai_or_rand_vector("A blue pickup truck"),
            'description': 'A blue pickup truck',
            'color': 'blue',
            'type': 'truck',
            'price': 45000,
        },
    ],
    distance_metric='cosine_distance'
)

result = ns.query(
    rank_by=("vector", "ANN", openai_or_rand_vector("car")),  # Embedding similar to "car"
    top_k=10,
    # Complex filter combining multiple conditions, see https://turbopuffer.com/docs/query for all options
    filters=('And', (
        ('price', 'Lt', 60000),
        ('color', 'Eq', 'blue')
    )),
    include_attributes=['description', 'price']
)
print(result.rows) # car, then truck
