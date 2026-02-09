# tpuf_test.py

# Run with `pytest tpuf_test.py`.

import pytest
import string
import random
import turbopuffer
from turbopuffer.lib import namespace

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

# Create a namespace for each test, and always delete it afterwards
@pytest.fixture
def tpuf_ns():
    random_suffix = ''.join(random.choices(string.ascii_letters + string.digits, k=32))
    ns_name = f"test-{random_suffix}"
    ns = tpuf.namespace(ns_name)
    try:
        yield ns
    finally:
        try:
            ns.delete_all()
        except turbopuffer.NotFoundError:
            # If the namespace never got created, no cleanup is needed.
            pass


def test_query(tpuf_ns: namespace.Namespace):
    tpuf_ns.write(
      upsert_rows=[
        {"id": 1, "vector": [1, 1]},
        {"id": 2, "vector": [2, 2]}
      ],
      distance_metric="cosine_distance",
    )
    res = tpuf_ns.query(rank_by=("vector", "ANN", [1.1, 1.1]), top_k=10)
    assert res.rows[0].id == 1
