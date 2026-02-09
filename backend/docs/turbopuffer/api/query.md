[We've doubled down with Lachy Groom, added ThriveWe've doubled down with Lachy Groom and added Thrive to the team](https://tpuf.link/comms)

## Navigation

[![Logo](https://turbopuffer.com/_next/static/media/logo_header_darkbg.435dd040.svg)turbopuffer](https://turbopuffer.com/)

[Customers](https://turbopuffer.com/customers) [Pricing](https://turbopuffer.com/pricing) [Company](https://turbopuffer.com/about) [Jobs](https://turbopuffer.com/jobs) [Blog](https://turbopuffer.com/blog) [Docs](https://turbopuffer.com/docs) [Contact](https://turbopuffer.com/contact) [Dashboard](https://turbopuffer.com/dashboard) [Sign up](https://turbopuffer.com/join)

[Introduction](https://turbopuffer.com/docs)

[Architecture](https://turbopuffer.com/docs/architecture)

[Guarantees](https://turbopuffer.com/docs/guarantees)

[Tradeoffs](https://turbopuffer.com/docs/tradeoffs)

[Limits](https://turbopuffer.com/docs/limits)

[Regions](https://turbopuffer.com/docs/regions)

[Roadmap & Changelog](https://turbopuffer.com/docs/roadmap)

[Security](https://turbopuffer.com/docs/security)

[Encryption](https://turbopuffer.com/docs/cmek)

[Backups](https://turbopuffer.com/docs/backups)

[Private Networking](https://turbopuffer.com/docs/private-networking)

[Performance](https://turbopuffer.com/docs/performance)

Guides

[Quickstart](https://turbopuffer.com/docs/quickstart)

[Vector Search](https://turbopuffer.com/docs/vector)

[Full-Text Search](https://turbopuffer.com/docs/fts)

[Hybrid Search](https://turbopuffer.com/docs/hybrid)

[Testing](https://turbopuffer.com/docs/testing)

API

[Auth & Encoding](https://turbopuffer.com/docs/auth)

[Write](https://turbopuffer.com/docs/write)

[Query](https://turbopuffer.com/docs/query)

[Namespace metadata](https://turbopuffer.com/docs/metadata)

[Export](https://turbopuffer.com/docs/export)

[Warm cache](https://turbopuffer.com/docs/warm-cache)

[List namespaces](https://turbopuffer.com/docs/namespaces)

[Delete namespace](https://turbopuffer.com/docs/delete-namespace)

[Recall](https://turbopuffer.com/docs/recall)

## POST /v2/namespaces/:namespace/query

Query, filter, full-text search and vector search documents.

Latency

warmcold

1M docs

Percentile

Latency

p50

8ms

p90

10ms

p99

35ms

A query retrieves documents in a single [namespace](https://turbopuffer.com/docs/write), returning the
ordered or highest-ranked documents that match the query's filters.

turbopuffer supports the following types of queries:

- [Vector search](https://turbopuffer.com/docs/query#vector-search): find the documents closest to a query vector
- [Full-text search](https://turbopuffer.com/docs/query#full-text-search): find documents with the highest
[BM25 score](https://en.wikipedia.org/wiki/Okapi_BM25), a classic text search algorithm
that considers query term frequency and document length
- [Ordering by attributes](https://turbopuffer.com/docs/query#ordering-by-attributes): find all documents matching filters in order of an attribute
- [Lookups](https://turbopuffer.com/docs/query#lookups): find all documents matching filters when order isn't important
- [Aggregations](https://turbopuffer.com/docs/query#aggregations): aggregate attribute values across all documents matching filters
- [Grouped aggregations](https://turbopuffer.com/docs/query#group-by): aggregate while grouping by one or more attributes
- [Multi-queries](https://turbopuffer.com/docs/query#multi-queries): send multiple queries to the same namespace used for hybrid searches.

turbopuffer is fast by default. See [Performance](https://turbopuffer.com/docs/performance) for how you can influence performance.

### Request

**rank\_by** arrayrequired unless aggregate\_by is set

How to rank the documents in the namespace. Supported ranking functions:

- [ANN](https://turbopuffer.com/docs/query#vector-search) ("approximate nearest neighbor")
- [BM25](https://turbopuffer.com/docs/query#full-text-search) (combine with [Sum](https://turbopuffer.com/docs/query#fts-operators), [Max](https://turbopuffer.com/docs/query#fts-operators))
- [Order by attribute](https://turbopuffer.com/docs/query#ordering-by-attributes)

Documents with a score of zero are excluded from results.

For [hybrid search](https://turbopuffer.com/docs/hybrid-search), you can use [multi-queries](https://turbopuffer.com/docs/query#multi-queries) (e.g. BM25 + vector) and combine the results client-side with e.g. reciprocal-rank fusion. We encourage users to write a strong query layer abstraction, as it's not uncommon to do several turbopuffer queries per user query.

**Vector example:**`["vector", "ANN", [0.1, 0.2, 0.3, ..., 76.8]]`

**BM25:**`["text", "BM25", "fox jumping"]`

**Order by attribute example:**`["timestamp", "desc"]`

**BM25 with multiple, weighted fields:**

```json
["Sum", [\
    ["Product", 2, ["title", "BM25", "fox jumping"]],\
    ["content", "BM25", "fox jumping"]\
  ]\
]
```

* * *

**top\_k** number

Alias for [limit.total](https://turbopuffer.com/docs/query#param-limit).

Maximum: 10,000

* * *

**filters** arrayoptional

Exact filters for attributes to refine search results for. Think of it as a SQL
WHERE clause.

See [Filtering Parameters](https://turbopuffer.com/docs/query#filtering-parameters) below for details.

When combined with a vector, the query planner will automatically combine the
attribute index and the approximate nearest neighbor index for best performance
and recall. See our post on [Native Filtering](https://turbopuffer.com/blog/native-filtering)
for details.

For the best performance, separate documents into namespaces instead of
filtering where possible. See also [Performance](https://turbopuffer.com/docs/performance).

**Example:**`["And", [["id", "Gte", 1000], ["permissions", "ContainsAny", ["3d7a7296-3d6a-4796-8fb0-f90406b1f621", "92ef7c95-a212-43a4-ae4e-0ebc96a65764"]]]]`

* * *

**include\_attributes** array\[string\] \| booleandefault: id

List of attribute names to return in the response. Can be set to `true` to
return all attributes. Return only the ones you need for best performance.

* * *

**exclude\_attributes** array\[string\]

List of attribute names to exclude from the response. All other attributes
will be included in the response. Exclude any attributes you don't need for
best performance.

Cannot be specified with [include\_attributes](https://turbopuffer.com/docs/query#param-include_attributes).

**Example:**`["vector", "big_attribute"]`

* * *

**limit** number \| objectrequired

Limits the number of documents returned.

Can be a number to apply a total limit, or an object with the following
fields:

- `total` (number, required): limits the total number of documents returned

Maximum: 10,000

- `per` (object, optional): limits the number of documents with the same value for a
set of attributes (the "limit key") that can appear in the results.


  - `attributes` (string array): the attributes to include in the limit key
  - `limit` (number): the maximum number of documents to return for each
    value of the limit key

`per` is only supported for [order by attribute](https://turbopuffer.com/docs/query#ordering-by-attributes)
queries. Support for BM25 and ANN queries is on our roadmap.

**Example (simple total):**

```json
{"limit": 10}
```

**Example (limit per category and size):**

```json
{
  "limit": {
    "per": {"attributes": ["category", "size"], "limit": 10},
    "total": 10
  }
}
```

See [Diversification](https://turbopuffer.com/docs/query#diversification) below for details.

* * *

**aggregate\_by** objectrequired unless rank\_by is set

[Aggregations](https://turbopuffer.com/docs/query#aggregations) to compute over all documents in the namespace
that match the [filters](https://turbopuffer.com/docs/query#param-filters).

Cannot be specified with [rank\_by](https://turbopuffer.com/docs/query#param-rank_by) or
[include\_attributes](https://turbopuffer.com/docs/query#param-include_attributes).

Each entry in the object maps a label for the aggregation to
an aggregate function. Supported aggregate functions:

- `["Count"]`: counts the number of documents.
- `["Sum", "attribute_name"]`: sums the values of the specified scalar numeric attribute (supports `int`, `uint`, `float`)

**Example:**`{"aggregate_by": {"my_count": ["Count"]}}`

* * *

**group\_by** array

Only valid when [`aggregate_by`](https://turbopuffer.com/docs/query#param-aggregate_by) is set.

Groups documents by the specified attributes (the "group key") before
computing aggregates. Aggregates are computed separately for each group.

Up to [top\_k](https://turbopuffer.com/docs/query#param-top_k) groups are returned, ordered by group key.

**Example:**`{"aggregate_by": {"count_by_color_and_size": ["Count"]}, "group_by": ["color", "size"]}`

* * *

**queries** array

Send an array of query objects to be executed simultaneously and atomically.

Up to 16 queries can be sent per request.
Each subquery will count against the [concurrent query limit](https://turbopuffer.com/docs/limits) for
the namespace. If you need a higher limit, please [contact us](https://turbopuffer.com/contact).

The provided array should consist of query objects, including every field except for `vector_encoding` or `consistency`, which should be set on the root object.

The `queries` field is mutually exclusive with other query object fields. A request can contain either a multi-query or an ordinary query.

* * *

**vector\_encoding** stringdefault: float

The encoding to use for the vectors in the response. The supported encodings
are `float` and `base64`.

If `float`, vectors are returned as arrays of numbers.

If `base64`, vectors are returned as base64-encoded strings representing the
vectors serialized in little-endian float32 binary format.

This parameter has no effect if the `vector` attribute is not included in the
response (see the [include\_attributes](https://turbopuffer.com/docs/query#include_attributes) parameter).

* * *

**consistency** objectdefault: {'level': 'strong'}

Controls the consistency level for the query. This determines whether the cache is
updated and how much recently written data is included in query results.

**Strong consistency (default):**`{"level": "strong"}`

Searches all unindexed writes and updates the cache. This ensures the query includes
all data written before the query started, providing the strongest consistency guarantees.

**Eventual consistency:**`{"level": "eventual"}`

Searches up to 128MiB of unindexed writes. Data may be up to 60 seconds stale. In
practice, approximately 99.9923% of eventually consistent queries are fully consistent,
as the same node typically handles both reads and writes for a namespace (barring rare routing changes).
Use eventual consistency when you need higher query throughput and can tolerate slightly stale results.

### Response

**rows** array

An array of the [top\_k](https://turbopuffer.com/docs/query#param-top_k) documents that matched the query, ordered by the ranking function. Only present if [rank\_by](https://turbopuffer.com/docs/query#param-rank_by) is specified.

Each document is an object containing the [requested attributes](https://turbopuffer.com/docs/query#param-include_attributes). The `id` attribute is always included. The special attribute `$dist` is set to the ranking function's score for the document (distance from the query vector for `ANN`; BM25 score for `BM25`; omitted when ordering by an attribute).

**Example:**

```json
[\
  {"$dist": 1.7, "id": 8, "extra_attr": "puffer"},\
  {"$dist": 3.1, "id": 20, "extra_attr": "fish"}\
]
```

**results** array

An array of response objects containing the results for each sub-query of a [multi-query](https://turbopuffer.com/docs/query#multi-queries) request, the result objects are returned in the same order as the queries.

```json
[\
    {\
      "rows": [\
        {\
          "$dist": 0.0,\
          "id": 0\
        }\
      ]\
    },\
    {\
      "aggregations": {\
        "my_count_of_ids": 42\
      }\
    }\
  ]
```

**aggregations** object

An object mapping the label for each
[requested aggregation](https://turbopuffer.com/docs/query#param-aggregate_by) to the computed value.

Only present if [aggregate\_by](https://turbopuffer.com/docs/query#param-aggregate_by) is specified but
[group\_by](https://turbopuffer.com/docs/query#param-group_by) is **not** specified.

**Example:**

```json
{ "my_count_of_ids": 42 }
```

**aggregation\_groups** array

An array of objects, one for each aggregation group, containing
the [group key](https://turbopuffer.com/docs/query#param-group_by) and the computed value of each
[requested aggregation](https://turbopuffer.com/docs/query#param-aggregate_by).

Only present if both [aggregate\_by](https://turbopuffer.com/docs/query#param-aggregate_by) and
[group\_by](https://turbopuffer.com/docs/query#param-group_by) are specified.

**Example:**

```json
[\
  // Sorted by group key. No more than top_k groups are returned.\
  { "color": "blue", "size": "small", "my_grouped_count": 2 },\
  { "color": "blue", "size": "medium", "my_grouped_count": 7 },\
  { "color": "red", "size": "small", "my_grouped_count": 4 }\
]
```

**billing** object

The billable resources consumed by the query. The object contains the following fields:

- `billable_logical_bytes_queried` (uint): the number of logical bytes processed by the query
- `billable_logical_bytes_returned` (uint): the number of logical bytes returned by the query

**performance** object

The performance metrics for the query. The object currently contains the following fields, but these fields may change name, type, or meaning in the future:

- `cache_hit_ratio` (float): the ratio of cache hits to total cache lookups
- `cache_temperature` (string): a qualitative description of the cache hit ratio (`hot`, `warm`, or `cold`)
- `server_total_ms` (uint): request time measured on the server, including time spent waiting for other queries to complete if the namespace was at its [concurrency limit](https://turbopuffer.com/docs/limits)
- `query_execution_ms` (uint): request time measured on the server, excluding time spent waiting due to the namespace concurrency limit
- `exhaustive_search_count` (uint): the number of unindexed documents processed by the query
- `approx_namespace_size` (uint): the approximate number of documents in the namespace

[Contact the turbopuffer team](https://turbopuffer.com/contact) if you need help interpreting these metrics.

### Examples

#### Vector Search

The query vector must have the same dimensionality as the vectors in the namespace being queried.

python

curlpythontypescriptgojavaruby

```python
# $ pip install turbopuffer
import turbopuffer
import os

tpuf = turbopuffer.Turbopuffer(
    # API tokens are created in the dashboard: https://turbopuffer.com/dashboard
    api_key=os.getenv("TURBOPUFFER_API_KEY"),
    # Pick the right region: https://turbopuffer.com/docs/regions
    region="gcp-us-central1",
)

ns = tpuf.namespace('query-vector-example-py')

# If an error occurs, this call raises a turbopuffer.APIError if a retry was not successful.
result = ns.query(
    rank_by=("vector", "ANN", [0.1, 0.1]),
    top_k=10
)
print(result.rows)

# Prints a list of row-oriented documents:
# [\
#   Row(id=1, vector=None, $dist=0.0),\
#   Row(id=2, vector=None, $dist=2.0)\
# ]
```

#### Filters

When you need to filter documents, you can combine filters with vector search or use them alone. Here's an example of finding recent public documents:

python

curlpythontypescriptgojavaruby

```python
from datetime import datetime
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-filters-example-py')

result = ns.query(
    filters=('And', (
        ('timestamp', 'Gte', datetime(2024, 3, 1, 0, 0, 0)),  # Documents after March 1, 2024
        ('public', 'Eq', True)
    )),
    rank_by=("vector", "ANN", [0.1, 0.2, 0.3]),  # Optional: include vector to combine with filters
    top_k=10,
    include_attributes=['title', 'timestamp']
)
print(result.rows)

# Prints a list of row-oriented documents:
# [\
#   Row(id=1, vector=None, $dist=0.15, title='Getting Started Guide', timestamp='2024-03-02T00:00:000000000Z'),\
#   Row(id=2, vector=None, $dist=0.28, title='Advanced Features', timestamp='2024-03-03T00:00:000000000Z'),\
# ]
```

#### Ordering by Attributes

You can specify a `rank_by` parameter to order results by a specific attribute (i.e. SQL `ORDER BY`). For example, to order by timestamp in descending order:

python

curlpythontypescriptgojavaruby

```python
from datetime import datetime
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-ordering-example-py')

result = ns.query(
    filters=('timestamp', 'Lt', datetime(2024, 3, 1, 0, 0, 0)),  # Documents before March 1, 2024
    rank_by=('timestamp', 'desc'),  # Order by timestamp in descending order
    top_k=1000,
    include_attributes=['title', 'timestamp']
)
print(result.rows)

# Prints a list of row-oriented documents:
# [\
#   Row(id=6, vector=None, title='Roadmap', timestamp='2024-02-27T00:00:000000000Z'),\
#   Row(id=4, vector=None, title='Performance Guide', timestamp='2024-02-24T00:00:000000000Z'),\
# ]
```

Ordering by multiple attributes isn't yet implemented.

Similar to SQL, the ordering of results is not guaranteed when multiple documents have the same attribute value for the `rank_by` parameter. Array attributes aren't supported.

#### Lookups

To find all documents matching filters when order isn't important to you, rank
by the `id` attribute, which is guaranteed to be present in every namespace:

```json
"filters": [...],
"rank_by": ["id", "asc"],
"top_k": ...
```

If you expect more than `top_k` results, see [Pagination](https://turbopuffer.com/docs/query#pagination).

#### Aggregations

You can aggregate attribute values across all documents in the namespace that
match the query's filters using the [aggregate\_by\\
parameter](https://turbopuffer.com/docs/query#param-aggregate_by).

For example, to count the number of documents in a namespace:

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-count-example-py')

result = ns.query(
    aggregate_by={'my_cool_count': ('Count',)},
    filters=('cool_score', 'Gt', 7),
)
print(result.aggregations['my_cool_count'])
```

You can use `Sum` to sum numeric attribute values across all documents that match
a particular filter:

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-sum-example-py')

result = ns.query(
    aggregate_by={'my_cool_sum': ('Sum', 'cool_score')},
    filters=('id', 'Gte', 2),
)
print(result.aggregations['my_cool_sum'])
```

#### Group by

When [aggregating](https://turbopuffer.com/docs/query#param-aggregate_by), you can use the
[group\_by](https://turbopuffer.com/docs/query#param-group_by) parameter to group results by one or more
attributes. Aggregates are computed separately for each group.

For example, to count documents grouped by the `color` and `size` attributes:

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region="gcp-us-central1",  # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace("query-group-by-example-py")

result = ns.query(
    aggregate_by={"count_by_color_and_size": ("Count",)},
    group_by=["color", "size"],
)
print(result.aggregation_groups)
# [\
#   Row(color='blue', count_by_color_and_size=1, size='XL'),\
#   Row(color='red', count_by_color_and_size=2, size='L')\
# ]
```

#### Multi-queries

You can provide multiple query objects to be executed simultaneously on a namespace.
Individual subqueries can be one of any other primitive query type, simplifying complex retrieval workflows. Multi-queries offer better performance than issuing independent queries to the same namespace.

All reads in a multi-query are executed against the same consistent snapshot of
the database (snapshot isolation).

Up to 16 queries can be sent per request.
Each subquery will count against the [concurrent query limit](https://turbopuffer.com/docs/limits) for
the namespace. If you need a higher limit, please [contact us](https://turbopuffer.com/contact).

For example, a standard hybrid query combining full-text and vector searches executed together through a multi-query:

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region="gcp-us-central1",  # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace("query-multi-example-py")

response = ns.multi_query(
    queries=[\
        {\
            "rank_by": ("vector", "ANN", [1.0, 0.0]),\
            "top_k": 1\
        },\
        {\
            "rank_by": ("attr1", "BM25", "quick fox"),\
            "top_k": 1,\
        },\
    ]
)
print(response.results)
```

Individual sub-queries can vary their parameters independently including different `filters`, `top_k`, `rank_by` or `aggregate_by`.

### Full-Text Search

The FTS attribute must be configured with `full_text_search` set in the schema
when writing documents. See [Schema documentation](https://turbopuffer.com/docs/write#schema) and
the [Full-Text Search guide](https://turbopuffer.com/docs/fts) for more details.

For an example of hybrid search (combining both vector and BM25 results), see
[Hybrid Search](https://turbopuffer.com/docs/hybrid-search).

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-fts-basic-example-py')

result = ns.query(
    rank_by=('content', 'BM25', 'quick fox'),
    top_k=10,
    include_attributes=['title', 'content']
)
print(result.rows)
```

You can combine BM25 full-text search with filters to limit results to
a specific subset of documents.

python

curlpythontypescriptgojavaruby

```python
from datetime import datetime
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-fts-example-ts')

result = ns.query(
    rank_by=('content', 'BM25', 'quick fox'),
    filters=('And', (
        ('timestamp', 'Gte', datetime(2024, 3, 1, 0, 0, 0)),  # Documents after March 1, 2024
        ('public', 'Eq', True),
    )),
    top_k=10,
    include_attributes=['title', 'content', 'timestamp']
)
print(result.rows)

# Prints a list of row-oriented documents:
# [\
#   Row(id=1, vector=None, $dist=0.85, title='Animal Stories', content='The quick brown fox...', timestamp='2024-03-02T00:00:000000000Z'),\
#   Row(id=2, vector=None, $dist=1.28, title='Forest Tales', content='A quick red fox...', timestamp='2024-03-03T00:00:000000000Z'),\
# ]
```

#### FTS operators

FTS operators combine the results of multiple clauses into a single score. Specifically, the following operators are supported:

- `Sum`: Sum the scores of the clauses.
- `Max`: Use the maximum score of clauses as the score.

Operators can be nested. For example:

```json
"rank_by": ["Sum", [\
  ["Max", [\
    ["title", "BM25", "whale facts"],\
    ["description", "BM25", "whale facts"]\
  ]],\
  ["content", "BM25", "huge whale"]\
]]
```

#### Field weights/boosts

You can specify a weight / boost per-field by using the `Product` operator inside a `rank_by`.
For example, to apply a 2x score multiplier on the `title` clause:

```json
"rank_by": ["Sum", [\
  ["Product", 2, ["title", "BM25", "quick fox"]],\
  ["content", "BM25", "quick fox"]\
]]
```

#### Rank by filter

[Filters](https://turbopuffer.com/docs/query#filtering) can be used inside `rank_by` expressions to conditionally boost documents matching certain criteria. Documents that pass the filter get a score of 1, and are otherwise scored 0.

```json
"rank_by": ["Sum", [\
  ["title", "BM25", "quick fox"],\
  ["species", "Eq", "whale"]\
]]
```

Use `Product` to change how large the boost is:

```json
"rank_by": ["Product", 2.0, ["species", "Eq", "whale"]]
```

#### Phrase matching

`ContainsTokenSequence` matches documents that contain all the tokens present in the filter input string, in the exact order and adjacent to each other.

```json
"filters": ["text", "ContainsTokenSequence", "walrus is lazy"]
```

Currently, turbopuffer implements `ContainsTokenSequence` using a partial postfilter which may lead to reduced recall on ANN & FTS queries, and potentially higher latency on filter-only queries; we expect to improve this in the future.

`ContainsAllTokens` matches documents that contain all the tokens present in the filter input string, regardless of order or adjacency. For example, this filter would match a document like "walrus is lazy", provided said document didn't contain both "polar" and "bear":

```json
"filters": ["And", [\
  ["text", "ContainsAllTokens", "lazy walrus"],\
  ["Not", ["text", "ContainsAllTokens", "polar bear"]]\
]]
```

`ContainsAllTokens` is generally faster than `ContainsTokenSequence`.

#### Prefix queries

Type-ahead style prefix queries are supported through the `ContainsAllTokens` filter and the `BM25` ranking operator using the `last_as_prefix` parameter:

```jsonc
// As a filter
"filters": ["text", "ContainsAllTokens", "lazy wal", { "last_as_prefix": true }]

// Within a BM25 query
"rank_by": ["text", "BM25", "lazy wal", { "last_as_prefix": true }]
```

When `last_as_prefix` is true, the last token in the input string is treated as a literal prefix. In this case, the prefix
"wal" matches documents that contain "wal", "walrus", "walnut", etc. `BM25` prefix matches are assigned a score of `1.0`.

### Filtering

Filters allow you to narrow down results by applying exact conditions to
attributes. Conditions are arrays with an attribute name, operation, and value,
for example:

- `["attr_name", "Eq", 42]`
- `["page_id", "In", ["page1", "page2"]]`
- `["user_migrated_at", "NotEq", null]`

Values must have the same type as the attribute's value, or an array of that type for operators like `ContainsAny`.

Filters are evaluated against an inverted index, which makes even large
intersects fast. turbopuffer's [filtering is recall-aware for vector\\
queries](https://turbopuffer.com/blog/native-filtering).

Conditions can be combined using `{And,Or}` operations:

```json
// basic And condition
"filters": ["And", [\
  ["attr_name", "Eq", 42],\
  ["page_id", "In", ["page1", "page2"]]\
]]

// conditions can be nested
"filters": ["And", [\
  ["page_id", "In", ["page1", "page2"]],\
  ["Or", [\
    ["public", "Eq", 1],\
    ["permission_id", "In", ["3iQK2VC4", "wzw8zpnQ"]]\
  ]]\
]]
```

Filters can also be applied to the `id` field, which refers to the document ID.

#### Filtering Parameters

**And** array\[filter\]

Matches if all of the filters match.

**Or** array\[filter\]

Matches if at least one of the filters matches.

**Not** filter

Matches if the filter does not match.

* * *

**Eq** id or value

Exact match for `id` or `attributes` values. If value is `null`, matches documents missing the attribute.

**NotEq** value

Inverse of `Eq`, for `attributes` values. If value is `null`, matches documents with the attribute.

* * *

**In** array\[value\]

Matches any `attributes` values contained in the provided list.

**NotIn** array\[value\]

Inverse of `In`, matches any `attributes` values not contained in the provided list.

* * *

**Contains** value

Checks whether the selected array attribute contains the provided value

**NotContains** value

Inverse of Contains

**ContainsAny** array\[value\]

Checks whether the selected array attribute contains any of the values provided (intersection filter)

**NotContainsAny** array\[value\]

Inverse of ContainsAny

* * *

**Lt** value

For ints, this is a numeric less-than on `attributes` values. For strings, lexicographic less-than. For datetimes, numeric less-than on millisecond representation.

**Lte** value

For ints, this is a numeric less-than-or-equal on `attributes` values. For strings, lexicographic less-than-or-equal. For datetimes, numeric less-than-or-equal on millisecond representation.

**Gt** value

For ints, this is a numeric greater-than on `attributes` values. For strings, lexicographic greater-than. For datetimes, numeric greater-than on millisecond representation.

**Gte** value

For ints, this is a numeric greater-than-or-equal on `attributes` values. For strings, lexicographic greater-than-or-equal. For datetimes, numeric greater-than-or-equal on millisecond representation.

* * *

**AnyLt** value

Checks whether any element of an array attribute is less than the provided value, using the same rules as [`Lt`](https://turbopuffer.com/docs/query#param-Lt).

**AnyLte** value

Checks whether any element of an array attribute is less than or equal to the provided value, using the same rules as [`Lte`](https://turbopuffer.com/docs/query#param-lte).

**AnyGt** value

Checks whether any element of an array attribute is greater than the provided value, using the same rules as [`Gt`](https://turbopuffer.com/docs/query#param-gt).

**AnyGte** value

Checks whether any element of an array attribute is greater than or equal to the provided value, using the same rules as [`Gte`](https://turbopuffer.com/docs/query#param-gte).

* * *

**Glob** globset

Unix-style glob match against `string` or `[]string` attribute values. The full syntax is described in the [globset](https://docs.rs/globset/latest/globset/#syntax) documentation. Glob patterns with a concrete prefix like "foo\*" internally compile to efficient range queries, while patterns without a concrete prefix (e.g., "\*foo\*" or "\*foo") will perform a full scan of the namespace.

**NotGlob** globset

Inverse of `Glob`, Unix-style glob filters against `string` or `[]string` attribute values. The full syntax is described in the [globset](https://docs.rs/globset/latest/globset/#syntax) documentation.

**IGlob** globset

Case insensitive version of `Glob`.

**NotIGlob** globset

Case insensitive version of `NotGlob`.

* * *

**Regex** string

Regular expression match against `string` attribute values. Requires the [regex schema attribute](https://turbopuffer.com/docs/write#param-regex) to be enabled before use.

**Warning:** Doesn't support certain advanced features (e.g. look-around, backreferences). Currently requires exhaustive evaluation; not recommended for large namespaces or ANN queries unless used in conjunction with other selective filters. [Contact us](https://turbopuffer.com/contact) if you run into performance problems.

* * *

**ContainsAllTokens** string

Matches documents that contain all the tokens present in the filter input string. If you need tokens to be adjacent and in order, use `ContainsTokenSequence` instead. See [phrase matching](https://turbopuffer.com/docs/query#phrase-matching) for usage examples.

Requires that the attribute is configured for [full-text search](https://turbopuffer.com/docs/fts).

Supports [prefix queries](https://turbopuffer.com/docs/query#prefix-queries) by providing an options object as the fourth parameter with `"last_as_prefix": true`. Prefixes match using byte representations, e.g. "🧑" is a prefix of "🧑‍💻".

* * *

**ContainsTokenSequence** string

Matches documents that contain all the tokens present in the
input string, in the exact order and adjacent to each other. See [phrase matching](https://turbopuffer.com/docs/query#phrase-matching) for usage examples.

Requires that the attribute is configured for [full-text search](https://turbopuffer.com/docs/fts).

#### Complex Example

Using nested `And` and `Or` filters:

python

curlpythontypescriptgojavaruby

```python
import turbopuffer

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-complex-filter-example-py')

# If an error occurs, this call raises a turbopuffer.APIError if a retry was not successful.
result = ns.query(
    rank_by=("vector", "ANN", [0.1, 0.1]),
    top_k=10,
    exclude_attributes=["vector", "filename"],
    filters=('And', (
        ('id', 'In', [1, 2, 3]),
        ('key1', 'Eq', 'one'),
        ('filename', 'NotGlob', '/vendor/**'),
        ('Or', [\
            ('filename', 'Glob', '**.tsx'),\
            ('filename', 'Glob', '**.js'),\
        ]),
    ))
)
print(result.rows) # Returns a row-oriented VectorResult
```

### Diversification

The [limit.per](https://turbopuffer.com/docs/query#param-limit) parameter is a simple mechanism for increasing the
diversity of results. For example, to ensure that no category appears more than
five times in the results:

```jsonc
{
  "rank_by": ["id", "asc"],
  "filters": ["product_name", "ContainsAllTokens", "red cotton"],
  "limit": {
    "per": {"attributes": ["category"], "limit": 5}, // no more than 5 docs per category
    "total": 50
  }
}
```

### Pagination

When [Ordering by Attributes](https://turbopuffer.com/docs/query#ordering-by-attributes), you can page through results by advancing a filter on the order attribute. For example, to paginate by ID, advance a greater-than filter on ID:

python

pythontypescriptgojavaruby

```python
from datetime import datetime
import turbopuffer
from turbopuffer.types import Filter
from typing import List

tpuf = turbopuffer.Turbopuffer(
    region='gcp-us-central1', # pick the right region: https://turbopuffer.com/docs/regions
)

ns = tpuf.namespace('query-pagination-example-py')

last_id = None
while True:
    filters: List[Filter] = [('timestamp', 'Gte', datetime(2024, 1, 1, 0, 0, 0))]

    if last_id is not None:
        filters.append(('id', 'Gt', last_id))

    result = ns.query(
        rank_by=('id', 'asc'),
        top_k=1000,
        filters=('And', filters),
    )
    print(result)

    if len(result.rows) < 1000:
        break
    last_id = result.rows[-1].id
```

Currently paginating beyond the first page for full-text search and vector
search is not supported. Pass a larger `top_k` value to get more results and
paginate client-side. If you need a higher limit, please [contact us](https://turbopuffer.com/contact).

On this page

- [Request](https://turbopuffer.com/docs/query#request)
- [Response](https://turbopuffer.com/docs/query#response)
- [Examples](https://turbopuffer.com/docs/query#examples)
- [Vector Search](https://turbopuffer.com/docs/query#vector-search)
- [Filters](https://turbopuffer.com/docs/query#filters)
- [Ordering by Attributes](https://turbopuffer.com/docs/query#ordering-by-attributes)
- [Lookups](https://turbopuffer.com/docs/query#lookups)
- [Aggregations](https://turbopuffer.com/docs/query#aggregations)
- [Group by](https://turbopuffer.com/docs/query#group-by)
- [Multi-queries](https://turbopuffer.com/docs/query#multi-queries)
- [Full-Text Search](https://turbopuffer.com/docs/query#full-text-search)
- [FTS operators](https://turbopuffer.com/docs/query#fts-operators)
- [Field weights/boosts](https://turbopuffer.com/docs/query#field-weightsboosts)
- [Rank by filter](https://turbopuffer.com/docs/query#rank-by-filter)
- [Phrase matching](https://turbopuffer.com/docs/query#phrase-matching)
- [Prefix queries](https://turbopuffer.com/docs/query#prefix-queries)
- [Filtering](https://turbopuffer.com/docs/query#filtering)
- [Filtering Parameters](https://turbopuffer.com/docs/query#filtering-parameters)
- [Complex Example](https://turbopuffer.com/docs/query#complex-example)
- [Diversification](https://turbopuffer.com/docs/query#diversification)
- [Pagination](https://turbopuffer.com/docs/query#pagination)

![turbopuffer logo](https://turbopuffer.com/_next/static/media/lockup_transparent.6092c7ef.svg)

[Company](https://turbopuffer.com/about) [Jobs](https://turbopuffer.com/jobs) [Pricing](https://turbopuffer.com/pricing) [Press & media](https://turbopuffer.com/press) [System status](https://status.turbopuffer.com/)

Support

[Slack](https://join.slack.com/t/turbopuffer-community/shared_invite/zt-24vaw9611-7E4RLNVeLXjcVatYpEJTXQ) [Docs](https://turbopuffer.com/docs) [Email](https://turbopuffer.com/contact/support) [Sales](https://turbopuffer.com/contact/sales)

Follow

[Blog](https://turbopuffer.com/blog) [RSS](https://turbopuffer.com/blog/rss.xml)

© 2026 turbopuffer Inc.

[Terms of service](https://turbopuffer.com/terms-of-service) [Data Processing Agreement](https://turbopuffer.com/dpa) [Privacy Policy](https://turbopuffer.com/privacy-policy) [Security & Compliance](https://turbopuffer.com/docs/security)